#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { ensureOpenDataTables } = require('../services/openDataSchema');

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    registryPath: args.find((arg) => !arg.startsWith('--')) || '../../data/open_data_source_registry.csv'
  };
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
    throw new Error('Registry CSV must include a header row and at least one data row.');
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

function inferRequiresKey(source) {
  const access = String(source.access_method || '').toLowerCase();
  const notes = String(source.next_action || '').toLowerCase();

  if (access.includes('no business key')) {
    return false;
  }

  return access.includes('userkey')
    || access.includes('api key')
    || access.includes('requires key')
    || access.includes('requires application')
    || access.includes('requires beijing public data userkey')
    || notes.includes('userkey')
    || notes.includes('api key');
}

function normalizeRow(row) {
  if (!row.source_key || !row.name) {
    throw new Error(`Line ${row.__line}: source_key and name are required.`);
  }

  return {
    priority: row.priority || null,
    source_key: row.source_key,
    name: row.name,
    provider: row.provider || null,
    category: row.category || null,
    access_method: row.access_method || null,
    license_or_terms: row.license_or_terms || null,
    primary_fields: row.primary_fields || null,
    fit_for_project: row.fit_for_project || null,
    next_action: row.next_action || null,
    official_url: row.official_url || null,
    requires_key: inferRequiresKey(row),
    notes: row.next_action || null,
    metadata: {
      registry_priority: row.priority || null,
      fit_for_project: row.fit_for_project || null,
      primary_fields: row.primary_fields || null,
      seeded_from: 'open_data_source_registry.csv'
    }
  };
}

async function upsertSource(client, source) {
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
     RETURNING id, source_key`,
    [
      source.source_key,
      source.name,
      source.provider,
      source.category,
      source.priority,
      source.access_method,
      source.license_or_terms,
      source.primary_fields,
      source.fit_for_project,
      source.next_action,
      source.official_url,
      source.requires_key,
      source.notes,
      JSON.stringify(source.metadata)
    ]
  );

  return result.rows[0];
}

async function main() {
  const options = parseArgs(process.argv);
  const absolutePath = resolveInputPath(options.registryPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Registry file not found: ${absolutePath}`);
  }

  const sources = parseCsv(fs.readFileSync(absolutePath, 'utf8')).map(normalizeRow);

  if (options.dryRun) {
    console.log(JSON.stringify({
      dry_run: true,
      registry_file: absolutePath,
      count: sources.length,
      sources
    }, null, 2));
    process.exit(0);
  }

  const db = require('../config/database');
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    await ensureOpenDataTables(client);

    const seeded = [];
    for (const source of sources) {
      seeded.push(await upsertSource(client, source));
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({
      seeded_count: seeded.length,
      data_sources: seeded
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
