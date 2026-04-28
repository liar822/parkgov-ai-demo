#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REQUIRED_COLUMNS = [
  'parking_lot_id',
  'name',
  'district',
  'address',
  'total_spaces',
  'available_spaces',
  'fee_rule',
  'source_type'
];

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    csvPath: args.find((arg) => !arg.startsWith('--'))
  };

  if (!options.csvPath) {
    throw new Error('Usage: npm run import:parking-lots -- <csv_path> [--dry-run]');
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

function parseOptionalNumber(value, fieldName, line) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Line ${line}: ${fieldName} must be a number.`);
  }
  return parsed;
}

function parseRequiredInteger(value, fieldName, line) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Line ${line}: ${fieldName} must be a non-negative integer.`);
  }
  return parsed;
}

function normalizeRow(row) {
  const totalSpaces = parseRequiredInteger(row.total_spaces, 'total_spaces', row.__line);
  const availableSpaces = parseRequiredInteger(row.available_spaces, 'available_spaces', row.__line);

  if (!row.parking_lot_id || !row.name) {
    throw new Error(`Line ${row.__line}: parking_lot_id and name are required.`);
  }

  if (totalSpaces <= 0) {
    throw new Error(`Line ${row.__line}: total_spaces must be greater than 0.`);
  }

  if (availableSpaces > totalSpaces) {
    throw new Error(`Line ${row.__line}: available_spaces cannot exceed total_spaces.`);
  }

  return {
    sourceExternalId: row.parking_lot_id,
    name: row.name,
    totalSpaces,
    availableSpaces,
    occupiedSpaces: totalSpaces - availableSpaces,
    metadata: {
      source_external_id: row.parking_lot_id,
      district: row.district || null,
      address: row.address || null,
      latitude: parseOptionalNumber(row.latitude, 'latitude', row.__line),
      longitude: parseOptionalNumber(row.longitude, 'longitude', row.__line),
      fee_rule: row.fee_rule || null,
      source_type: row.source_type || 'demo',
      notes: row.notes || null,
      imported_from: 'csv',
      imported_at: new Date().toISOString()
    }
  };
}

function createSlotConfiguration(lot) {
  const columns = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(lot.totalSpaces))));
  const rows = Math.ceil(lot.totalSpaces / columns);

  return {
    rows,
    columns,
    slot_width: 2.5,
    slot_height: 5.0,
    layout_type: 'grid',
    metadata: lot.metadata
  };
}

async function upsertParkingLot(client, lot) {
  const existing = await client.query(
    `SELECT id FROM parking_lots
     WHERE slot_configuration->'metadata'->>'source_external_id' = $1
     LIMIT 1`,
    [lot.sourceExternalId]
  );

  const slotConfiguration = createSlotConfiguration(lot);
  let parkingLotId;

  if (existing.rows.length > 0) {
    parkingLotId = existing.rows[0].id;
    await client.query(
      `UPDATE parking_lots
       SET name = $1,
           total_slots = $2,
           slot_configuration = $3,
           is_active = true,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [lot.name, lot.totalSpaces, JSON.stringify(slotConfiguration), parkingLotId]
    );
    await client.query('DELETE FROM parking_slots WHERE parking_lot_id = $1', [parkingLotId]);
  } else {
    const created = await client.query(
      `INSERT INTO parking_lots (name, total_slots, slot_configuration, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id`,
      [lot.name, lot.totalSpaces, JSON.stringify(slotConfiguration)]
    );
    parkingLotId = created.rows[0].id;
  }

  for (let index = 1; index <= lot.totalSpaces; index += 1) {
    const row = Math.floor((index - 1) / slotConfiguration.columns);
    const column = (index - 1) % slotConfiguration.columns;
    const isOccupied = index <= lot.occupiedSpaces;

    await client.query(
      `INSERT INTO parking_slots (
         parking_lot_id,
         slot_number,
         coordinates,
         is_occupied,
         current_duration,
         predicted_vacancy_seconds
       )
       VALUES ($1, $2, $3, $4, 0, 0)`,
      [
        parkingLotId,
        index,
        JSON.stringify({
          x: column * 50 + 25,
          y: row * 100 + 50,
          width: 45,
          height: 90
        }),
        isOccupied
      ]
    );
  }

  return parkingLotId;
}

async function main() {
  const { csvPath, dryRun } = parseArgs(process.argv);
  const absolutePath = resolveCsvPath(csvPath);
  const content = fs.readFileSync(absolutePath, 'utf8');
  const lots = parseCsv(content).map(normalizeRow);

  if (dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      count: lots.length,
      parking_lots: lots
    }, null, 2));
    process.exit(0);
  }

  const db = require('../config/database');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const imported = [];

    for (const lot of lots) {
      const id = await upsertParkingLot(client, lot);
      imported.push({
        id,
        source_external_id: lot.sourceExternalId,
        name: lot.name,
        total_spaces: lot.totalSpaces,
        available_spaces: lot.availableSpaces
      });
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      imported_count: imported.length,
      parking_lots: imported
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
