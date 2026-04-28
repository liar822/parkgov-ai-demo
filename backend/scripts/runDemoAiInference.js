#!/usr/bin/env node

process.env.SKIP_DB_AUTO_INIT = 'true';

const DemoAiRunService = require('../services/demoAiRunService');
const db = require('../config/database');

function parseArgs(argv) {
  const args = argv.slice(2);
  const inputPath = args.find((arg) => !arg.startsWith('--'));

  return {
    dryRun: args.includes('--dry-run'),
    inputPath
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const result = await DemoAiRunService.runFromPayloadFile(options);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      success: false,
      error: error.message,
      hints: [
        'Run npm run seed:mvp first if parking lots, camera sources, or ROI rows are missing.',
        'This command replays demo/public-dataset JSON only; it does not connect to a live camera.'
      ]
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
