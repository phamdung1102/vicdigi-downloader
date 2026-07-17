'use strict';

const { spawn } = require('child_process');
const { getExecutablePath } = require('./utils');
const { clearYtDlpError, recordYtDlpError } = require('./diagnostics');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function resolveYtDlpPath(appDir) {
  return getExecutablePath('yt-dlp', appDir || __dirname) || 'yt-dlp';
}

function withCommonArgs(args = []) {
  return [
    '--no-check-certificates',
    '--user-agent', DEFAULT_USER_AGENT,
    ...args,
  ];
}

function spawnYtDlp(args, options = {}) {
  const { appDir, cwd } = options;
  return spawn(resolveYtDlpPath(appDir), args, { cwd });
}

function runYtDlp(args, options = {}) {
  const { timeoutMs = 0, onStdout, onStderr } = options;

  return new Promise((resolve, reject) => {
    const proc = spawnYtDlp(args, options);
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          try { proc.kill(); } catch (_) {}
        }, timeoutMs)
      : null;

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      if (onStdout) onStdout(text);
    });

    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) onStderr(text);
    });

    proc.on('error', err => {
      if (timer) clearTimeout(timer);
      recordYtDlpError('runYtDlp', err);
      reject(err);
    });

    proc.on('close', code => {
      if (timer) clearTimeout(timer);

      if (timedOut) {
        const err = new Error('yt-dlp timed out');
        err.stdout = stdout;
        err.stderr = stderr;
        recordYtDlpError('runYtDlp', err);
        reject(err);
        return;
      }

      if (code === 0) {
        clearYtDlpError();
        resolve({ stdout, stderr });
        return;
      }

      const err = new Error(stderr || `yt-dlp exited with code ${code}`);
      err.stdout = stdout;
      err.stderr = stderr;
      recordYtDlpError('runYtDlp', err);
      reject(err);
    });
  });
}

async function runYtDlpJson(url, options = {}) {
  const args = withCommonArgs([
    '--dump-json',
    '--no-playlist',
    ...(options.extraArgs || []),
    url,
  ]);

  const { stdout } = await runYtDlp(args, options);
  return JSON.parse(stdout);
}

module.exports = {
  DEFAULT_USER_AGENT,
  resolveYtDlpPath,
  withCommonArgs,
  spawnYtDlp,
  runYtDlp,
  runYtDlpJson,
};
