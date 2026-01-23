/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const forbidden = path.join(repoRoot, 'src', 'pages', 'LoginPage.jsx');

if (fs.existsSync(forbidden)) {
  console.error('[guard] Forbidden file exists:', forbidden);
  console.error('[guard] Keep only LoginPage.tsx. Delete LoginPage.jsx.');
  process.exit(1);
}

process.exit(0);
