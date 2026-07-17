// ============================================================
// exec-helper.js — promisified exec wrapper
// ============================================================
'use strict';

const { exec } = require('child_process');

function execAsync(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  });
}

module.exports = { execAsync };
