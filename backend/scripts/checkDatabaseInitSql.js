const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const initSqlPath = path.join(projectRoot, 'database', 'init.sql');

const pgHost = process.env.PGHOST || process.env.DB_HOST || 'localhost';
const pgUser = process.env.PGUSER || process.env.DB_USER || 'postgres';
const pgPassword = process.env.PGPASSWORD || process.env.DB_PASSWORD || 'password';
const dbName = `ai_parking_init_check_${Date.now()}_${process.pid}`;

const commonPostgresBins = [
  '/opt/homebrew/opt/postgresql@16/bin',
  '/usr/local/opt/postgresql@16/bin',
  '/opt/homebrew/bin',
  '/usr/local/bin'
];

const resolveCommand = (envName, commandName) => {
  if (process.env[envName]) {
    return process.env[envName];
  }

  for (const binDir of commonPostgresBins) {
    const candidate = path.join(binDir, commandName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return commandName;
};

const commands = {
  createdb: resolveCommand('CREATEDB_BIN', 'createdb'),
  dropdb: resolveCommand('DROPDB_BIN', 'dropdb'),
  psql: resolveCommand('PSQL_BIN', 'psql')
};

const commandEnv = {
  ...process.env,
  PGPASSWORD: pgPassword
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: commandEnv,
    encoding: 'utf8',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${stderr}`);
  }

  return result.stdout || '';
};

const runPsqlFile = () => {
  run(commands.psql, [
    '-h', pgHost,
    '-U', pgUser,
    '-d', dbName,
    '-v', 'ON_ERROR_STOP=1',
    '-f', initSqlPath
  ]);
};

const getCounts = () => {
  return run(commands.psql, [
    '-h', pgHost,
    '-U', pgUser,
    '-d', dbName,
    '-t',
    '-A',
    '-c',
    `
      SELECT json_build_object(
        'users', (SELECT COUNT(*) FROM users),
        'parking_lots', (SELECT COUNT(*) FROM parking_lots),
        'parking_slots', (SELECT COUNT(*) FROM parking_slots),
        'parking_slot_rois', (SELECT COUNT(*) FROM parking_slot_rois),
        'parking_analytics', (SELECT COUNT(*) FROM parking_analytics),
        'video_analysis', (SELECT COUNT(*) FROM video_analysis),
        'bookings', (SELECT COUNT(*) FROM bookings),
        'system_logs', (SELECT COUNT(*) FROM system_logs),
        'chatbot_conversations', (SELECT COUNT(*) FROM chatbot_conversations)
      )::text;
    `
  ]).trim();
};

const main = () => {
  if (!fs.existsSync(initSqlPath)) {
    throw new Error(`database/init.sql not found at ${initSqlPath}`);
  }

  console.log(`Creating temporary database ${dbName}`);
  run(commands.createdb, ['-h', pgHost, '-U', pgUser, dbName]);

  try {
    console.log('Running database/init.sql first pass');
    runPsqlFile();
    const firstCounts = getCounts();

    console.log('Running database/init.sql second pass');
    runPsqlFile();
    const secondCounts = getCounts();

    if (firstCounts !== secondCounts) {
      throw new Error(`database/init.sql is not idempotent.\nfirst:  ${firstCounts}\nsecond: ${secondCounts}`);
    }

    console.log('database/init.sql smoke check passed');
    console.log(secondCounts);
  } finally {
    console.log(`Dropping temporary database ${dbName}`);
    run(commands.dropdb, ['-h', pgHost, '-U', pgUser, '--if-exists', dbName]);
  }
};

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
