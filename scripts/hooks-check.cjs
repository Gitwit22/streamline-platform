const { execSync } = require('node:child_process');
const path = require('node:path');

function run(cmd, cwd) {
  execSync(cmd, { stdio: 'inherit', cwd });
}

const repoRoot = path.resolve(__dirname, '..');

try {
  run('node streamline-client/scripts/check-no-loginpage-jsx.cjs', repoRoot);
  run('tsx scripts/check-no-raw-api-fetch.ts', repoRoot);
} catch (e) {
  process.exit(1);
}
