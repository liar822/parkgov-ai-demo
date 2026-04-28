#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { datasetDownloads, fileStatus, formatBytes } = require('./visionDatasetUtils');

function parseArgs(argv) {
  const options = {
    dataset: null,
    dryRun: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dataset') {
      options.dataset = argv[index + 1];
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    }
  }

  if (!options.dataset) {
    throw new Error(`Usage: npm run dataset:download -- --dataset <${Object.keys(datasetDownloads).join('|')}> [--dry-run] [--force]`);
  }

  return options;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

function downloadFile(url, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.download`;
  const args = [
    '--location',
    '--fail',
    '--retry',
    '3',
    '--retry-delay',
    '2',
    '--continue-at',
    '-',
    '--user-agent',
    'ParkGov-AI-Challenge-Cup-MVP/1.0',
    '--output',
    tempPath,
    url,
  ];
  const result = spawnSync('curl', args, {
    stdio: 'inherit',
    timeout: 60 * 60 * 1000,
  });
  if (result.error) {
    throw new Error(`curl failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`curl exited with code ${result.status}`);
  }
  fs.renameSync(tempPath, targetPath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = datasetDownloads[options.dataset];
  if (!config) {
    throw new Error(`Unknown dataset download key: ${options.dataset}`);
  }

  const before = fileStatus(config.targetPath);
  const summary = {
    dataset: config.dataset,
    url: config.url,
    target_path: config.targetPath,
    expected_size: formatBytes(config.expectedSizeBytes),
    license: config.license,
    citation: config.citation,
    already_exists: before.exists,
    current_size: before.size,
  };

  if (options.dryRun) {
    console.log(JSON.stringify({
      success: true,
      dry_run: true,
      action: before.exists && !options.force ? 'skip_existing' : 'download',
      ...summary,
    }, null, 2));
    return;
  }

  if (before.exists && !options.force) {
    console.log(JSON.stringify({
      success: true,
      skipped: true,
      reason: 'target file already exists; pass --force to re-download',
      ...summary,
    }, null, 2));
    return;
  }

  downloadFile(config.url, config.targetPath);
  const after = fileStatus(config.targetPath);
  const checksum = sha256File(config.targetPath);

  console.log(JSON.stringify({
    success: true,
    downloaded: true,
    ...summary,
    final_size: after.size,
    final_size_bytes: after.sizeBytes,
    sha256: checksum,
    note: 'Large dataset files are for local research/training and should not be committed to Git.',
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error.message,
    hint: 'Check network access and the official dataset release URL. This command does not connect to live cameras.',
  }, null, 2));
  process.exitCode = 1;
});
