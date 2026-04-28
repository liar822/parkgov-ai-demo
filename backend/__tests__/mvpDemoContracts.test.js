const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(backendRoot, '..', '..', '..');

describe('MVP AI demo contracts', () => {
  test('package exposes demo AI and safe reset commands', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts['demo:ai-run']).toBe('node scripts/runDemoAiInference.js');
    expect(packageJson.scripts['demo:ai-infer']).toBe('node scripts/runDemoAiModelInference.js');
    expect(packageJson.scripts['demo:ai-infer:cnr']).toContain('demo_ai_inference_config_cnrpark.json');
    expect(packageJson.scripts['demo:ai-infer:campus-synthetic']).toContain('demo_ai_inference_config_campus_synthetic.json');
    expect(packageJson.scripts['demo:reset']).toBe('node scripts/resetDemoData.js');
    expect(packageJson.scripts['backfill:ai-jobs']).toBe('node scripts/backfillAiProcessingJobs.js');
  });

  test('database init SQL contains normalized ROI table', () => {
    const initSql = fs.readFileSync(path.join(backendRoot, '..', 'database', 'init.sql'), 'utf8');

    expect(initSql).toContain('CREATE TABLE IF NOT EXISTS parking_slot_rois');
    expect(initSql).toContain('idx_parking_slot_rois_lot');
  });

  test('demo AI payload remains a bounded public-dataset replay', () => {
    const payload = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'data', 'acpds_first_round_inference_event_demo.json'), 'utf8')
    );

    expect(payload.camera_external_id).toBe('CAMERA_ACPDS_DEMO_001');
    expect(payload.parking_lot_source_id).toBe('ACPDS_PUBLIC_DATASET_DEMO_001');
    expect(payload.detections.length).toBeGreaterThan(0);
    expect(payload.notes).toContain('不代表北京或校园真实摄像头接入');
  });

  test('demo reset script keeps destructive execution behind confirmation', () => {
    const resetScript = fs.readFileSync(path.join(backendRoot, 'scripts', 'resetDemoData.js'), 'utf8');

    expect(resetScript).toContain('Refusing to reset demo data without --confirm');
    expect(resetScript).toContain('options.dryRun');
    expect(resetScript).toContain('options.confirm');
  });
});
