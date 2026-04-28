#!/usr/bin/env node

process.env.SKIP_DB_AUTO_INIT = 'true';

const { spawnSync } = require('child_process');
const path = require('path');
const db = require('../config/database');
const { ensureOpenDataTables } = require('../services/openDataSchema');
const ParkingSlotRoiService = require('../services/parkingSlotRoiService');
const AiProcessingJobService = require('../services/aiProcessingJobService');
const InferenceEventService = require('../services/inferenceEventService');

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    confirm: args.includes('--confirm'),
    seed: args.includes('--seed')
  };
}

async function ensureTables(client) {
  await ensureOpenDataTables(client);
  await ParkingSlotRoiService.ensureParkingSlotRoisTable(client);
  await AiProcessingJobService.ensureAiProcessingJobsTable(client);
  await InferenceEventService.ensureInferenceEventsTable(client);
}

async function collectDemoScope(client) {
  const lotResult = await client.query(`
    SELECT id, name
    FROM parking_lots
    WHERE slot_configuration->'metadata'->>'source_type' IN (
        'campus_demo',
        'beijing_open_data_demo',
        'ai_dataset_demo'
      )
       OR slot_configuration->'metadata'->>'source_external_id' IN (
        'BJU_CAMPUS_DEMO_001',
        'BJU_CAMPUS_DEMO_002',
        'BJU_OPEN_DATA_DEMO_001',
        'ACPDS_PUBLIC_DATASET_DEMO_001'
      )
    ORDER BY id
  `);
  const lotIds = lotResult.rows.map((row) => row.id);

  const cameraResult = await client.query(`
    SELECT id, camera_external_id
    FROM camera_sources
    WHERE camera_external_id LIKE 'CAMERA_CAMPUS_DEMO_%'
       OR camera_external_id LIKE 'CAMERA_ACPDS_DEMO_%'
    ORDER BY id
  `);
  const cameraIds = cameraResult.rows.map((row) => row.id);

  return {
    lotIds,
    cameraIds,
    parking_lots: lotResult.rows,
    camera_sources: cameraResult.rows
  };
}

async function countRows(client, table, whereSql, params) {
  const result = await client.query(`SELECT COUNT(*)::INTEGER AS count FROM ${table} WHERE ${whereSql}`, params);
  return Number(result.rows[0]?.count || 0);
}

async function buildSummary(client, scope) {
  const lotIds = scope.lotIds.length > 0 ? scope.lotIds : [0];
  const cameraIds = scope.cameraIds.length > 0 ? scope.cameraIds : [0];

  return {
    parking_lots: scope.parking_lots.length,
    parking_slots: await countRows(client, 'parking_slots', 'parking_lot_id = ANY($1::INTEGER[])', [lotIds]),
    parking_slot_rois: await countRows(client, 'parking_slot_rois', 'parking_lot_id = ANY($1::INTEGER[])', [lotIds]),
    camera_sources: scope.camera_sources.length,
    inference_events: await countRows(
      client,
      'inference_events',
      'parking_lot_id = ANY($1::INTEGER[]) OR camera_source_id = ANY($2::INTEGER[])',
      [lotIds, cameraIds]
    ),
    ai_processing_jobs: await countRows(
      client,
      'ai_processing_jobs',
      `parking_lot_id = ANY($1::INTEGER[])
        OR camera_source_id = ANY($2::INTEGER[])
        OR job_external_id LIKE 'backfill-inference-event-%'
        OR metadata->>'source' IN ('demo_ai_run', 'admin_job_rerun')`,
      [lotIds, cameraIds]
    ),
    open_data_snapshots: await countRows(
      client,
      'parking_occupancy_snapshots',
      `parking_lot_id = ANY($1::INTEGER[])
        OR source_key IN ('beijing_realtime_parking', 'beijing_roadside_parking_basic')`,
      [lotIds]
    ),
    open_data_candidates: await countRows(
      client,
      'parking_lot_candidates',
      `source_key = 'osm_overpass_parking'
        AND metadata->>'bbox_label' = 'haidian_university_bbox'`,
      []
    )
  };
}

async function deleteDemoRows(client, scope) {
  const lotIds = scope.lotIds.length > 0 ? scope.lotIds : [0];
  const cameraIds = scope.cameraIds.length > 0 ? scope.cameraIds : [0];

  const deleted = {};

  deleted.ai_processing_jobs = (await client.query(
    `DELETE FROM ai_processing_jobs
     WHERE parking_lot_id = ANY($1::INTEGER[])
        OR camera_source_id = ANY($2::INTEGER[])
        OR job_external_id LIKE 'backfill-inference-event-%'
        OR metadata->>'source' IN ('demo_ai_run', 'admin_job_rerun')`,
    [lotIds, cameraIds]
  )).rowCount;

  deleted.inference_events = (await client.query(
    `DELETE FROM inference_events
     WHERE parking_lot_id = ANY($1::INTEGER[])
        OR camera_source_id = ANY($2::INTEGER[])`,
    [lotIds, cameraIds]
  )).rowCount;

  deleted.open_data_snapshots = (await client.query(
    `DELETE FROM parking_occupancy_snapshots
     WHERE parking_lot_id = ANY($1::INTEGER[])
        OR source_key IN ('beijing_realtime_parking', 'beijing_roadside_parking_basic')`,
    [lotIds]
  )).rowCount;

  deleted.open_data_candidates = (await client.query(
    `DELETE FROM parking_lot_candidates
     WHERE source_key = 'osm_overpass_parking'
       AND metadata->>'bbox_label' = 'haidian_university_bbox'`
  )).rowCount;

  deleted.camera_sources = (await client.query(
    'DELETE FROM camera_sources WHERE id = ANY($1::INTEGER[])',
    [cameraIds]
  )).rowCount;

  deleted.parking_lots = (await client.query(
    'DELETE FROM parking_lots WHERE id = ANY($1::INTEGER[])',
    [lotIds]
  )).rowCount;

  return deleted;
}

function runSeedMvp() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'seedMvpDemoData.js')], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });

  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n').trim());
  }

  return result.stdout.trim().split(/\r?\n/).slice(-8);
}

async function main() {
  const options = parseArgs(process.argv);
  if (!options.dryRun && !options.confirm) {
    throw new Error('Refusing to reset demo data without --confirm. Use --dry-run to preview.');
  }

  const client = await db.getClient();
  let summary;
  let deleted = null;

  try {
    await client.query('BEGIN');
    await ensureTables(client);
    const scope = await collectDemoScope(client);
    summary = await buildSummary(client, scope);

    if (!options.dryRun) {
      deleted = await deleteDemoRows(client, scope);
    }

    await client.query(options.dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const seedOutput = !options.dryRun && options.seed ? runSeedMvp() : null;
  console.log(JSON.stringify({
    dry_run: options.dryRun,
    confirmed: options.confirm,
    seed_after_reset: options.seed,
    scoped_demo_rows: summary,
    deleted_rows: deleted,
    seed_output_tail: seedOutput,
    notes: [
      'Only demo/sample rows are targeted.',
      'Use --confirm --seed to rebuild the demo dataset after reset.',
      'This script does not delete future non-demo parking lots.'
    ]
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
