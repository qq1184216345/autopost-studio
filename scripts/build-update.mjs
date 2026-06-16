// 生成热更新包 dist/release.json（含 server.mjs + lib/** + web/**）。把它传到你的 update_url 即完成发版。
// 用法：node scripts/build-update.mjs [version] [notes]
//   例：node scripts/build-update.mjs 1.0.1 "修复发布按钮 + 新模板"
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [, , versionArg, ...notesArr] = process.argv;
const notes = notesArr.join(' ');

// 版本：参数优先，否则用现有 VERSION
let version = versionArg;
if (version) writeFileSync(resolve(ROOT, 'VERSION'), version + '\n');
else version = readFileSync(resolve(ROOT, 'VERSION'), 'utf8').trim();

// 收集文件（与 updater 白名单一致：server.mjs + lib/** + web/**）
const files = {};
function add(rel) { files[rel.split(sep).join('/')] = readFileSync(resolve(ROOT, rel), 'utf8'); }
function walk(dir) {
  for (const name of readdirSync(resolve(ROOT, dir))) {
    const rel = dir + sep + name;
    const st = statSync(resolve(ROOT, rel));
    if (st.isDirectory()) walk(rel);
    else add(rel);
  }
}
add('server.mjs');
walk('lib');
walk('web');

const out = { version, notes, files, builtAt: new Date().toISOString() };
mkdirSync(resolve(ROOT, 'dist'), { recursive: true });
const dest = resolve(ROOT, 'dist/release.json');
writeFileSync(dest, JSON.stringify(out));
console.log(`release.json → ${dest}`);
console.log(`  version=${version} | files=${Object.keys(files).length} | notes=${notes || '(无)'}`);
console.log('把它上传到你的 update_url，App 即可检测并热更新。');
