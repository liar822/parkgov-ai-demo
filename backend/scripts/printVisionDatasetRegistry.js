#!/usr/bin/env node

const { datasetDownloads, fileStatus, formatBytes, readRegistry } = require('./visionDatasetUtils');

function main() {
  const rows = readRegistry().map((row) => {
    const status = fileStatus(row.local_path);
    const download = Object.values(datasetDownloads).find((item) => item.sourceKey === row.source_key);
    return {
      priority: row.priority,
      source_key: row.source_key,
      name: row.name,
      task_type: row.task_type,
      license_status: row.license_status,
      access_status: row.access_status,
      local_path: row.local_path || '',
      file_exists: status.exists,
      file_size: status.size,
      expected_download: download ? formatBytes(download.expectedSizeBytes) : '',
      next_step: row.next_step,
      source_url: row.source_url,
    };
  });

  console.log(JSON.stringify({
    success: true,
    generated_at: new Date().toISOString(),
    count: rows.length,
    datasets: rows,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    success: false,
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
}
