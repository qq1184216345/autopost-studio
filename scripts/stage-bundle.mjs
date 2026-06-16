// 把运行所需文件 + node 二进制 stage 进 src-tauri/app/（tauri build 前跑一次）。
// 用法：node scripts/stage-bundle.mjs
import { cpSync, copyFileSync, chmodSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = resolve(ROOT, 'src-tauri/app');

rmSync(APP, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });

for (const item of ['server.mjs', 'seed.mjs', 'VERSION', 'lib', 'web', 'node_modules']) {
  const s = resolve(ROOT, item);
  if (existsSync(s)) { cpSync(s, resolve(APP, item), { recursive: true, force: true }); console.log('  +', item); }
}
// 内置 node 运行时（用当前 node 二进制，自包含、node:sqlite 无 flag）
copyFileSync(process.execPath, resolve(APP, 'node'));
chmodSync(resolve(APP, 'node'), 0o755);
console.log('  + node (', process.version, ')');
console.log('staged →', APP);
