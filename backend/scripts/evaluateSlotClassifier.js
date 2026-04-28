#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');
const { AI_ROOT } = require('./visionDatasetUtils');

const args = process.argv.slice(2);
if (!args.includes('--mode')) {
  args.push('--mode', 'evaluate');
}

const result = spawnSync(process.execPath, [path.join(__dirname, 'runSlotClassifierTraining.js'), ...args], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(JSON.stringify({
    success: false,
    error: result.error.message,
    ai_root: AI_ROOT,
  }, null, 2));
  process.exitCode = 1;
} else {
  process.exitCode = result.status || 0;
}
