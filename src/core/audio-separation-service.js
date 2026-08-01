'use strict';

const path = require('path');
const fs = require('fs-extra');
const { spawn, execFile } = require('child_process');
const axios = require('axios');
const extractZip = require('extract-zip');

const MODEL_EXTENSIONS = new Set(['.onnx', '.pth', '.pt', '.ckpt', '.yaml', '.yml', '.th']);
let activeProcess = null;

function runtimePaths(userData) {
  const root = path.join(userData, 'ai-separation');
  return {
    root,
    python: path.join(root, 'runtime', 'Scripts', 'python.exe'),
    cli: path.join(root, 'runtime', 'Scripts', 'audio-separator.exe'),
    models: path.join(root, 'models'),
    uv: path.join(root, 'tools', 'uv.exe'),
  };
}

function detectModel(filePath, size = 0) {
  const name = path.basename(filePath);
  const lower = name.toLowerCase();
  const ext = path.extname(lower);
  let architecture = 'Không xác định';
  let stems = ['Vocals', 'Instrumental'];
  if (lower.includes('demucs') || lower.includes('htdemucs')) {
    architecture = 'Demucs';
    stems = ['Vocals', 'Drums', 'Bass', 'Other'];
  } else if (ext === '.onnx' || lower.includes('mdx')) architecture = 'MDX / ONNX';
  else if (ext === '.ckpt' || lower.includes('roformer')) architecture = 'MDXC / RoFormer';
  else if (ext === '.pth') architecture = 'VR / PyTorch';
  return { name, path: filePath, architecture, stems, size, ready: true };
}

async function scanModels(folder) {
  const root = String(folder || '').trim();
  if (!root || !(await fs.pathExists(root))) return [];
  const models = [];
  const pending = [root];
  while (pending.length && models.length < 500) {
    const current = pending.shift();
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && MODEL_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(fullPath).catch(() => null);
        models.push(detectModel(fullPath, stat?.size || 0));
      }
    }
  }
  return models;
}

function run(command, args, onLog, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    activeProcess = child;
    const forward = data => onLog?.(String(data || '').trim());
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);
    child.once('error', reject);
    child.once('close', code => {
      if (activeProcess === child) activeProcess = null;
      code === 0 ? resolve() : reject(new Error(`Tiến trình AI kết thúc với mã ${code}`));
    });
  });
}

async function findPython() {
  for (const candidate of [['python', ['--version']], ['py', ['-3.11', '--version']], ['py', ['-3', '--version']]]) {
    const ok = await new Promise(resolve => execFile(candidate[0], candidate[1], { windowsHide: true, timeout: 8000 }, error => resolve(!error)));
    if (ok) return candidate[0] === 'py' ? { command: 'py', prefix: candidate[1].slice(0, -1) } : { command: 'python', prefix: [] };
  }
  return null;
}

async function getStatus(userData, modelFolder) {
  const paths = runtimePaths(userData);
  await fs.ensureDir(modelFolder || paths.models);
  const engineReady = await fs.pathExists(paths.cli);
  const python = await findPython();
  return { engineReady, pythonReady: Boolean(python), runtimePath: paths.root, modelFolder: modelFolder || paths.models, models: await scanModels(modelFolder || paths.models) };
}

async function installEngine(userData, onLog) {
  const paths = runtimePaths(userData);
  const systemPython = await findPython();
  await fs.ensureDir(paths.root);
  await fs.ensureDir(paths.models);
  if (!systemPython) {
    await fs.ensureDir(path.dirname(paths.uv));
    if (!(await fs.pathExists(paths.uv))) {
      onLog?.('Máy chưa có Python. Đang tải bộ thiết lập tự động…');
      const zipPath = path.join(paths.root, 'uv-runtime.zip');
      const response = await axios({ method: 'GET', responseType: 'stream', timeout: 120000, url: 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip' });
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        response.data.pipe(output);
        output.on('finish', resolve);
        output.on('error', reject);
      });
      await extractZip(zipPath, { dir: path.dirname(paths.uv) });
      await fs.remove(zipPath).catch(() => {});
    }
    onLog?.('Đang tự tải Python 3.11 và tạo môi trường AI…');
    await run(paths.uv, ['venv', path.join(paths.root, 'runtime'), '--python', '3.11'], onLog, {
      cwd: paths.root,
      env: { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(paths.root, 'python') },
    });
    onLog?.('Đang cài AI Music Separation (CPU)…');
    await run(paths.uv, ['pip', 'install', '--python', paths.python, 'audio-separator[cpu]'], onLog, {
      cwd: paths.root,
      env: { ...process.env, UV_PYTHON_INSTALL_DIR: path.join(paths.root, 'python') },
    });
    return getStatus(userData, paths.models);
  }
  onLog?.('Đang tạo môi trường AI riêng…');
  await run(systemPython.command, [...systemPython.prefix, '-m', 'venv', path.join(paths.root, 'runtime')], onLog);
  onLog?.('Đang cập nhật trình cài đặt…');
  await run(paths.python, ['-m', 'pip', 'install', '--upgrade', 'pip'], onLog);
  onLog?.('Đang cài AI Music Separation (CPU)…');
  await run(paths.python, ['-m', 'pip', 'install', 'audio-separator[cpu]'], onLog);
  return getStatus(userData, paths.models);
}

async function separate(userData, options, onLog) {
  const paths = runtimePaths(userData);
  if (!(await fs.pathExists(paths.cli))) throw new Error('Engine AI chưa được cài đặt.');
  const input = String(options.input || '').trim();
  const outputDir = String(options.outputDir || '').trim();
  let modelDir = String(options.modelDir || paths.models).trim();
  if (!input || !(await fs.pathExists(input))) throw new Error('Video hoặc audio đầu vào không tồn tại.');
  if (!outputDir) throw new Error('Chưa chọn thư mục xuất kết quả.');
  await fs.ensureDir(outputDir);
  await fs.ensureDir(modelDir);
  const presets = {
    fast: 'UVR_MDXNET_KARA_2.onnx',
    balanced: 'UVR-MDX-NET-Inst_HQ_3.onnx',
    high: 'model_bs_roformer_ep_317_sdr_12.9755.ckpt',
    stems4: 'htdemucs_ft.yaml',
  };
  const model = String(options.model || presets[options.quality] || presets.balanced);
  if (path.isAbsolute(model) && await fs.pathExists(model)) modelDir = path.dirname(model);
  const args = [input, '--model_filename', path.basename(model), '--model_file_dir', modelDir, '--output_dir', outputDir, '--output_format', String(options.format || 'WAV').toUpperCase()];
  if (options.mode === 'background') args.push('--single_stem', 'Instrumental');
  if (options.mode === 'voice') args.push('--single_stem', 'Vocals');
  if (options.quality === 'fast') args.push('--mdx_segment_size', '128', '--mdx_overlap', '8');
  if (options.quality === 'high') args.push('--mdxc_overlap', '12');
  onLog?.(`Đang dùng model ${path.basename(model)}…`);
  await run(paths.cli, args, onLog, { cwd: outputDir, env: { ...process.env, PATH: `${path.dirname(paths.python)};${String(options.ffmpegDir || '')};${path.dirname(process.execPath)};${process.env.PATH}` } });
  return { success: true, outputDir, model: path.basename(model) };
}

function cancel() {
  if (!activeProcess) return false;
  activeProcess.kill();
  activeProcess = null;
  return true;
}

module.exports = { runtimePaths, getStatus, scanModels, installEngine, separate, cancel };
