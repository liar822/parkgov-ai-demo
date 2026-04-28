#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { AI_ROOT, WORKSPACE_ROOT } = require('./visionDatasetUtils');

const defaultArchives = {
  acpds: path.join(WORKSPACE_ROOT, 'datasets', 'raw', 'acpds', 'rois_gopro.zip'),
  cnrpark_ext: path.join(WORKSPACE_ROOT, 'datasets', 'raw', 'cnrpark_ext', 'CNR-EXT-Patches-150x150.zip'),
};

function parseArgs(argv) {
  const options = {
    dataset: null,
    archive: null,
    outputDir: null,
    checkpoint: null,
    mode: 'train',
    passthrough: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dataset') {
      options.dataset = argv[index + 1];
      index += 1;
    } else if (arg === '--archive') {
      options.archive = argv[index + 1];
      index += 1;
    } else if (arg === '--output-dir') {
      options.outputDir = argv[index + 1];
      index += 1;
    } else if (arg === '--checkpoint') {
      options.checkpoint = argv[index + 1];
      index += 1;
    } else if (arg === '--mode') {
      options.mode = argv[index + 1];
      index += 1;
    } else {
      options.passthrough.push(arg);
    }
  }

  if (!options.dataset) {
    throw new Error('Usage: npm run train:slot-classifier -- --dataset <acpds|cnrpark_ext> [--epochs 3] [--max-samples 2000]');
  }
  return options;
}

function resolvePythonExecutable() {
  const configured = process.env.AI_SERVICES_PYTHON || process.env.PYTHON;
  if (configured) return configured;
  const venvPython = path.join(AI_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;
  return 'python3';
}

function run(options) {
  const archive = options.archive || defaultArchives[options.dataset];
  if (!archive || !fs.existsSync(archive)) {
    throw new Error(`Dataset archive not found for ${options.dataset}: ${archive}. Run npm run dataset:download first or pass --archive.`);
  }

  const outputDir = options.outputDir || path.join(AI_ROOT, 'training_runs', `${options.dataset}_${options.mode}_${new Date().toISOString().slice(0, 10)}`);
  const args = [
    path.join(AI_ROOT, 'scripts', 'train_slot_classifier.py'),
    '--dataset',
    options.dataset,
    '--archive',
    archive,
    '--output-dir',
    outputDir,
    '--mode',
    options.mode,
    ...options.passthrough,
  ];

  if (!options.passthrough.includes('--device')) {
    args.push('--device', 'cpu');
  }

  if (options.checkpoint) {
    args.push('--checkpoint', options.checkpoint);
  }

  const result = spawnSync(resolvePythonExecutable(), args, {
    cwd: AI_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      PYTHONPATH: [path.join(AI_ROOT, 'scripts'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    },
    timeout: 60 * 60 * 1000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Training command failed with exit code ${result.status}${result.signal ? `, signal ${result.signal}` : ''}`);
  }
}

try {
  run(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error.message,
    hints: [
      'Run npm run dataset:registry to see available archives.',
      'Run npm run dataset:download -- --dataset cnrpark_ext before CNRPark+EXT training.',
      'Use --max-samples 2000 --epochs 1 for a fast smoke test.',
    ],
  }, null, 2));
  process.exitCode = 1;
}
