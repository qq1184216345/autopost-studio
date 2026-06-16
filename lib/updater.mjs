// 热更新（OTA）：拉远端 release.json，比对版本，把 JS 负载(server.mjs/lib/web)写进运行目录。
// 仅打包版(APS_BUNDLED=1)允许 apply；dev 禁用以免覆盖源码。重启由原生壳的 restart_backend 完成。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings } from './db.mjs';

// 运行目录 = server.mjs 所在目录（release=live 目录 / dev=源码根）
export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_BUNDLED = process.env.APS_BUNDLED === '1';

// 默认更新源（GitHub Releases，仓库须公开）。用户在设置里填了则覆盖。
export const DEFAULT_UPDATE_URL = 'https://github.com/qq1184216345/autopost-studio/releases/latest/download/release.json';
const updateUrlOf = (s) => (s.update_url && s.update_url.trim()) || DEFAULT_UPDATE_URL;

export function currentVersion() {
  try { return readFileSync(resolve(APP_DIR, 'VERSION'), 'utf8').trim() || '0.0.0'; } catch { return '0.0.0'; }
}

// "1.2.10" 数字化比较：a>b →1, a<b →-1, == →0
export function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

async function fetchRelease(url) {
  if (!url) throw new Error('未配置更新地址（设置里填 update_url）');
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`拉取 release.json 失败 ${res.status}`);
  const j = await res.json();
  if (!j || !j.version) throw new Error('release.json 格式不对（缺 version）');
  return j;
}

export async function checkUpdate() {
  const s = getSettings();
  const current = currentVersion();
  const rel = await fetchRelease(updateUrlOf(s));
  return { enabled: true, current, latest: rel.version, notes: rel.notes || '', hasUpdate: cmpVersion(rel.version, current) > 0 };
}

// 路径白名单：只允许 server.mjs / lib/** / web/**，挡 ..、绝对路径、越界
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel) return null;
  const n = normalize(rel).replace(/^[\\/]+/, '');
  if (n.startsWith('..') || n.includes('..' + sep) || n.includes(sep + '..') || resolve(APP_DIR, n).indexOf(APP_DIR + sep) !== 0) return null;
  if (n === 'server.mjs' || n.startsWith('lib' + sep) || n.startsWith('web' + sep) || n.startsWith('lib/') || n.startsWith('web/')) return n;
  return null;
}

const MAX_FILES = 500;
const MAX_BYTES = 8 * 1024 * 1024; // 单文件上限 8MB

export async function applyUpdate() {
  if (!IS_BUNDLED) return { ok: false, error: 'dev 模式禁用热更新（避免覆盖源码）。打包版才可更新。' };
  const s = getSettings();
  const rel = await fetchRelease(updateUrlOf(s));
  const files = rel.files || {};
  const names = Object.keys(files);
  if (!names.length) throw new Error('release.json 没有 files');
  if (names.length > MAX_FILES) throw new Error('文件数超限');
  // 先校验全部路径，任一非法则整体拒绝（原子性优先）
  const planned = [];
  for (const rel0 of names) {
    const safe = safeRel(rel0);
    if (!safe) throw new Error('非法更新路径被拒绝: ' + rel0);
    const content = files[rel0];
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_BYTES) throw new Error('内容非法/超限: ' + rel0);
    planned.push({ abs: resolve(APP_DIR, safe), content });
  }
  for (const f of planned) { mkdirSync(dirname(f.abs), { recursive: true }); writeFileSync(f.abs, f.content); }
  writeFileSync(resolve(APP_DIR, 'VERSION'), String(rel.version) + '\n');
  return { ok: true, version: rel.version, count: planned.length };
}
