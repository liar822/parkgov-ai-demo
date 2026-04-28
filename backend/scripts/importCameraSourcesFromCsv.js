#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REQUIRED_COLUMNS = [
  'camera_id',
  'parking_lot_source_id',
  'parking_lot_name',
  'camera_name',
  'source_kind',
  'status'
];

const SOURCE_KINDS = new Set(['image', 'video_file', 'rtsp', 'http_stream', 'manual_demo']);
const STATUSES = new Set(['planned', 'online', 'offline', 'sample', 'disabled']);

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    csvPath: args.find((arg) => !arg.startsWith('--'))
  };

  if (!options.csvPath) {
    throw new Error('Usage: npm run import:camera-sources -- <csv_path> [--dry-run]');
  }

  return options;
}

function resolveCsvPath(csvPath) {
  const directPath = path.resolve(process.cwd(), csvPath);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const projectDataPath = path.join(projectRoot, csvPath.replace(/^(\.\.\/)+/, ''));
  if (fs.existsSync(projectDataPath)) {
    return projectDataPath;
  }

  return directPath;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(content) {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error('CSV must include a header row and at least one data row.');
  }

  const headers = parseCsvLine(lines[0]);
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required columns: ${missing.join(', ')}`);
  }

  return lines.slice(1).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    row.__line = rowIndex + 2;
    return row;
  });
}

function parseOptionalTimestamp(value, fieldName, line) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Line ${line}: ${fieldName} must be an ISO timestamp.`);
  }

  return date.toISOString();
}

function normalizeRow(row) {
  const sourceKind = row.source_kind || 'manual_demo';
  const status = row.status || 'planned';

  if (!row.camera_id || !row.camera_name) {
    throw new Error(`Line ${row.__line}: camera_id and camera_name are required.`);
  }

  if (!SOURCE_KINDS.has(sourceKind)) {
    throw new Error(`Line ${row.__line}: source_kind must be one of ${Array.from(SOURCE_KINDS).join(', ')}.`);
  }

  if (!STATUSES.has(status)) {
    throw new Error(`Line ${row.__line}: status must be one of ${Array.from(STATUSES).join(', ')}.`);
  }

  return {
    cameraExternalId: row.camera_id,
    parkingLotSourceId: row.parking_lot_source_id || null,
    parkingLotName: row.parking_lot_name || null,
    name: row.camera_name,
    sourceKind,
    sourceUrl: row.source_url || null,
    coverageDescription: row.coverage_description || null,
    status,
    lastSeenAt: parseOptionalTimestamp(row.last_seen_at, 'last_seen_at', row.__line),
    aiPipeline: row.ai_pipeline || null,
    metadata: {
      source_external_id: row.camera_id,
      parking_lot_source_id: row.parking_lot_source_id || null,
      parking_lot_name: row.parking_lot_name || null,
      imported_from: 'csv',
      imported_at: new Date().toISOString(),
      notes: row.notes || null
    }
  };
}

async function ensureCameraSourcesTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS camera_sources (
      id SERIAL PRIMARY KEY,
      parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE SET NULL,
      camera_external_id VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      source_kind VARCHAR(50) NOT NULL,
      source_url TEXT,
      coverage_description TEXT,
      status VARCHAR(50) DEFAULT 'planned',
      last_seen_at TIMESTAMP,
      ai_pipeline VARCHAR(100),
      metadata JSONB,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_camera_sources_lot_id ON camera_sources(parking_lot_id);
    CREATE INDEX IF NOT EXISTS idx_camera_sources_external_id ON camera_sources(camera_external_id);
    CREATE INDEX IF NOT EXISTS idx_camera_sources_status ON camera_sources(status);
  `);
}

async function findParkingLotId(client, camera) {
  const result = await client.query(
    `SELECT id FROM parking_lots
     WHERE slot_configuration->'metadata'->>'source_external_id' = $1
        OR name = $2
     ORDER BY id
     LIMIT 1`,
    [camera.parkingLotSourceId || '', camera.parkingLotName || '']
  );

  return result.rows[0]?.id || null;
}

async function upsertCameraSource(client, camera) {
  const parkingLotId = await findParkingLotId(client, camera);

  const result = await client.query(
    `INSERT INTO camera_sources (
       parking_lot_id,
       camera_external_id,
       name,
       source_kind,
       source_url,
       coverage_description,
       status,
       last_seen_at,
       ai_pipeline,
       metadata,
       is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
     ON CONFLICT (camera_external_id) DO UPDATE SET
       parking_lot_id = EXCLUDED.parking_lot_id,
       name = EXCLUDED.name,
       source_kind = EXCLUDED.source_kind,
       source_url = EXCLUDED.source_url,
       coverage_description = EXCLUDED.coverage_description,
       status = EXCLUDED.status,
       last_seen_at = EXCLUDED.last_seen_at,
       ai_pipeline = EXCLUDED.ai_pipeline,
       metadata = EXCLUDED.metadata,
       is_active = true,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, parking_lot_id`,
    [
      parkingLotId,
      camera.cameraExternalId,
      camera.name,
      camera.sourceKind,
      camera.sourceUrl,
      camera.coverageDescription,
      camera.status,
      camera.lastSeenAt,
      camera.aiPipeline,
      JSON.stringify(camera.metadata)
    ]
  );

  return {
    id: result.rows[0].id,
    parkingLotId: result.rows[0].parking_lot_id,
    matchedParkingLot: Boolean(parkingLotId)
  };
}

async function main() {
  const { csvPath, dryRun } = parseArgs(process.argv);
  const absolutePath = resolveCsvPath(csvPath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const cameras = parseCsv(content).map(normalizeRow);

  if (dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      count: cameras.length,
      camera_sources: cameras
    }, null, 2));
    process.exit(0);
  }

  const db = require('../config/database');
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    await ensureCameraSourcesTable(client);

    const imported = [];
    const warnings = [];

    for (const camera of cameras) {
      const result = await upsertCameraSource(client, camera);
      imported.push({
        id: result.id,
        parking_lot_id: result.parkingLotId,
        camera_external_id: camera.cameraExternalId,
        name: camera.name,
        source_kind: camera.sourceKind,
        status: camera.status
      });

      if (!result.matchedParkingLot) {
        warnings.push(`Camera ${camera.cameraExternalId} was imported without a matched parking lot.`);
      }
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      imported_count: imported.length,
      camera_sources: imported,
      warnings
    }, null, 2));
    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
