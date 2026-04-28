#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ensureOpenDataTables } = require('../services/openDataSchema');

const DEFAULT_SOURCE_KEY = 'beijing_roadside_parking_basic';
const DEFAULT_MAX_SYNC_SLOTS = 300;

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    sourceKey: DEFAULT_SOURCE_KEY,
    dryRun: args.includes('--dry-run'),
    syncSlots: args.includes('--sync-slots'),
    maxSyncSlots: DEFAULT_MAX_SYNC_SLOTS,
    inputPath: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--source') {
      options.sourceKey = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--source=')) {
      options.sourceKey = arg.split('=').slice(1).join('=');
    } else if (arg === '--max-sync-slots') {
      options.maxSyncSlots = Number.parseInt(args[index + 1], 10);
      index += 1;
    } else if (arg.startsWith('--max-sync-slots=')) {
      options.maxSyncSlots = Number.parseInt(arg.split('=').slice(1).join('='), 10);
    } else if (!arg.startsWith('--') && !options.inputPath) {
      options.inputPath = arg;
    }
  }

  if (!options.inputPath) {
    throw new Error(
      'Usage: npm run import:beijing-open-data -- <csv_path> --source <source_key> [--dry-run] [--sync-slots] [--max-sync-slots 300]'
    );
  }

  if (!options.sourceKey) {
    throw new Error('--source must not be empty.');
  }

  if (!Number.isInteger(options.maxSyncSlots) || options.maxSyncSlots < 0) {
    throw new Error('--max-sync-slots must be a non-negative integer.');
  }

  return options;
}

function resolveInputPath(inputPath) {
  const directPath = path.resolve(process.cwd(), inputPath);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const projectDataPath = path.join(projectRoot, inputPath.replace(/^(\.\.\/)+/, ''));
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

function readTableFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.csv') {
    throw new Error('Only CSV is supported for now. Please save XLSX files as CSV before importing.');
  }

  return parseCsv(fs.readFileSync(filePath, 'utf8'));
}

function normalizeHeader(value) {
  return String(value || '')
    .replace(/\s/g, '')
    .replace(/[()（）_·]/g, '')
    .toLowerCase();
}

function getField(row, candidates) {
  for (const candidate of candidates) {
    if (row[candidate] !== undefined && row[candidate] !== '') {
      return row[candidate];
    }
  }

  const normalizedCandidates = new Set(candidates.map(normalizeHeader));
  const key = Object.keys(row).find((header) => normalizedCandidates.has(normalizeHeader(header)));
  return key ? row[key] : '';
}

function parseOptionalInteger(value, fieldName, line) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const normalized = String(value).replace(/,/g, '').trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Line ${line}: ${fieldName} must be a non-negative integer.`);
  }
  return parsed;
}

function parseOptionalNumber(value, fieldName, line) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`Line ${line}: ${fieldName} must be a number.`);
  }
  return parsed;
}

function buildExternalId(row, sourceKey) {
  const explicitId = getField(row, [
    'source_external_id',
    'parking_lot_id',
    '停车场id',
    '停车场ID',
    '停车场编号',
    '车厂编号',
    '点位编码'
  ]);

  if (explicitId) {
    return explicitId;
  }

  const name = getField(row, ['name', '停车场名称', '停车场名', '车厂名称', '点位名称']);
  const address = getField(row, ['address', '地址', '停车场地址', '详细地址', '位置', '位置（道路名）', '位置 (道路名)', '所在道路']);
  const stableValue = `${sourceKey}:${name}:${address}:${row.__line}`;
  return crypto.createHash('sha1').update(stableValue).digest('hex').slice(0, 16);
}

function normalizeOpenDataRow(row, sourceKey) {
  const name = getField(row, ['name', '停车场名称', '停车场名', '车厂名称', '点位名称']);
  if (!name) {
    throw new Error(`Line ${row.__line}: parking lot name is required.`);
  }

  const totalSpaces = parseOptionalInteger(
    getField(row, ['total_spaces', '开放泊位数', '泊位数量', '停车位数量', '车位总数', '总车位数', '泊位总数']),
    'total spaces',
    row.__line
  );
  const availableSpaces = parseOptionalInteger(
    getField(row, ['available_spaces', '剩余泊位数', '当前空车位数', '空闲车位数', '空车位数']),
    'available spaces',
    row.__line
  );

  if (totalSpaces !== null && availableSpaces !== null && availableSpaces > totalSpaces) {
    throw new Error(`Line ${row.__line}: available spaces cannot exceed total spaces.`);
  }

  const latitude = parseOptionalNumber(getField(row, ['latitude', '纬度', '百度纬度', 'wgs84_lat']), 'latitude', row.__line);
  const longitude = parseOptionalNumber(getField(row, ['longitude', '经度', '百度经度', 'wgs84_lng', 'wgs84_lon']), 'longitude', row.__line);
  const address = getField(row, ['address', '地址', '停车场地址', '详细地址', '位置', '位置（道路名）', '位置 (道路名)', '所在道路']);
  const district = getField(row, ['district', '所属县区', '所属区', '所属区划', '区县名称']);
  const feeRule = getField(row, ['fee_rule', '收费标准', '收费方式', '计时收费', '计次收费']);
  const availabilityLevel = getField(row, ['availability_level', '空闲类型']);
  const notes = getField(row, ['notes', '备注']);
  const externalId = buildExternalId(row, sourceKey);

  return {
    line: row.__line,
    sourceKey,
    sourceExternalId: externalId,
    name,
    totalSpaces,
    availableSpaces,
    occupiedSpaces: totalSpaces !== null && availableSpaces !== null ? totalSpaces - availableSpaces : null,
    availabilityLevel: availabilityLevel || null,
    metadata: {
      source_external_id: externalId,
      source_type: sourceKey,
      district: district || null,
      address: address || null,
      latitude,
      longitude,
      fee_rule: feeRule || null,
      availability_level: availabilityLevel || null,
      notes: notes || null,
      imported_from: 'beijing_open_data_csv',
      imported_at: new Date().toISOString(),
      raw_columns: Object.keys(row).filter((key) => key !== '__line')
    },
    raw: row
  };
}

function createSlotConfiguration(record) {
  const totalSpaces = record.totalSpaces || 0;
  const columns = Math.min(10, Math.max(1, Math.ceil(Math.sqrt(totalSpaces))));
  const rows = Math.max(1, Math.ceil(totalSpaces / columns));

  return {
    rows,
    columns,
    slot_width: 2.5,
    slot_height: 5.0,
    layout_type: 'open_data_grid',
    metadata: record.metadata
  };
}

function shouldCreateGeneratedSlots(record, options) {
  if (!record.totalSpaces || record.totalSpaces <= 0 || record.availableSpaces === null) {
    return false;
  }

  if (!options.syncSlots) {
    return false;
  }

  return options.maxSyncSlots === 0 || record.totalSpaces <= options.maxSyncSlots;
}

function readSourceRegistry(projectRoot) {
  const registryPath = path.join(projectRoot, 'data', 'open_data_source_registry.csv');
  if (!fs.existsSync(registryPath)) {
    return [];
  }

  return parseCsv(fs.readFileSync(registryPath, 'utf8'));
}

function toBooleanRequiresKey(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('no business key')) {
    return false;
  }
  return normalized.includes('userkey')
    || normalized.includes('api key')
    || normalized.includes('requires key')
    || normalized.includes('requires application')
    || normalized.includes('requires beijing public data userkey');
}

async function upsertDataSource(client, sourceKey, projectRoot) {
  const registry = readSourceRegistry(projectRoot);
  const row = registry.find((item) => item.source_key === sourceKey);
  const source = row || {
    source_key: sourceKey,
    name: sourceKey,
    provider: '',
    category: 'open_data',
    access_method: 'manual CSV import',
    license_or_terms: '',
    official_url: '',
    next_action: ''
  };

  const result = await client.query(
    `INSERT INTO data_sources (
       source_key,
       name,
       provider,
       category,
       priority,
       access_method,
       license_or_terms,
       primary_fields,
       fit_for_project,
       next_action,
       official_url,
       requires_key,
       metadata,
       notes,
       is_active,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, CURRENT_TIMESTAMP)
     ON CONFLICT (source_key)
     DO UPDATE SET
       name = EXCLUDED.name,
       provider = EXCLUDED.provider,
       category = EXCLUDED.category,
       priority = EXCLUDED.priority,
       access_method = EXCLUDED.access_method,
       license_or_terms = EXCLUDED.license_or_terms,
       primary_fields = EXCLUDED.primary_fields,
       fit_for_project = EXCLUDED.fit_for_project,
       next_action = EXCLUDED.next_action,
       official_url = EXCLUDED.official_url,
       requires_key = EXCLUDED.requires_key,
       metadata = EXCLUDED.metadata,
       notes = EXCLUDED.notes,
       is_active = true,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [
      source.source_key,
      source.name,
      source.provider || null,
      source.category || null,
      source.priority || null,
      source.access_method || null,
      source.license_or_terms || null,
      source.primary_fields || null,
      source.fit_for_project || null,
      source.next_action || null,
      source.official_url || null,
      toBooleanRequiresKey(source.access_method),
      JSON.stringify({
        registry_priority: source.priority || null
      }),
      source.next_action || null
    ]
  );

  return result.rows[0].id;
}

async function createImportJob(client, options, dataSourceId, fileHash, recordsSeen) {
  const result = await client.query(
    `INSERT INTO open_data_import_jobs (
       data_source_id,
       source_key,
       import_kind,
       input_file,
       file_sha256,
       status,
       dry_run,
       records_seen,
       metadata
     )
     VALUES ($1, $2, 'beijing_open_data_csv', $3, $4, 'running', false, $5, $6)
     RETURNING id`,
    [
      dataSourceId,
      options.sourceKey,
      options.absolutePath,
      fileHash,
      recordsSeen,
      JSON.stringify({
        sync_slots: options.syncSlots,
        max_sync_slots: options.maxSyncSlots
      })
    ]
  );

  return result.rows[0].id;
}

async function completeImportJob(client, jobId, status, importedCount, failedCount, errorMessage = null) {
  await client.query(
    `UPDATE open_data_import_jobs
     SET status = $1,
         records_imported = $2,
         records_failed = $3,
         completed_at = CURRENT_TIMESTAMP,
         error_message = $4
     WHERE id = $5`,
    [status, importedCount, failedCount, errorMessage, jobId]
  );
}

async function findExistingParkingLotId(client, sourceKey, externalId) {
  const ref = await client.query(
    `SELECT parking_lot_id
     FROM parking_lot_external_refs
     WHERE source_key = $1 AND external_id = $2
     LIMIT 1`,
    [sourceKey, externalId]
  );

  if (ref.rows.length > 0) {
    return ref.rows[0].parking_lot_id;
  }

  const lot = await client.query(
    `SELECT id
     FROM parking_lots
     WHERE slot_configuration->'metadata'->>'source_external_id' = $1
       AND slot_configuration->'metadata'->>'source_type' = $2
     LIMIT 1`,
    [externalId, sourceKey]
  );

  return lot.rows.length > 0 ? lot.rows[0].id : null;
}

async function upsertParkingLot(client, record, options) {
  if (!shouldCreateGeneratedSlots(record, options)) {
    return null;
  }

  const slotConfiguration = createSlotConfiguration(record);
  const existingId = await findExistingParkingLotId(client, record.sourceKey, record.sourceExternalId);

  if (existingId) {
    await client.query(
      `UPDATE parking_lots
       SET name = $1,
           total_slots = $2,
           slot_configuration = $3,
           is_active = true,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [record.name, record.totalSpaces, JSON.stringify(slotConfiguration), existingId]
    );
    return existingId;
  }

  const created = await client.query(
    `INSERT INTO parking_lots (name, total_slots, slot_configuration, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    [record.name, record.totalSpaces, JSON.stringify(slotConfiguration)]
  );

  return created.rows[0].id;
}

async function upsertExternalRef(client, record, parkingLotId, dataSourceId) {
  await client.query(
    `INSERT INTO parking_lot_external_refs (
       parking_lot_id,
       data_source_id,
       source_key,
       external_id,
       external_name,
       metadata,
       last_seen_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     ON CONFLICT (source_key, external_id)
     DO UPDATE SET
       parking_lot_id = EXCLUDED.parking_lot_id,
       data_source_id = EXCLUDED.data_source_id,
       external_name = EXCLUDED.external_name,
       metadata = EXCLUDED.metadata,
       last_seen_at = CURRENT_TIMESTAMP`,
    [
      parkingLotId,
      dataSourceId,
      record.sourceKey,
      record.sourceExternalId,
      record.name,
      JSON.stringify(record.metadata)
    ]
  );
}

async function insertOccupancySnapshot(client, record, parkingLotId, dataSourceId) {
  if (record.availableSpaces === null && record.occupiedSpaces === null) {
    return false;
  }

  await client.query(
    `INSERT INTO parking_occupancy_snapshots (
       parking_lot_id,
       data_source_id,
       source_key,
       external_id,
       total_spaces,
       available_spaces,
       occupied_spaces,
       availability_level,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      parkingLotId,
      dataSourceId,
      record.sourceKey,
      record.sourceExternalId,
      record.totalSpaces,
      record.availableSpaces,
      record.occupiedSpaces,
      record.availabilityLevel,
      JSON.stringify(record.metadata)
    ]
  );

  return true;
}

async function syncGeneratedSlots(client, record, parkingLotId, options) {
  if (!parkingLotId || !shouldCreateGeneratedSlots(record, options)) {
    return false;
  }

  const slotConfiguration = createSlotConfiguration(record);
  await client.query('DELETE FROM parking_slots WHERE parking_lot_id = $1', [parkingLotId]);

  for (let index = 1; index <= record.totalSpaces; index += 1) {
    const row = Math.floor((index - 1) / slotConfiguration.columns);
    const column = (index - 1) % slotConfiguration.columns;
    const isOccupied = record.occupiedSpaces !== null ? index <= record.occupiedSpaces : false;

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
          height: 90,
          source_type: 'beijing_open_data_import',
          source_external_id: record.sourceExternalId
        }),
        isOccupied
      ]
    );
  }

  return true;
}

async function importRecords(client, records, options, dataSourceId) {
  const imported = [];
  const failed = [];

  for (const record of records) {
    try {
      const parkingLotId = await upsertParkingLot(client, record, options);
      await upsertExternalRef(client, record, parkingLotId, dataSourceId);
      const snapshotCreated = await insertOccupancySnapshot(client, record, parkingLotId, dataSourceId);
      const slotsSynced = await syncGeneratedSlots(client, record, parkingLotId, options);

      imported.push({
        parking_lot_id: parkingLotId,
        source_external_id: record.sourceExternalId,
        name: record.name,
        total_spaces: record.totalSpaces,
        available_spaces: record.availableSpaces,
        snapshot_created: snapshotCreated,
        slots_synced: slotsSynced
      });
    } catch (error) {
      failed.push({
        line: record.line,
        source_external_id: record.sourceExternalId,
        name: record.name,
        error: error.message
      });
    }
  }

  return { imported, failed };
}

async function main() {
  const options = parseArgs(process.argv);
  const absolutePath = resolveInputPath(options.inputPath);
  options.absolutePath = absolutePath;

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Input file not found: ${absolutePath}`);
  }

  const rawContent = fs.readFileSync(absolutePath);
  const fileHash = crypto.createHash('sha256').update(rawContent).digest('hex');
  const rows = readTableFile(absolutePath);
  const records = rows.map((row) => normalizeOpenDataRow(row, options.sourceKey));

  if (options.dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      source_key: options.sourceKey,
      input_file: absolutePath,
      file_sha256: fileHash,
      count: records.length,
      records: records.map((record) => ({
        line: record.line,
        source_external_id: record.sourceExternalId,
        name: record.name,
        total_spaces: record.totalSpaces,
        available_spaces: record.availableSpaces,
        metadata: record.metadata
      }))
    }, null, 2));
    process.exit(0);
  }

  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const db = require('../config/database');
  const client = await db.getClient();
  let jobId = null;

  try {
    await client.query('BEGIN');
    await ensureOpenDataTables(client);
    const dataSourceId = await upsertDataSource(client, options.sourceKey, projectRoot);
    jobId = await createImportJob(client, options, dataSourceId, fileHash, records.length);
    const { imported, failed } = await importRecords(client, records, options, dataSourceId);
    await completeImportJob(client, jobId, failed.length > 0 ? 'completed_with_errors' : 'completed', imported.length, failed.length);
    await client.query('COMMIT');

    console.log(JSON.stringify({
      import_job_id: jobId,
      source_key: options.sourceKey,
      imported_count: imported.length,
      failed_count: failed.length,
      imported,
      failed
    }, null, 2));
    process.exit(failed.length > 0 ? 2 : 0);
  } catch (error) {
    await client.query('ROLLBACK');
    if (jobId) {
      try {
        await completeImportJob(client, jobId, 'failed', 0, records.length, error.message);
      } catch (_) {
        // The transaction rollback may already have removed the job row.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
