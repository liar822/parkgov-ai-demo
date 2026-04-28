#!/usr/bin/env node
process.env.SKIP_DB_AUTO_INIT = 'true';

const db = require('../config/database');
const DemoAiInferenceService = require('../services/demoAiInferenceService');

function parseArgs(argv) {
  const options = {
    dryRun: false,
    configPath: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--config') {
      options.configPath = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await DemoAiInferenceService.run(options);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      success: false,
      error: error.message,
      hints: [
        'Run npm run seed:mvp first to create demo parking lot, camera source, slots and ROIs.',
        'Check ai-services/.venv, the ACPDS model checkpoint, and data/demo_ai_inference_config.json.',
        'This command only validates public dataset/sample inference; it does not connect to live cameras.'
      ]
    }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
