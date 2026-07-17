'use strict';

const { spawn } = require('child_process');
const path = require('path');
const electronBinary = require('electron');

const cwd = path.resolve(__dirname, '..');
const child = spawn(electronBinary, ['.', '--smoke-renderer'], {
  cwd,
  stdio: 'inherit',
});

const timer = setTimeout(() => {
  child.kill();
  console.error('renderer smoke timed out after 30s');
  process.exit(1);
}, 30000);

child.on('exit', code => {
  clearTimeout(timer);
  process.exit(code ?? 1);
});

child.on('error', error => {
  clearTimeout(timer);
  console.error('renderer smoke failed to launch:', error);
  process.exit(1);
});
