#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DATA_ROOT = path.resolve(__dirname, '..', '..', 'data');

const IMPORT_STEPS = [
  {
    name: 'open data source registry',
    script: 'seedDataSourcesFromRegistry.js',
    args: ['../data/open_data_source_registry.csv']
  },
  {
    name: 'campus parking lots',
    script: 'importParkingLotsFromCsv.js',
    args: ['../data/beijing_campus_parking_demo.csv']
  },
  {
    name: 'ACPDS public dataset parking lot',
    script: 'importParkingLotsFromCsv.js',
    args: ['../data/acpds_public_dataset_parking_demo.csv']
  },
  {
    name: 'campus camera sources',
    script: 'importCameraSourcesFromCsv.js',
    args: ['../data/campus_camera_sources_demo.csv']
  },
  {
    name: 'ACPDS camera sources',
    script: 'importCameraSourcesFromCsv.js',
    args: ['../data/acpds_camera_sources_demo.csv']
  },
  {
    name: 'campus slot ROI',
    script: 'importSlotRoisFromCsv.js',
    args: ['../data/campus_parking_slot_roi_demo.csv']
  },
  {
    name: 'ACPDS slot ROI',
    script: 'importSlotRoisFromCsv.js',
    args: ['../data/acpds_public_dataset_slot_roi_demo.csv']
  },
  {
    name: 'Beijing roadside open data sample',
    script: 'importBeijingOpenData.js',
    args: [
      '../data/beijing_open_data_roadside_import_sample.csv',
      '--source',
      'beijing_roadside_parking_basic'
    ]
  },
  {
    name: 'Beijing realtime parking open data sample',
    script: 'importBeijingOpenData.js',
    args: [
      '../data/beijing_open_data_realtime_import_sample.csv',
      '--source',
      'beijing_realtime_parking',
      '--sync-slots',
      '--max-sync-slots',
      '200'
    ]
  }
];

const INFERENCE_EVENT_FILES = [
  'sample_ai_inference_result_demo.json',
  'acpds_first_round_inference_event_demo.json'
];

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    skipInference: args.includes('--skip-inference'),
    forceInference: args.includes('--force-inference')
  };
}

function summarizeJsonOutput(stdout) {
  const trimmedOutput = stdout.trim();
  const jsonStart = trimmedOutput.indexOf('{');
  const jsonEnd = trimmedOutput.lastIndexOf('}');
  const jsonCandidate = jsonStart >= 0 && jsonEnd > jsonStart
    ? trimmedOutput.slice(jsonStart, jsonEnd + 1)
    : trimmedOutput;

  try {
    const payload = JSON.parse(jsonCandidate);
    return {
      dry_run: payload.dry_run || false,
      count:
        payload.count
        ?? payload.imported_count
        ?? payload.seeded_count
        ?? payload.updated_count
        ?? payload.synced_count
        ?? payload.inserted_count
        ?? payload.candidate_count
        ?? null,
      imported_count: payload.imported_count,
      seeded_count: payload.seeded_count,
      updated_count: payload.updated_count,
      synced_count: payload.synced_count,
      inserted_count: payload.inserted_count,
      candidate_count: payload.candidate_count,
      warning: payload.warning
    };
  } catch (error) {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    return { output: lines.slice(-5) };
  }
}

function backfillAiProcessingJobs(options) {
  const scriptPath = path.join(__dirname, 'backfillAiProcessingJobs.js');
  const args = [scriptPath];
  if (options.dryRun) {
    args.push('--dry-run');
  }

  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.status !== 0) {
    const errorOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`AI processing jobs backfill failed:\n${errorOutput}`);
  }

  return summarizeJsonOutput(result.stdout);
}

function runImportStep(step, options) {
  const scriptPath = path.join(__dirname, step.script);
  const args = [scriptPath, ...step.args];
  if (options.dryRun) {
    args.push('--dry-run');
  }

  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024
  });

  if (result.status !== 0) {
    const errorOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${step.name} failed:\n${errorOutput}`);
  }

  return {
    name: step.name,
    script: step.script,
    summary: summarizeJsonOutput(result.stdout)
  };
}

function readInferencePayload(fileName) {
  const filePath = path.join(DATA_ROOT, fileName);
  return {
    fileName,
    filePath,
    payload: JSON.parse(fs.readFileSync(filePath, 'utf8'))
  };
}

async function inferenceEventAlreadyExists(payload) {
  const InferenceEventService = require('../services/inferenceEventService');
  const db = require('../config/database');
  const client = await db.getClient();

  try {
    await InferenceEventService.ensureInferenceEventsTable(client);
    const result = await client.query(
      `SELECT id
       FROM inference_events
       WHERE model_name = $1
         AND input_path = $2
         AND notes = $3
       ORDER BY id
       LIMIT 1`,
      [payload.model_name || 'unknown', payload.input_path || null, payload.notes || null]
    );

    return result.rows[0]?.id || null;
  } finally {
    client.release();
  }
}

async function seedInferenceEvents(options) {
  if (options.skipInference) {
    return [];
  }

  const InferenceEventService = options.dryRun ? null : require('../services/inferenceEventService');

  const results = [];
  for (const fileName of INFERENCE_EVENT_FILES) {
    const { payload } = readInferencePayload(fileName);

    if (options.dryRun) {
      results.push({
        file: fileName,
        dry_run: true,
        detections: payload.detections?.length || 0,
        model_name: payload.model_name,
        input_path: payload.input_path
      });
      continue;
    }

    const existingId = options.forceInference ? null : await inferenceEventAlreadyExists(payload);
    if (existingId) {
      results.push({
        file: fileName,
        skipped: true,
        existing_inference_event_id: existingId
      });
      continue;
    }

    const recorded = await InferenceEventService.recordInferenceEvent(payload);
    results.push({
      file: fileName,
      inference_event_id: recorded.inference_event.id,
      parking_lot_id: recorded.parking_lot.id,
      updated_slots: recorded.updated_slots.length,
      summary: recorded.summary
    });
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv);
  const startedAt = new Date().toISOString();
  const imports = [];

  for (const step of IMPORT_STEPS) {
    imports.push(runImportStep(step, options));
  }

  const inferenceEvents = await seedInferenceEvents(options);
  const aiProcessingJobsBackfill = backfillAiProcessingJobs(options);

  console.log(JSON.stringify({
    dry_run: options.dryRun,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    import_steps: imports,
    inference_events: inferenceEvents,
    ai_processing_jobs_backfill: aiProcessingJobsBackfill,
    notes: [
      'This command seeds demo/sample data only.',
      'It does not claim real Beijing-wide camera access.',
      'It does not delete existing rows.'
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
