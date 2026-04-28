#!/usr/bin/env node

process.env.SKIP_DB_AUTO_INIT = 'true';

const fs = require('fs');
const path = require('path');
const ParkingSlotRoiService = require('../services/parkingSlotRoiService');
const db = require('../config/database');

const REQUIRED_COLUMNS = [
  'parking_lot_source_id',
  'slot_number',
  'x',
  'y',
  'width',
  'height'
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    csvPath: args.find((arg) => !arg.startsWith('--'))
  };

  if (!options.csvPath) {
    throw new Error('Usage: npm run import:slot-rois -- <csv_path> [--dry-run]');
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

function parsePositiveNumber(value, fieldName, line) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Line ${line}: ${fieldName} must be a non-negative number.`);
  }
  return parsed;
}

function parsePositiveInteger(value, fieldName, line) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Line ${line}: ${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function parseOptionalInteger(value, fieldName, line) {
  if (!value) {
    return null;
  }

  return parsePositiveInteger(value, fieldName, line);
}

function normalizeRow(row) {
  const slotNumber = parsePositiveInteger(row.slot_number, 'slot_number', row.__line);
  const width = parsePositiveNumber(row.width, 'width', row.__line);
  const height = parsePositiveNumber(row.height, 'height', row.__line);

  if (width <= 0 || height <= 0) {
    throw new Error(`Line ${row.__line}: width and height must be greater than 0.`);
  }

  if (!row.parking_lot_source_id && !row.parking_lot_id && !row.parking_lot_name) {
    throw new Error(`Line ${row.__line}: one of parking_lot_source_id, parking_lot_id, or parking_lot_name is required.`);
  }

  return {
    parkingLotId: row.parking_lot_id ? parsePositiveInteger(row.parking_lot_id, 'parking_lot_id', row.__line) : null,
    parkingLotSourceId: row.parking_lot_source_id || null,
    parkingLotName: row.parking_lot_name || null,
    cameraExternalId: row.camera_id || null,
    roiVersion: row.roi_version || 'demo_v1',
    slotNumber,
    coordinates: {
      x: parsePositiveNumber(row.x, 'x', row.__line),
      y: parsePositiveNumber(row.y, 'y', row.__line),
      width,
      height,
      coordinate_space: row.coordinate_space || 'pixel',
      frame_width: parseOptionalInteger(row.frame_width, 'frame_width', row.__line),
      frame_height: parseOptionalInteger(row.frame_height, 'frame_height', row.__line),
      camera_external_id: row.camera_id || null,
      source_type: 'roi_csv',
      roi_imported_at: new Date().toISOString(),
      notes: row.notes || null
    },
    notes: row.notes || null
  };
}

async function findParkingLotId(client, roi) {
  if (roi.parkingLotId) {
    const byId = await client.query('SELECT id FROM parking_lots WHERE id = $1', [roi.parkingLotId]);
    return byId.rows[0]?.id || null;
  }

  const result = await client.query(
    `SELECT id FROM parking_lots
     WHERE slot_configuration->'metadata'->>'source_external_id' = $1
        OR name = $2
     ORDER BY id
     LIMIT 1`,
    [roi.parkingLotSourceId || '', roi.parkingLotName || '']
  );

  return result.rows[0]?.id || null;
}

async function updateSlotRoi(client, roi) {
  await ParkingSlotRoiService.ensureParkingSlotRoisTable(client);

  const parkingLotId = await findParkingLotId(client, roi);
  if (!parkingLotId) {
    throw new Error(`No parking lot matched slot ${roi.slotNumber}.`);
  }

  const slot = await client.query(
    `SELECT id, slot_number, coordinates FROM parking_slots
     WHERE parking_lot_id = $1 AND slot_number = $2
     LIMIT 1`,
    [parkingLotId, roi.slotNumber]
  );

  if (slot.rows.length === 0) {
    throw new Error(`Slot ${roi.slotNumber} not found in parking lot ${parkingLotId}.`);
  }

  const roiRecord = await ParkingSlotRoiService.upsertSlotRoi(client, {
    parkingLotId,
    parkingSlotId: slot.rows[0].id,
    cameraExternalId: roi.cameraExternalId,
    roiVersion: roi.roiVersion,
    coordinateSpace: roi.coordinates.coordinate_space,
    x: roi.coordinates.x,
    y: roi.coordinates.y,
    width: roi.coordinates.width,
    height: roi.coordinates.height,
    frameWidth: roi.coordinates.frame_width,
    frameHeight: roi.coordinates.frame_height,
    sourceType: 'roi_csv',
    sourceFile: roi.sourceFile,
    notes: roi.notes,
    metadata: {
      imported_at: roi.coordinates.roi_imported_at,
      parking_lot_source_id: roi.parkingLotSourceId,
      parking_lot_name: roi.parkingLotName,
      slot_number: roi.slotNumber
    }
  });

  const existingCoordinates = slot.rows[0].coordinates || {};
  const nextCoordinates = {
    ...existingCoordinates,
    ...roi.coordinates
  };

  const result = await client.query(
    `UPDATE parking_slots
     SET coordinates = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, parking_lot_id, slot_number, coordinates`,
    [JSON.stringify(nextCoordinates), slot.rows[0].id]
  );

  return {
    ...result.rows[0],
    roi_record_id: roiRecord.id,
    roi_version: roiRecord.roi_version
  };
}

async function main() {
  const { csvPath, dryRun } = parseArgs(process.argv);
  const absolutePath = resolveCsvPath(csvPath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const rois = parseCsv(content).map((row) => ({
    ...normalizeRow(row),
    sourceFile: path.relative(path.resolve(__dirname, '..', '..', '..', '..'), absolutePath)
  }));

  if (dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      count: rois.length,
      slot_rois: rois
    }, null, 2));
    return;
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    const updated = [];

    for (const roi of rois) {
      const result = await updateSlotRoi(client, roi);
      updated.push({
        parking_lot_id: result.parking_lot_id,
        slot_id: result.id,
        roi_record_id: result.roi_record_id,
        roi_version: result.roi_version,
        slot_number: result.slot_number,
        camera_external_id: result.coordinates?.camera_external_id || null
      });
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      updated_count: updated.length,
      slot_rois: updated
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
