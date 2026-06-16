// 本地数据层：Node 内置 node:sqlite（无原生依赖编译）。首启自动建表。
// 表：templates / accounts / drafts / draft_targets / settings。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.APS_DATA_DIR || resolve(ROOT, 'data');
export const UPLOADS_DIR = process.env.APS_UPLOADS_DIR || resolve(ROOT, 'uploads');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });

// 还原：若存在暂存的 app.db.restore，开库前换入（清掉旧 WAL/SHM）
const DB_PATH = resolve(DATA_DIR, 'app.db');
const RESTORE_PATH = DB_PATH + '.restore';
if (existsSync(RESTORE_PATH)) {
  try {
    for (const ext of ['-wal', '-shm']) { const p = DB_PATH + ext; if (existsSync(p)) rmSync(p); }
    renameSync(RESTORE_PATH, DB_PATH);
  } catch { /* 换入失败则忽略，继续用现有库 */ }
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  platforms TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
  spec TEXT NOT NULL DEFAULT '{}',         -- JSON：content/visual/hashtags/captionTemplate/titleMaxLen
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  cdp_url TEXT DEFAULT '',
  brand_title TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  brand_title TEXT DEFAULT '',              -- 配图大字（品牌名）
  paragraphs TEXT NOT NULL DEFAULT '[]',   -- JSON 数组（配图正文段落）
  hashtags TEXT NOT NULL DEFAULT '[]',     -- JSON 数组
  caption TEXT DEFAULT '',                  -- 平台正文
  image_path TEXT DEFAULT '',               -- uploads/ 相对名
  image_source TEXT DEFAULT 'ai',           -- 'ai' | 'upload'
  template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS draft_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending|publishing|published|failed
  result TEXT DEFAULT '',
  error TEXT DEFAULT '',
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(draft_id, account_id)              -- 单账号对同一草稿不可重复
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// —— 轻量迁移：缺列则补（idempotent）——
function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
ensureColumn('accounts', 'conn_mode', "TEXT DEFAULT 'managed'"); // managed=本机浏览器独立profile / cdp=外部指纹浏览器
ensureColumn('drafts', 'image_paths', "TEXT DEFAULT '[]'"); // 多图（长内容自动分页）JSON 数组；image_path 仍存首图作缩略

// —— 通用查询 helper ——
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

// 批量删除（白名单表名，防注入）
const TABLES = new Set(['templates', 'accounts', 'drafts', 'draft_targets']);
export function batchDelete(table, ids) {
  if (!TABLES.has(table)) throw new Error('非法表名');
  const list = (ids || []).map(Number).filter(Number.isInteger);
  if (!list.length) return { deleted: 0 };
  const ph = list.map(() => '?').join(',');
  const info = db.prepare(`DELETE FROM ${table} WHERE id IN (${ph})`).run(...list);
  return { deleted: Number(info.changes) };
}

// —— settings 读写 ——
export function getSettings() {
  const out = {};
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}
export function setSettings(obj) {
  const stmt = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(obj || {})) stmt.run(k, v == null ? '' : String(v));
}

export const touch = (table, id) => run(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`, id);
export default db;
