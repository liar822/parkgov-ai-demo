const { spawnSync } = require('child_process');

const run = (name, command, args) => {
  console.log(`\n== ${name} ==`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status}`);
  }
};

const main = () => {
  try {
    run('Database initialization SQL check', 'npm', ['run', 'check:db-init']);
    run('API smoke check', 'npm', ['run', 'check:api']);
    console.log('\nAll checks passed.');
  } catch (error) {
    console.error('\ncheck:all failed');
    console.error(error.message);
    console.error('If the API smoke check failed, start the backend first: PORT=3000 NODE_ENV=development npm run dev');
    process.exit(1);
  }
};

main();
