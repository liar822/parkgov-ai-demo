const db = require('../config/database');
const AiProcessingJobService = require('./aiProcessingJobService');

class InferenceEventService {
  static async ensureInferenceEventsTable(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS inference_events (
        id SERIAL PRIMARY KEY,
        camera_source_id INTEGER REFERENCES camera_sources(id) ON DELETE SET NULL,
        parking_lot_id INTEGER REFERENCES parking_lots(id) ON DELETE CASCADE,
        model_name VARCHAR(100),
        input_path TEXT,
        total_slots INTEGER DEFAULT 0,
        occupied_count INTEGER DEFAULT 0,
        vacant_count INTEGER DEFAULT 0,
        average_confidence DECIMAL(5,4),
        result_payload JSONB,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_inference_events_camera_id ON inference_events(camera_source_id);
      CREATE INDEX IF NOT EXISTS idx_inference_events_lot_id ON inference_events(parking_lot_id);
      CREATE INDEX IF NOT EXISTS idx_inference_events_created ON inference_events(created_at);
    `);
  }

  static async resolveParkingContext(client, payload) {
    let cameraSource = null;

    if (payload.camera_id || payload.camera_external_id) {
      const cameraResult = await client.query(
        `SELECT * FROM camera_sources
         WHERE ($1::INTEGER IS NOT NULL AND id = $1)
            OR ($2::TEXT IS NOT NULL AND camera_external_id = $2)
         LIMIT 1`,
        [payload.camera_id || null, payload.camera_external_id || null]
      );
      cameraSource = cameraResult.rows[0] || null;
    }

    let parkingLotId = payload.parking_lot_id || cameraSource?.parking_lot_id || null;

    if (!parkingLotId && payload.parking_lot_source_id) {
      const lotResult = await client.query(
        `SELECT id FROM parking_lots
         WHERE slot_configuration->'metadata'->>'source_external_id' = $1
         LIMIT 1`,
        [payload.parking_lot_source_id]
      );
      parkingLotId = lotResult.rows[0]?.id || null;
    }

    if (!parkingLotId) {
      throw new Error('Unable to resolve parking_lot_id from camera or parking_lot_source_id.');
    }

    const parkingLot = await client.query('SELECT id, name FROM parking_lots WHERE id = $1', [parkingLotId]);
    if (parkingLot.rows.length === 0) {
      throw new Error('Parking lot not found for inference result.');
    }

    return {
      cameraSource,
      parkingLot: parkingLot.rows[0]
    };
  }

  static buildPayloadFromAnalysisResults(analysisResults, options = {}) {
    const standardResult = analysisResults?.standard_inference_result || {};
    const sourceDetections = standardResult.detections || analysisResults?.slot_detections || [];
    const detections = sourceDetections
      .filter((detection) => detection && typeof detection.is_occupied === 'boolean')
      .map((detection) => ({
        slot_id: detection.slot_id,
        slot_number: detection.slot_number,
        is_occupied: detection.is_occupied,
        confidence: detection.confidence,
        predicted_vacancy_seconds:
          detection.predicted_vacancy_seconds ?? detection.predicted_duration ?? 0
      }));

    return {
      camera_id: standardResult.camera_id || options.cameraId,
      camera_external_id: standardResult.camera_external_id || options.cameraExternalId,
      parking_lot_id: standardResult.parking_lot_id || options.parkingLotId,
      parking_lot_source_id: standardResult.parking_lot_source_id || options.parkingLotSourceId,
      processing_job_id: standardResult.processing_job_id || options.processingJobId,
      model_name: standardResult.model_name || options.modelName || 'yolov8_parking_slot',
      input_path: standardResult.input_path || options.inputPath || analysisResults?.video_filename,
      inference_timestamp: standardResult.inference_timestamp || analysisResults?.timestamp || new Date().toISOString(),
      detections,
      notes: standardResult.notes || options.notes || 'Generated from video analysis pipeline.'
    };
  }

  static async recordInferenceEvent(payload, io = null) {
    if (!payload?.detections?.length) {
      throw new Error('Inference payload must include at least one detection.');
    }

    const client = await db.getClient();
    let completedProcessingJob = null;

    try {
      await client.query('BEGIN');
      await InferenceEventService.ensureInferenceEventsTable(client);
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);

      const { cameraSource, parkingLot } = await InferenceEventService.resolveParkingContext(client, payload);

      let processingJob = null;
      if (payload.processing_job_id) {
        processingJob = await AiProcessingJobService.getJobForUpdate(client, payload.processing_job_id);

        if (!processingJob) {
          throw new Error('AI processing job not found for inference result.');
        }

        if (['completed', 'cancelled'].includes(processingJob.status)) {
          throw new Error(`AI processing job is already ${processingJob.status}.`);
        }

        if (processingJob.parking_lot_id && Number(processingJob.parking_lot_id) !== Number(parkingLot.id)) {
          throw new Error('AI processing job parking lot does not match inference result.');
        }

        if (
          processingJob.camera_source_id &&
          cameraSource?.id &&
          Number(processingJob.camera_source_id) !== Number(cameraSource.id)
        ) {
          throw new Error('AI processing job camera source does not match inference result.');
        }

        processingJob = await AiProcessingJobService.markProcessingWithClient(client, processingJob.id, {
          progress_percent: 80,
          model_name: payload.model_name || processingJob.model_name,
          input_path: payload.input_path || processingJob.input_path
        });
      }

      const slotsResult = await client.query(
        'SELECT id, slot_number FROM parking_slots WHERE parking_lot_id = $1',
        [parkingLot.id]
      );
      const slotsById = new Map(slotsResult.rows.map((slot) => [Number(slot.id), slot]));
      const slotsByNumber = new Map(slotsResult.rows.map((slot) => [Number(slot.slot_number), slot]));

      const slotUpdates = [];
      const invalidDetections = [];

      for (const detection of payload.detections) {
        const matchedSlot = detection.slot_id
          ? slotsById.get(Number(detection.slot_id))
          : slotsByNumber.get(Number(detection.slot_number));

        if (!matchedSlot) {
          invalidDetections.push(detection.slot_id || detection.slot_number);
          continue;
        }

        slotUpdates.push({
          slot_id: matchedSlot.id,
          slot_number: matchedSlot.slot_number,
          is_occupied: detection.is_occupied,
          confidence: detection.confidence ?? null,
          predicted_vacancy_seconds: detection.predicted_vacancy_seconds || 0
        });
      }

      if (invalidDetections.length > 0) {
        throw new Error(`Some detections do not match slots in this parking lot: ${invalidDetections.join(', ')}`);
      }

      const updatedSlots = [];
      for (const update of slotUpdates) {
        const updateResult = await client.query(
          `UPDATE parking_slots
           SET
             is_occupied = $1,
             last_status_change = CASE
               WHEN is_occupied != $1 THEN CURRENT_TIMESTAMP
               ELSE last_status_change
             END,
             current_duration = CASE
               WHEN $1 = true AND is_occupied = false THEN 0
               WHEN $1 = false THEN 0
               ELSE current_duration
             END,
             predicted_vacancy_seconds = $2,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $3 AND parking_lot_id = $4
           RETURNING *`,
          [update.is_occupied, update.predicted_vacancy_seconds, update.slot_id, parkingLot.id]
        );

        if (updateResult.rows[0]) {
          updatedSlots.push(updateResult.rows[0]);
        }
      }

      const confidenceValues = slotUpdates
        .map((update) => update.confidence)
        .filter((confidence) => typeof confidence === 'number');
      const occupiedCount = slotUpdates.filter((update) => update.is_occupied).length;
      const totalSlots = slotUpdates.length;
      const averageConfidence = confidenceValues.length > 0
        ? confidenceValues.reduce((sum, confidence) => sum + confidence, 0) / confidenceValues.length
        : null;

      const resultPayload = {
        camera_external_id: payload.camera_external_id || cameraSource?.camera_external_id || null,
        parking_lot_id: parkingLot.id,
        parking_lot_name: parkingLot.name,
        inference_timestamp: payload.inference_timestamp || new Date().toISOString(),
        detections: slotUpdates
      };

      const eventResult = await client.query(
        `INSERT INTO inference_events (
           camera_source_id,
           parking_lot_id,
           model_name,
           input_path,
           total_slots,
           occupied_count,
           vacant_count,
           average_confidence,
           result_payload,
           notes
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          cameraSource?.id || null,
          parkingLot.id,
          payload.model_name || 'unknown',
          payload.input_path || null,
          totalSlots,
          occupiedCount,
          totalSlots - occupiedCount,
          averageConfidence,
          JSON.stringify(resultPayload),
          payload.notes || null
        ]
      );

      if (processingJob) {
        completedProcessingJob = await AiProcessingJobService.completeWithClient(client, processingJob.id, {
          result_inference_event_id: eventResult.rows[0].id,
          metadata: {
            total_slots: totalSlots,
            occupied_count: occupiedCount,
            vacant_count: totalSlots - occupiedCount,
            average_confidence: averageConfidence,
            completed_from: 'inference_event'
          }
        });
      }

      await client.query('COMMIT');

      if (io) {
        updatedSlots.forEach((slot) => {
          io.to(`parking-lot-${slot.parking_lot_id}`).emit('slot-status-changed', {
            slot_id: slot.id,
            slot_number: slot.slot_number,
            is_occupied: slot.is_occupied,
            predicted_vacancy_seconds: slot.predicted_vacancy_seconds,
            timestamp: new Date().toISOString(),
            source: 'inference_event'
          });
        });

        io.to(`parking-lot-${parkingLot.id}`).emit('inference-event-created', {
          inference_event_id: eventResult.rows[0].id,
          parking_lot_id: parkingLot.id,
          total_slots: totalSlots,
          occupied_count: occupiedCount,
          vacant_count: totalSlots - occupiedCount,
          timestamp: new Date().toISOString()
        });
      }

      return {
        inference_event: eventResult.rows[0],
        processing_job: completedProcessingJob,
        parking_lot: parkingLot,
        updated_slots: updatedSlots,
        summary: {
          total_slots: totalSlots,
          occupied_count: occupiedCount,
          vacant_count: totalSlots - occupiedCount,
          average_confidence: averageConfidence
        }
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (payload.processing_job_id) {
        await AiProcessingJobService.markFailed(payload.processing_job_id, error.message);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = InferenceEventService;
