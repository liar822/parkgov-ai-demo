const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PRIMARY_ROOT = path.resolve(__dirname, '..', '..');
const AI_ROOT = path.join(PRIMARY_ROOT, 'ai-services');
const REGISTRY_PATH = path.join(WORKSPACE_ROOT, 'data', 'ai_vision_dataset_registry.csv');

const datasetDownloads = {
  cnrpark_ext: {
    dataset: 'cnrpark_ext',
    sourceKey: 'cnrpark_ext',
    url: 'https://github.com/fabiocarrara/deep-parking/releases/download/archive/CNR-EXT-Patches-150x150.zip',
    targetPath: path.join(WORKSPACE_ROOT, 'datasets', 'raw', 'cnrpark_ext', 'CNR-EXT-Patches-150x150.zip'),
    expectedSizeBytes: 449.5 * 1024 * 1024,
    license: 'ODbL v1.0 per official CNRPark+EXT page',
    citation: 'Amato et al., Deep learning for decentralized parking lot occupancy detection, Expert Systems with Applications, 2017',
  },
  cnrpark_metadata: {
    dataset: 'cnrpark_metadata',
    sourceKey: 'cnrpark_ext',
    url: 'https://github.com/fabiocarrara/deep-parking/releases/download/archive/CNRPark+EXT.csv',
    targetPath: path.join(WORKSPACE_ROOT, 'datasets', 'raw', 'cnrpark_ext', 'CNRPark+EXT.csv'),
    expectedSizeBytes: 18.1 * 1024 * 1024,
    license: 'ODbL v1.0 per official CNRPark+EXT page',
    citation: 'CNRPark+EXT metadata CSV',
  },
};

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(content) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] || '');
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

function readRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error(`AI vision dataset registry not found: ${REGISTRY_PATH}`);
  }
  return parseCsv(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function fileStatus(filePath) {
  if (!filePath) {
    return { exists: false, sizeBytes: 0, size: '0 B' };
  }
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(WORKSPACE_ROOT, filePath);
  if (!fs.existsSync(absolutePath)) {
    return { exists: false, path: absolutePath, sizeBytes: 0, size: '0 B' };
  }
  const stats = fs.statSync(absolutePath);
  return {
    exists: true,
    path: absolutePath,
    sizeBytes: stats.size,
    size: formatBytes(stats.size),
    modifiedAt: stats.mtime.toISOString(),
  };
}

module.exports = {
  AI_ROOT,
  PRIMARY_ROOT,
  WORKSPACE_ROOT,
  REGISTRY_PATH,
  datasetDownloads,
  fileStatus,
  formatBytes,
  readRegistry,
};
