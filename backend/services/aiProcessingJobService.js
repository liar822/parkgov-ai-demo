const crypto = require('crypto');
const db = require('../config/database');

const JOB_STATUSES = ['queued', 'processing', 'completed', 'failed', 'cancelled'];
const JOB_TYPES = ['image', 'video_file', 'dataset_batch', 'manual_demo', 'api_inference'];

class AiProcessingJobService {
  static async ensureAiProcessingJobsTable(client) {
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

  static async resolveParkingContext(client, value) {
    let cameraSource = null;

    if (value.camera_source_id || value.camera_external_id) {
      const cameraResult = await client.query(
        `SELECT *
         FROM camera_sources
         WHERE ($1::INTEGER IS NOT NULL AND id = $1)
            OR ($2::TEXT IS NOT NULL AND camera_external_id = $2)
         LIMIT 1`,
        [value.camera_source_id || null, value.camera_external_id || null]
      );
      cameraSource = cameraResult.rows[0] || null;
    }

    const parkingLotId = value.parking_lot_id || cameraSource?.parking_lot_id || null;
    if (!parkingLotId) {
      return { cameraSource, parkingLot: null };
    }

    const parkingLotResult = await client.query(
      'SELECT id, name FROM parking_lots WHERE id = $1 LIMIT 1',
      [parkingLotId]
    );

    return {
      cameraSource,
      parkingLot: parkingLotResult.rows[0] || null
    };
  }

  static inferProgressForStatus(status, progressPercent) {
    if (Number.isInteger(progressPercent)) {
      return progressPercent;
    }

    switch (status) {
      case 'processing':
        return 10;
      case 'completed':
        return 100;
      case 'failed':
      case 'cancelled':
        return 0;
      case 'queued':
      default:
        return 0;
    }
  }

  static assertKnownStatus(status) {
    if (!JOB_STATUSES.includes(status)) {
      throw new Error(`Unsupported AI processing job status: ${status}`);
    }
  }

  static assertKnownJobType(jobType) {
    if (!JOB_TYPES.includes(jobType)) {
      throw new Error(`Unsupported AI processing job type: ${jobType}`);
    }
  }

  static async createJob(value) {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);

      const { cameraSource, parkingLot } = await AiProcessingJobService.resolveParkingContext(client, value);
      const parkingLotId = value.parking_lot_id || cameraSource?.parking_lot_id || null;
      const cameraSourceId = value.camera_source_id || cameraSource?.id || null;

      if (parkingLotId && !parkingLot) {
        throw new Error('Parking lot not found for AI processing job.');
      }

      if (value.camera_external_id && !cameraSource) {
        throw new Error('Camera source not found for AI processing job.');
      }

      const status = value.status || 'queued';
      AiProcessingJobService.assertKnownStatus(status);

      const jobType = value.job_type || 'api_inference';
      AiProcessingJobService.assertKnownJobType(jobType);

      const progressPercent = AiProcessingJobService.inferProgressForStatus(status, value.progress_percent);
      const nowFields = {
        started_at: ['processing', 'completed'].includes(status) ? new Date() : null,
        completed_at: ['completed', 'failed', 'cancelled'].includes(status) ? new Date() : null
      };

      const result = await client.query(
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
           error_message,
           metadata,
           notes,
           started_at,
           completed_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          value.job_external_id || crypto.randomUUID(),
          parkingLotId,
          cameraSourceId,
          jobType,
          value.input_path || null,
          value.model_name || null,
          status,
          progressPercent,
          value.result_inference_event_id || null,
          value.error_message || null,
          value.metadata ? JSON.stringify(value.metadata) : null,
          value.notes || null,
          nowFields.started_at,
          nowFields.completed_at
        ]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async listJobs(filters = {}) {
    const client = await db.getClient();

    try {
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);

      const params = [];
      const where = [];

      if (filters.status) {
        params.push(filters.status);
        where.push(`jobs.status = $${params.length}`);
      }

      if (filters.parking_lot_id) {
        params.push(filters.parking_lot_id);
        where.push(`jobs.parking_lot_id = $${params.length}`);
      }

      if (filters.camera_source_id) {
        params.push(filters.camera_source_id);
        where.push(`jobs.camera_source_id = $${params.length}`);
      }

      if (filters.job_type) {
        params.push(filters.job_type);
        where.push(`jobs.job_type = $${params.length}`);
      }

      const limit = Math.min(parseInt(filters.limit, 10) || 20, 100);
      params.push(limit);

      const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
      const result = await client.query(
        `SELECT
           jobs.*,
           pl.name AS parking_lot_name,
           cs.camera_external_id,
           cs.name AS camera_name,
           cs.source_kind,
           ie.created_at AS inference_event_created_at,
           ie.total_slots AS inference_total_slots,
           ie.occupied_count AS inference_occupied_count,
           ie.vacant_count AS inference_vacant_count,
           ie.average_confidence AS inference_average_confidence
         FROM ai_processing_jobs jobs
         LEFT JOIN parking_lots pl ON pl.id = jobs.parking_lot_id
         LEFT JOIN camera_sources cs ON cs.id = jobs.camera_source_id
         LEFT JOIN inference_events ie ON ie.id = jobs.result_inference_event_id
         ${whereClause}
         ORDER BY jobs.created_at DESC, jobs.id DESC
         LIMIT $${params.length}`,
        params
      );

      const summaryResult = await client.query(`
        SELECT status, COUNT(*)::INTEGER AS count
        FROM ai_processing_jobs
        GROUP BY status
        ORDER BY status
      `);

      return {
        ai_processing_jobs: result.rows,
        count: result.rows.length,
        summary: summaryResult.rows.reduce((accumulator, row) => {
          accumulator[row.status] = Number(row.count || 0);
          return accumulator;
        }, {})
      };
    } finally {
      client.release();
    }
  }

  static async getJobById(jobId) {
    const client = await db.getClient();

    try {
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);
      const result = await client.query(
        `SELECT
           jobs.*,
           pl.name AS parking_lot_name,
           cs.camera_external_id,
           cs.name AS camera_name,
           cs.source_kind
         FROM ai_processing_jobs jobs
         LEFT JOIN parking_lots pl ON pl.id = jobs.parking_lot_id
         LEFT JOIN camera_sources cs ON cs.id = jobs.camera_source_id
         WHERE jobs.id = $1
         LIMIT 1`,
        [jobId]
      );

      return result.rows[0] || null;
    } finally {
      client.release();
    }
  }

  static async getJobForUpdate(client, jobId) {
    await AiProcessingJobService.ensureAiProcessingJobsTable(client);

    const result = await client.query(
      'SELECT * FROM ai_processing_jobs WHERE id = $1 FOR UPDATE',
      [jobId]
    );
    return result.rows[0] || null;
  }

  static async markProcessingWithClient(client, jobId, fields = {}) {
    const result = await client.query(
      `UPDATE ai_processing_jobs
       SET
         status = 'processing',
         progress_percent = GREATEST(progress_percent, $2),
         model_name = COALESCE($3, model_name),
         input_path = COALESCE($4, input_path),
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [jobId, fields.progress_percent || 10, fields.model_name || null, fields.input_path || null]
    );

    return result.rows[0] || null;
  }

  static async completeWithClient(client, jobId, fields = {}) {
    const result = await client.query(
      `UPDATE ai_processing_jobs
       SET
         status = 'completed',
         progress_percent = 100,
         result_inference_event_id = COALESCE($2, result_inference_event_id),
         metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
         completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [
        jobId,
        fields.result_inference_event_id || null,
        fields.metadata ? JSON.stringify(fields.metadata) : null
      ]
    );

    return result.rows[0] || null;
  }

  static async updateStatus(jobId, value) {
    const client = await db.getClient();

    try {
      await client.query('BEGIN');
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);
      const job = await AiProcessingJobService.getJobForUpdate(client, jobId);

      if (!job) {
        throw new Error('AI processing job not found.');
      }

      const status = value.status || job.status;
      AiProcessingJobService.assertKnownStatus(status);

      const progressPercent = AiProcessingJobService.inferProgressForStatus(status, value.progress_percent);
      const result = await client.query(
        `UPDATE ai_processing_jobs
         SET
           status = $2::TEXT,
           progress_percent = $3,
           result_inference_event_id = COALESCE($4, result_inference_event_id),
           error_message = $5,
           metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($6::jsonb, '{}'::jsonb),
           started_at = CASE
             WHEN $2::TEXT IN ('processing', 'completed') THEN COALESCE(started_at, CURRENT_TIMESTAMP)
             ELSE started_at
           END,
           completed_at = CASE
             WHEN $2::TEXT IN ('completed', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP
             ELSE completed_at
           END,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [
          jobId,
          status,
          progressPercent,
          value.result_inference_event_id || null,
          value.error_message || null,
          value.metadata ? JSON.stringify(value.metadata) : null
        ]
      );

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  static async markFailed(jobId, errorMessage) {
    const client = await db.getClient();

    try {
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);
      const result = await client.query(
        `UPDATE ai_processing_jobs
         SET
           status = 'failed',
           error_message = $2,
           metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND status NOT IN ('completed', 'cancelled')
         RETURNING *`,
        [
          jobId,
          errorMessage,
          JSON.stringify({ failed_at: new Date().toISOString() })
        ]
      );

      return result.rows[0] || null;
    } catch (error) {
      console.error('Failed to mark AI processing job as failed:', error.message);
      return null;
    } finally {
      client.release();
    }
  }
}

module.exports = AiProcessingJobService;
