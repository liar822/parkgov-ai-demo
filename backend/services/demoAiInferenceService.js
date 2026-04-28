const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('../config/database');
const AiProcessingJobService = require('./aiProcessingJobService');
const InferenceEventService = require('./inferenceEventService');
const ParkingSlotRoiService = require('./parkingSlotRoiService');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PRIMARY_ROOT = path.resolve(__dirname, '..', '..');
const AI_ROOT = path.join(PRIMARY_ROOT, 'ai-services');
const DEFAULT_CONFIG = path.join(PROJECT_ROOT, 'data', 'demo_ai_inference_config.json');

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveProjectPath(inputPath, fallbackPath = DEFAULT_CONFIG) {
  if (!inputPath) {
    return fallbackPath;
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

function resolvePythonExecutable() {
  const configured = process.env.AI_SERVICES_PYTHON || process.env.PYTHON;
  if (configured) {
    return configured;
  }

  const venvPython = path.join(AI_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  return 'python3';
}

function parsePythonJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    throw new Error('Python inference script did not return JSON output.');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
    throw error;
  }
}

function normalizeDetection(detection) {
  return {
    slot_id: detection.slot_id,
    slot_number: detection.slot_number,
    is_occupied: detection.is_occupied,
    confidence: detection.confidence,
    predicted_vacancy_seconds: detection.predicted_vacancy_seconds ?? 0
  };
}

class DemoAiInferenceService {
  static async loadContext(configPath) {
    const config = readJsonFile(configPath);
    const client = await db.getClient();

    try {
      await InferenceEventService.ensureInferenceEventsTable(client);
      await AiProcessingJobService.ensureAiProcessingJobsTable(client);
      await ParkingSlotRoiService.ensureParkingSlotRoisTable(client);

      const lotResult = await client.query(
        `SELECT *
         FROM parking_lots
         WHERE slot_configuration->'metadata'->>'source_external_id' = $1
            OR name = $2
         LIMIT 1`,
        [config.parking_lot_source_id || null, config.parking_lot_name || null]
      );
      const parkingLot = lotResult.rows[0] || null;
      if (!parkingLot) {
        throw new Error(`Demo parking lot was not found. Run npm run seed:mvp first. source_id=${config.parking_lot_source_id}`);
      }

      const cameraResult = await client.query(
        `SELECT *
         FROM camera_sources
         WHERE camera_external_id = $1
            OR (parking_lot_id = $2 AND source_kind = $3)
         ORDER BY CASE WHEN camera_external_id = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [config.camera_external_id || null, parkingLot.id, config.mode || 'image']
      );
      const cameraSource = cameraResult.rows[0] || null;
      if (!cameraSource && config.camera_external_id) {
        throw new Error(`Demo camera source was not found. Run npm run seed:mvp first. camera=${config.camera_external_id}`);
      }

      const rois = await ParkingSlotRoiService.listActiveRoisForLot(client, {
        parkingLotId: parkingLot.id,
        cameraExternalId: config.camera_external_id,
        roiVersion: config.roi_version || 'demo_v1'
      });

      if (rois.length === 0) {
        throw new Error(`No active ROI rows found for ${parkingLot.name}. Run npm run seed:mvp or npm run import:slot-rois.`);
      }

      return {
        config,
        parkingLot,
        cameraSource,
        rois: rois.map((roi) => ({
          slot_id: roi.parking_slot_id,
          slot_number: roi.slot_number,
          x: Number(roi.x),
          y: Number(roi.y),
          width: Number(roi.width),
          height: Number(roi.height),
          coordinate_space: roi.coordinate_space || 'pixel',
          frame_width: roi.frame_width,
          frame_height: roi.frame_height,
          roi_version: roi.roi_version,
          camera_external_id: roi.camera_external_id || config.camera_external_id || null
        })),
        readiness: {
          parking_lot_id: parkingLot.id,
          parking_lot_name: parkingLot.name,
          camera_source_id: cameraSource?.id || null,
          camera_external_id: cameraSource?.camera_external_id || config.camera_external_id || null,
          roi_count: rois.length,
          mode: config.mode || 'image',
          input_path: config.input_path,
          checkpoint_path: config.checkpoint_path,
          model_name: config.model_name
        }
      };
    } finally {
      client.release();
    }
  }

  static writeTemporaryRoiJson(context) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'park-gov-rois-'));
    const roiJsonPath = path.join(tempDir, 'roi_payload.json');
    const payload = {
      parking_lot_id: context.parkingLot.id,
      parking_lot_source_id: context.config.parking_lot_source_id,
      camera_external_id: context.config.camera_external_id,
      roi_version: context.config.roi_version || 'demo_v1',
      rois: context.rois
    };

    fs.writeFileSync(roiJsonPath, JSON.stringify(payload, null, 2), 'utf8');
    return roiJsonPath;
  }

  static runPythonInference({ configPath, roiJsonPath, dryRun = false }) {
    const pythonBin = resolvePythonExecutable();
    const scriptPath = path.join(AI_ROOT, 'scripts', 'run_roi_inference.py');
    const args = [
      scriptPath,
      '--config',
      configPath,
      '--roi-json',
      roiJsonPath
    ];
    if (dryRun) {
      args.push('--dry-run');
    }

    const result = spawnSync(pythonBin, args, {
      cwd: AI_ROOT,
      env: {
        ...process.env,
        PYTHONPATH: [path.join(AI_ROOT, 'scripts'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)
      },
      encoding: 'utf8',
      timeout: 5 * 60 * 1000
    });

    if (result.error) {
      throw new Error(`Unable to run Python inference: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const stderr = String(result.stderr || '').trim();
      const stdout = String(result.stdout || '').trim();
      throw new Error(`Python inference failed: ${stderr || stdout || `exit ${result.status}`}`);
    }

    return parsePythonJson(result.stdout);
  }

  static async run(options = {}) {
    const configPath = resolveProjectPath(options.configPath);
    const context = await DemoAiInferenceService.loadContext(configPath);
    const roiJsonPath = DemoAiInferenceService.writeTemporaryRoiJson(context);

    if (options.dryRun) {
      const pythonCheck = DemoAiInferenceService.runPythonInference({
        configPath,
        roiJsonPath,
        dryRun: true
      });

      return {
        dry_run: true,
        config_file: path.relative(PROJECT_ROOT, configPath),
        readiness: context.readiness,
        python_check: pythonCheck,
        would_create_ai_processing_job: true,
        would_write_inference_event: true,
        notes: [
          'Dry run only; database was not changed.',
          'This validates the automatic ROI model inference path for public dataset/sample input.'
        ]
      };
    }

    const job = await AiProcessingJobService.createJob({
      parking_lot_id: context.parkingLot.id,
      camera_source_id: context.cameraSource?.id || null,
      job_type: 'dataset_batch',
      input_path: context.config.input_path,
      model_name: context.config.model_name || 'roi_slot_classifier',
      status: 'queued',
      metadata: {
        source: 'demo_ai_model_infer',
        config_file: path.relative(PROJECT_ROOT, configPath),
        roi_count: context.rois.length,
        mode: context.config.mode || 'image',
        input_source: context.config.input_path,
        checkpoint_path: context.config.checkpoint_path
      },
      notes: 'Automatic ROI model inference on a public dataset/sample file. Not a live camera connection.'
    });

    try {
      const payload = DemoAiInferenceService.runPythonInference({
        configPath,
        roiJsonPath,
        dryRun: false
      });
      const detections = (payload.detections || []).map(normalizeDetection);

      const recorded = await InferenceEventService.recordInferenceEvent({
        ...payload,
        detections,
        processing_job_id: job.id,
        notes: payload.notes || context.config.notes || 'Automatic ROI model inference demo.'
      });

      return {
        dry_run: false,
        config_file: path.relative(PROJECT_ROOT, configPath),
        readiness: context.readiness,
        ai_processing_job: recorded.processing_job,
        inference_event: recorded.inference_event,
        parking_lot: recorded.parking_lot,
        summary: recorded.summary,
        diagnostics: payload.diagnostics || {},
        updated_slots: recorded.updated_slots.length,
        notes: [
          'Automatic ROI model inference completed through model -> JSON -> ai_processing_jobs -> inference_events -> parking_slots.',
          'This is a public dataset/sample validation path, not real Beijing-wide camera access.'
        ]
      };
    } catch (error) {
      await AiProcessingJobService.markFailed(job.id, error.message);
      throw error;
    }
  }
}

module.exports = DemoAiInferenceService;
