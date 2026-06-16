// 播种：把只读 bundle 里的运行文件复制到用户可写的 live 目录（仅当版本变化/缺失）。
// 由原生壳在启动后端前调用：node <bundleDir>/seed.mjs <liveDir>。独立脚本，不加载 DB。
import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url)); // bundleDir
const dest = process.argv[2];
if (!dest) { console.error('usage: node seed.mjs <dest>'); process.exit(1); }

const readVer = (p) => { try { return readFileSync(resolve(p, 'VERSION'), 'utf8').trim(); } catch { return null; } };
const bundleVer = readVer(SRC) || '0.0.0';
const seeded = existsSync(resolve(dest, '.bundle')) ? readFileSync(resolve(dest, '.bundle'), 'utf8').trim() : null;

if (seeded === bundleVer && existsSync(resolve(dest, 'server.mjs'))) {
  console.log('[seed] up-to-date', bundleVer);
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const item of ['server.mjs', 'seed.mjs', 'lib', 'web', 'node_modules', 'VERSION']) {
  const s = resolve(SRC, item);
  if (existsSync(s)) cpSync(s, resolve(dest, item), { recursive: true, force: true });
}
writeFileSync(resolve(dest, '.bundle'), bundleVer);
writeFileSync(resolve(dest, 'VERSION'), bundleVer + '\n'); // 换装后把有效版本重置到安装包版本
console.log('[seed] done', bundleVer);
process.exit(0);
