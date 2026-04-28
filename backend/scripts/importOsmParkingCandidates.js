#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ensureOpenDataTables } = require('../services/openDataSchema');

const DEFAULT_SOURCE_KEY = 'osm_overpass_parking';
const DEFAULT_BBOX = '39.95,116.25,40.04,116.36';
const DEFAULT_LIMIT = 200;
const DEFAULT_TIMEOUT = 25;
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    bbox: DEFAULT_BBOX,
    limit: DEFAULT_LIMIT,
    timeout: DEFAULT_TIMEOUT,
    endpoint: DEFAULT_ENDPOINT,
    sourceKey: DEFAULT_SOURCE_KEY,
    dryRun: args.includes('--dry-run'),
    label: 'haidian_university_bbox'
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--bbox') {
      options.bbox = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--bbox=')) {
      options.bbox = arg.split('=').slice(1).join('=');
    } else if (arg === '--limit') {
      options.limit = Number.parseInt(args[index + 1], 10);
      index += 1;
    } else if (arg.startsWith('--limit=')) {
      options.limit = Number.parseInt(arg.split('=').slice(1).join('='), 10);
    } else if (arg === '--timeout') {
      options.timeout = Number.parseInt(args[index + 1], 10);
      index += 1;
    } else if (arg.startsWith('--timeout=')) {
      options.timeout = Number.parseInt(arg.split('=').slice(1).join('='), 10);
    } else if (arg === '--endpoint') {
      options.endpoint = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--endpoint=')) {
      options.endpoint = arg.split('=').slice(1).join('=');
    } else if (arg === '--source') {
      options.sourceKey = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--source=')) {
      options.sourceKey = arg.split('=').slice(1).join('=');
    } else if (arg === '--label') {
      options.label = args[index + 1];
      index += 1;
    } else if (arg.startsWith('--label=')) {
      options.label = arg.split('=').slice(1).join('=');
    }
  }

  const bboxParts = String(options.bbox).split(',').map((value) => Number(value.trim()));
  if (bboxParts.length !== 4 || bboxParts.some((value) => !Number.isFinite(value))) {
    throw new Error('--bbox must use south,west,north,east, for example: 39.95,116.25,40.04,116.36');
  }

  if (!Number.isInteger(options.limit) || options.limit <= 0 || options.limit > 5000) {
    throw new Error('--limit must be an integer between 1 and 5000.');
  }

  if (!Number.isInteger(options.timeout) || options.timeout <= 0 || options.timeout > 180) {
    throw new Error('--timeout must be an integer between 1 and 180.');
  }

  options.bboxParts = bboxParts;
  return options;
}

function buildOverpassQuery(options) {
  const bbox = options.bboxParts.join(',');
  return `[out:json][timeout:${options.timeout}];
(
  node["amenity"="parking"](${bbox});
  way["amenity"="parking"](${bbox});
  relation["amenity"="parking"](${bbox});
);
out center tags ${options.limit};`;
}

async function fetchOverpass(options) {
  const query = buildOverpassQuery(options);
  const params = new URLSearchParams({ data: query });
  const url = `${options.endpoint}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ai-parking-system-data-import/0.1'
    }
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
  }

  return {
    query,
    url,
    payload: await response.json()
  };
}

function parseOptionalInteger(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  const parsed = Number.parseInt(String(value).replace(/,/g, ''), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function pickName(tags = {}) {
  return tags.name || tags['name:zh'] || tags['name:zh-Hans'] || tags.operator || null;
}

function normalizeElement(element, options, osmBaseTimestamp) {
  const tags = element.tags || {};
  const latitude = element.lat ?? element.center?.lat ?? null;
  const longitude = element.lon ?? element.center?.lon ?? null;
  const externalId = `${element.type}/${element.id}`;

  return {
    sourceKey: options.sourceKey,
    externalId,
    osmType: element.type,
    osmId: element.id,
    name: pickName(tags),
    latitude,
    longitude,
    parkingType: tags.parking || null,
    access: tags.access || null,
    fee: tags.fee || null,
    capacity: parseOptionalInteger(tags.capacity),
    operator: tags.operator || null,
    tags,
    metadata: {
      imported_from: 'overpass_api',
      imported_at: new Date().toISOString(),
      bbox: options.bbox,
      bbox_label: options.label,
      osm_base_timestamp: osmBaseTimestamp || null,
      overpass_source: options.endpoint,
      note: 'Candidate POI only. Do not treat as live parking availability.'
    }
  };
}

function normalizePayload(payload, options) {
  const osmBaseTimestamp = payload?.osm3s?.timestamp_osm_base || null;
  const elements = Array.isArray(payload.elements) ? payload.elements : [];

  return elements
    .filter((element) => element.type !== 'count')
    .map((element) => normalizeElement(element, options, osmBaseTimestamp))
    .filter((candidate) => Number.isFinite(Number(candidate.latitude)) && Number.isFinite(Number(candidate.longitude)));
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
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

function readRegistrySource(projectRoot, sourceKey) {
  const registryPath = path.join(projectRoot, 'data', 'open_data_source_registry.csv');
  if (!fs.existsSync(registryPath)) {
    return null;
  }

  return parseCsv(fs.readFileSync(registryPath, 'utf8')).find((row) => row.source_key === sourceKey) || null;
}

function inferRequiresKey(source) {
  const access = String(source?.access_method || '').toLowerCase();
  if (access.includes('no business key')) {
    return false;
  }
  return access.includes('userkey')
    || access.includes('api key')
    || access.includes('requires key')
    || access.includes('requires application');
}

async function upsertDataSource(client, sourceKey, projectRoot) {
  const source = readRegistrySource(projectRoot, sourceKey) || {
    priority: 'P1',
    source_key: sourceKey,
    name: sourceKey,
    provider: 'OpenStreetMap contributors',
    category: 'open_map_poi',
    access_method: 'Overpass API; no business key',
    license_or_terms: 'ODbL; must attribute OSM and contributors',
    primary_fields: 'amenity=parking; parking=*; name; center lat/lon',
    fit_for_project: 'parking POI candidate layer',
    next_action: 'review candidates before promoting to managed parking lots',
    official_url: 'https://wiki.openstreetmap.org/wiki/Parking'
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
       notes,
       metadata,
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
       notes = EXCLUDED.notes,
       metadata = EXCLUDED.metadata,
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
      inferRequiresKey(source),
      source.next_action || null,
      JSON.stringify({
        registry_priority: source.priority || null,
        seeded_from: 'open_data_source_registry.csv'
      })
    ]
  );

  return result.rows[0].id;
}

async function createImportJob(client, options, dataSourceId, queryHash, recordsSeen) {
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
     VALUES ($1, $2, 'osm_overpass_parking_candidates', $3, $4, 'running', false, $5, $6)
     RETURNING id`,
    [
      dataSourceId,
      options.sourceKey,
      options.endpoint,
      queryHash,
      recordsSeen,
      JSON.stringify({
        bbox: options.bbox,
        bbox_label: options.label,
        limit: options.limit,
        timeout: options.timeout
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

async function upsertCandidate(client, candidate, dataSourceId) {
  const result = await client.query(
    `INSERT INTO parking_lot_candidates (
       data_source_id,
       source_key,
       external_id,
       osm_type,
       osm_id,
       name,
       latitude,
       longitude,
       parking_type,
       access,
       fee,
       capacity,
       operator,
       tags,
       metadata,
       is_active,
       last_seen_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, CURRENT_TIMESTAMP)
     ON CONFLICT (source_key, external_id)
     DO UPDATE SET
       data_source_id = EXCLUDED.data_source_id,
       osm_type = EXCLUDED.osm_type,
       osm_id = EXCLUDED.osm_id,
       name = EXCLUDED.name,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       parking_type = EXCLUDED.parking_type,
       access = EXCLUDED.access,
       fee = EXCLUDED.fee,
       capacity = EXCLUDED.capacity,
       operator = EXCLUDED.operator,
       tags = EXCLUDED.tags,
       metadata = EXCLUDED.metadata,
       is_active = true,
       last_seen_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [
      dataSourceId,
      candidate.sourceKey,
      candidate.externalId,
      candidate.osmType,
      candidate.osmId,
      candidate.name,
      candidate.latitude,
      candidate.longitude,
      candidate.parkingType,
      candidate.access,
      candidate.fee,
      candidate.capacity,
      candidate.operator,
      JSON.stringify(candidate.tags),
      JSON.stringify(candidate.metadata)
    ]
  );

  return result.rows[0].id;
}

async function main() {
  const options = parseArgs(process.argv);
  const { query, url, payload } = await fetchOverpass(options);
  const candidates = normalizePayload(payload, options);
  const queryHash = crypto.createHash('sha256').update(query).update(JSON.stringify(payload.osm3s || {})).digest('hex');

  if (options.dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      source_key: options.sourceKey,
      bbox: options.bbox,
      bbox_label: options.label,
      endpoint: options.endpoint,
      overpass_url: url,
      osm_base_timestamp: payload?.osm3s?.timestamp_osm_base || null,
      count: candidates.length,
      candidates: candidates.slice(0, 20)
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
    jobId = await createImportJob(client, options, dataSourceId, queryHash, candidates.length);

    const imported = [];
    const failed = [];
    for (const candidate of candidates) {
      try {
        const id = await upsertCandidate(client, candidate, dataSourceId);
        imported.push({
          id,
          external_id: candidate.externalId,
          name: candidate.name,
          latitude: candidate.latitude,
          longitude: candidate.longitude
        });
      } catch (error) {
        failed.push({
          external_id: candidate.externalId,
          name: candidate.name,
          error: error.message
        });
      }
    }

    await completeImportJob(client, jobId, failed.length > 0 ? 'completed_with_errors' : 'completed', imported.length, failed.length);
    await client.query('COMMIT');

    console.log(JSON.stringify({
      import_job_id: jobId,
      source_key: options.sourceKey,
      bbox: options.bbox,
      imported_count: imported.length,
      failed_count: failed.length,
      imported: imported.slice(0, 20),
      failed
    }, null, 2));
    process.exit(failed.length > 0 ? 2 : 0);
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
