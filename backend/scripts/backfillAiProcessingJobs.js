#!/usr/bin/env node

const { Pool } = require('pg');
require('dotenv').config();

const dbConfig = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'ai_parking_system',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
};

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    dryRun: args.includes('--dry-run')
  };
}

function inferJobType(row) {
  if (row.source_type === 'ai_dataset_demo') return 'dataset_batch';
  if (row.source_kind === 'image') return 'image';
  if (row.source_kind === 'video_file') return 'video_file';
  if (row.source_kind === 'manual_demo') return 'manual_demo';
  return 'api_inference';
}

async function ensureAiProcessingJobsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_processing_jobs (
      id SERIAL PRIMARY KEY,
      job_external_id VARCHAR(64) UNIQUE NOT NULL,
      parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE CASCADE,
      camera_source_id INTEGER REFERENCES camera_sources(id) ON DELETE SET NULL,
      job_type VARCHAR(50) NOT NULL DEFAULT 'api_inference'
        CHECK (job_type IN ('image', 'video_file', 'dataset_batch', 'manual_demo', 'api_inference')),
      input_path TEXT,
      model_name VARCHAR(100),
      status VARCHAR(50) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
      progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
      result_inference_event_id INTEGER REFERENCES inference_events(id) ON DELETE SET NULL,
      error_message TEXT,
      metadata JSONB,
      notes TEXT,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_processing_jobs_status ON ai_processing_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_ai_processing_jobs_lot_id ON ai_processing_jobs(parking_lot_id);
    CREATE INDEX IF NOT EXISTS idx_ai_processing_jobs_camera_id ON ai_processing_jobs(camera_source_id);
    CREATE INDEX IF NOT EXISTS idx_ai_processing_jobs_created ON ai_processing_jobs(created_at);
  `);
}

async function getBackfillCandidates(client) {
  const result = await client.query(`
    SELECT
      ie.id,
      ie.camera_source_id,
      ie.parking_lot_id,
      ie.model_name,
      ie.input_path,
      ie.total_slots,
      ie.occupied_count,
      ie.vacant_count,
      ie.average_confidence,
      ie.notes,
      ie.created_at,
      cs.source_kind,
      cs.camera_external_id,
      pl.name AS parking_lot_name,
      pl.slot_configuration->'metadata'->>'source_type' AS source_type
    FROM inference_events ie
    LEFT JOIN camera_sources cs ON cs.id = ie.camera_source_id
    LEFT JOIN parking_lots pl ON pl.id = ie.parking_lot_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM ai_processing_jobs jobs
      WHERE jobs.result_inference_event_id = ie.id
    )
    ORDER BY ie.created_at ASC, ie.id ASC
  `);

  return result.rows;
}

async function backfillAiProcessingJobs({ dryRun }) {
  const pool = new Pool(dbConfig);
  const client = await pool.connect();
  const startedAt = new Date().toISOString();

  try {
    await client.query('BEGIN');
    await ensureAiProcessingJobsTable(client);

    const candidates = await getBackfillCandidates(client);

    if (dryRun) {
      await client.query('ROLLBACK');
      return {
        dry_run: true,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        candidate_count: candidates.length,
        candidates: candidates.map((row) => ({
          inference_event_id: row.id,
          parking_lot_id: row.parking_lot_id,
          parking_lot_name: row.parking_lot_name,
          job_type: inferJobType(row),
          model_name: row.model_name,
          input_path: row.input_path
        }))
      };
    }

    const inserted = [];
    for (const row of candidates) {
      const metadata = {
        backfilled_from: 'inference_events',
        backfilled_at: new Date().toISOString(),
        inference_event_id: row.id,
        camera_external_id: row.camera_external_id || null,
        total_slots: row.total_slots,
        occupied_count: row.occupied_count,
        vacant_count: row.vacant_count,
        average_confidence: row.average_confidence
      };

      const insertResult = await client.query(
        `INSERT INTO ai_processing_jobs (
           job_external_id,
           parking_lot_id,
           camera_source_id,
           job_type,
           input_path,
           model_name,
           status,
           progress_percent,
           result_inference_event_id,
           metadata,
           notes,
           started_at,
           completed_at,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'completed', 100, $7, $8, $9, $10, $10, $10, CURRENT_TIMESTAMP)
         ON CONFLICT (job_external_id) DO UPDATE
         SET
           status = 'completed',
           progress_percent = 100,
           result_inference_event_id = COALESCE(ai_processing_jobs.result_inference_event_id, EXCLUDED.result_inference_event_id),
           metadata = COALESCE(ai_processing_jobs.metadata, '{}'::jsonb) || EXCLUDED.metadata,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id, job_external_id, result_inference_event_id, status`,
        [
          `backfill-inference-event-${row.id}`,
          row.parking_lot_id,
          row.camera_source_id,
          inferJobType(row),
          row.input_path,
          row.model_name || 'unknown',
          row.id,
          JSON.stringify(metadata),
          row.notes || `Backfilled from inference event #${row.id}.`,
          row.created_at
        ]
      );

      if (insertResult.rows[0]) {
        inserted.push(insertResult.rows[0]);
      }
    }

    await client.query('COMMIT');

    return {
      dry_run: false,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      candidate_count: candidates.length,
      inserted_count: inserted.length,
      inserted_jobs: inserted
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

backfillAiProcessingJobs(parseArgs(process.argv))
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
