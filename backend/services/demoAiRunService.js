const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const AiProcessingJobService = require('./aiProcessingJobService');
const InferenceEventService = require('./inferenceEventService');
const ParkingSlotRoiService = require('./parkingSlotRoiService');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_DEMO_PAYLOAD = path.join(PROJECT_ROOT, 'data', 'acpds_first_round_inference_event_demo.json');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeDetection(detection) {
  return {
    slot_id: detection.slot_id,
    slot_number: detection.slot_number,
    is_occupied: detection.is_occupied,
    confidence: detection.confidence,
    predicted_vacancy_seconds: detection.predicted_vacancy_seconds ?? detection.predicted_duration ?? 0
  };
}

class DemoAiRunService {
  static resolvePayloadPath(inputPath) {
    if (!inputPath) {
      return DEFAULT_DEMO_PAYLOAD;
    }

    const directPath = path.resolve(process.cwd(), inputPath);
    if (fs.existsSync(directPath)) {
      return directPath;
    }

    const projectPath = path.resolve(PROJECT_ROOT, inputPath.replace(/^(\.\.\/)+/, ''));
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }

    return directPath;
  }

  static async summarizeReadiness(payload) {
    const client = await db.getClient();

    try {
      await InferenceEventService.ensureInferenceEventsTable(client);
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);
      await ParkingSlotRoiService.ensureParkingSlotRoisTable(client);

      const { cameraSource, parkingLot } = await InferenceEventService.resolveParkingContext(client, payload);
      const slotCount = await client.query(
        'SELECT COUNT(*)::INTEGER AS count FROM parking_slots WHERE parking_lot_id = $1',
        [parkingLot.id]
      );
      const roiCount = await client.query(
        `SELECT COUNT(DISTINCT parking_slot_id)::INTEGER AS count
         FROM parking_slot_rois
         WHERE parking_lot_id = $1 AND is_active = true`,
        [parkingLot.id]
      );

      return {
        parking_lot_id: parkingLot.id,
        parking_lot_name: parkingLot.name,
        camera_source_id: cameraSource?.id || null,
        camera_external_id: cameraSource?.camera_external_id || payload.camera_external_id || null,
        slots_in_database: Number(slotCount.rows[0]?.count || 0),
        rois_in_database: Number(roiCount.rows[0]?.count || 0),
        detections_in_payload: payload.detections?.length || 0
      };
    } finally {
      client.release();
    }
  }

  static async runFromPayloadFile(options = {}) {
    const payloadPath = DemoAiRunService.resolvePayloadPath(options.inputPath);
    const payload = readJsonFile(payloadPath);
    const readiness = await DemoAiRunService.summarizeReadiness(payload);
    const detections = (payload.detections || []).map(normalizeDetection);

    if (options.dryRun) {
      return {
        dry_run: true,
        input_file: payloadPath,
        readiness,
        would_create_ai_processing_job: true,
        would_write_inference_event: true,
        model_name: payload.model_name,
        input_path: payload.input_path,
        detections: detections.length,
        notes: [
          'Dry run only; database was not changed.',
          'This is a public dataset/sample replay, not a live Beijing camera feed.'
        ]
      };
    }

    const job = await AiProcessingJobService.createJob({
      parking_lot_id: readiness.parking_lot_id,
      camera_external_id: payload.camera_external_id,
      job_type: 'dataset_batch',
      input_path: payload.input_path || payloadPath,
      model_name: payload.model_name || 'acpds_slot_cnn_first_round',
      status: 'queued',
      metadata: {
        source: 'demo_ai_run',
        payload_file: path.relative(PROJECT_ROOT, payloadPath),
        parking_lot_source_id: payload.parking_lot_source_id || null,
        detections_in_payload: detections.length
      },
      notes: 'Replay of a public dataset/sample inference JSON for MVP demo verification. Not a live camera connection.'
    });

    const recorded = await InferenceEventService.recordInferenceEvent({
      ...payload,
      detections,
      processing_job_id: job.id,
      notes: payload.notes || 'Replay of public dataset/sample inference JSON for MVP demo verification.'
    });

    return {
      dry_run: false,
      input_file: payloadPath,
      readiness,
      ai_processing_job: recorded.processing_job,
      inference_event: recorded.inference_event,
      parking_lot: recorded.parking_lot,
      summary: recorded.summary,
      updated_slots: recorded.updated_slots.length,
      notes: [
        'Demo AI run completed through ai_processing_jobs -> inference_events -> parking_slots.',
        'This does not claim real Beijing-wide camera access.'
      ]
    };
  }

  static async rerunJob(jobId) {
    const sourceJob = await AiProcessingJobService.getJobById(jobId);
    if (!sourceJob) {
      const error = new Error('AI processing job not found.');
      error.statusCode = 404;
      throw error;
    }

    if (!sourceJob.result_inference_event_id) {
      const error = new Error('Only jobs with a result inference event can be rerun in demo mode.');
      error.statusCode = 400;
      throw error;
    }

    const client = await db.getClient();
    let sourceEvent;

    try {
      await InferenceEventService.ensureInferenceEventsTable(client);
      const result = await client.query(
        'SELECT * FROM inference_events WHERE id = $1 LIMIT 1',
        [sourceJob.result_inference_event_id]
      );
      sourceEvent = result.rows[0] || null;
    } finally {
      client.release();
    }

    if (!sourceEvent) {
      const error = new Error('Result inference event was not found for this AI processing job.');
      error.statusCode = 404;
      throw error;
    }

    const sourcePayload = sourceEvent.result_payload || {};
    const detections = (sourcePayload.detections || []).map(normalizeDetection);
    if (detections.length === 0) {
      const error = new Error('Result inference event does not contain reusable slot detections.');
      error.statusCode = 400;
      throw error;
    }

    const job = await AiProcessingJobService.createJob({
      parking_lot_id: sourceEvent.parking_lot_id,
      camera_source_id: sourceEvent.camera_source_id,
      job_type: sourceJob.job_type || 'manual_demo',
      input_path: sourceJob.input_path || sourceEvent.input_path,
      model_name: sourceJob.model_name || sourceEvent.model_name,
      status: 'queued',
      metadata: {
        source: 'admin_job_rerun',
        rerun_from_job_id: sourceJob.id,
        rerun_from_inference_event_id: sourceEvent.id,
        detections_in_payload: detections.length
      },
      notes: `Rerun from AI processing job #${sourceJob.id}. Demo-only replay; not a live camera connection.`
    });

    const recorded = await InferenceEventService.recordInferenceEvent({
      parking_lot_id: sourceEvent.parking_lot_id,
      camera_id: sourceEvent.camera_source_id,
      processing_job_id: job.id,
      model_name: sourceEvent.model_name || sourceJob.model_name || 'demo_rerun',
      input_path: sourceEvent.input_path || sourceJob.input_path,
      inference_timestamp: new Date().toISOString(),
      detections,
      notes: `Rerun from AI processing job #${sourceJob.id} and inference event #${sourceEvent.id}. Demo-only replay.`
    });

    return {
      source_job: sourceJob,
      ai_processing_job: recorded.processing_job,
      inference_event: recorded.inference_event,
      parking_lot: recorded.parking_lot,
      summary: recorded.summary,
      updated_slots: recorded.updated_slots.length
    };
  }
}

module.exports = DemoAiRunService;
