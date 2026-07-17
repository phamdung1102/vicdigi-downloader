// ============================================================
// release.js — Build + tự đăng bản mới lên GitHub Releases
// Dùng: npm run release   (sau khi đã tăng version trong package.json)
// Token lấy tự động từ `gh auth token` (gh CLI đã đăng nhập sẵn).
// ============================================================
'use strict';

const { execFileSync, spawnSync } = require('child_process');
const pkg = require('../package.json');

let token = process.env.GH_TOKEN;
if (!token) {
  try {
    token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
  } catch (_) {
    console.error('❌ Không lấy được GitHub token. Chạy `gh auth login` trước, hoặc set biến môi trường GH_TOKEN.');
    process.exit(1);
  }
}

console.log(`🚀 Build & publish v${pkg.version} lên GitHub Releases...`);

const result = spawnSync(
  'npx',
  ['electron-builder', '--win', '--config', 'electron-builder.yml', '--publish', 'always'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, GH_TOKEN: token },
  }
);

if (result.status === 0) {
  console.log(`✅ Đã đăng v${pkg.version}: https://github.com/phamdung1102/vicdigi-downloader/releases`);
}
process.exit(result.status || 0);
