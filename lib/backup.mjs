// 备份/还原 + 模板导入/导出（自有协议）。
// .apsbak  = 整库 + 全部 uploads 的单文件备份（换机器搬一个文件即可）
// .apstpl  = 单个模板（可分享给别人导入）
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, basename, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import db, { DATA_DIR, UPLOADS_DIR } from './db.mjs';

export function backupsDir() {
  const d = resolve(DATA_DIR, '..', 'backups');
  mkdirSync(d, { recursive: true });
  return d;
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

// 在系统文件管理器中定位文件（macOS/Windows/Linux）
function reveal(file) {
  try {
    const [cmd, args] = process.platform === 'darwin' ? ['open', ['-R', file]]
      : process.platform === 'win32' ? ['explorer', ['/select,', file]]
      : ['xdg-open', [dirname(file)]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch { /* 忽略 */ }
}

// —— 备份：整库 + uploads → 单个 .apsbak ——
export function createBackup() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); // 把 WAL 合并进主库，拿到一致快照
  const dbBytes = readFileSync(resolve(DATA_DIR, 'app.db'));
  const uploads = {};
  if (existsSync(UPLOADS_DIR)) {
    for (const f of readdirSync(UPLOADS_DIR)) {
      const p = resolve(UPLOADS_DIR, f);
      if (statSync(p).isFile()) uploads[f] = readFileSync(p).toString('base64');
    }
  }
  const payload = { _aps: 'backup', v: 1, createdAt: new Date().toISOString(), db: dbBytes.toString('base64'), uploads };
  const file = resolve(backupsDir(), `autopost-backup-${stamp()}.apsbak`);
  writeFileSync(file, JSON.stringify(payload));
  reveal(file);
  return { ok: true, path: file, uploads: Object.keys(uploads).length, size: statSync(file).size };
}

// —— 还原：写回 uploads；库暂存为 app.db.restore，下次启动时由 db.mjs 换入 ——
export function applyRestore(obj) {
  if (!obj || obj._aps !== 'backup' || !obj.db) throw new Error('不是有效的备份文件（.apsbak）');
  for (const [name, b64] of Object.entries(obj.uploads || {})) {
    writeFileSync(resolve(UPLOADS_DIR, basename(name)), Buffer.from(b64, 'base64'));
  }
  writeFileSync(resolve(DATA_DIR, 'app.db.restore'), Buffer.from(obj.db, 'base64'));
  return { ok: true, staged: true, uploads: Object.keys(obj.uploads || {}).length };
}

// —— 模板导出：单个 → .apstpl ——
export function exportTemplate(row) {
  const payload = {
    _aps: 'template', v: 1, exportedAt: new Date().toISOString(),
    template: { name: row.name, description: row.description, platforms: JSON.parse(row.platforms || '[]'), spec: JSON.parse(row.spec || '{}') },
  };
  const safe = (row.name || 'template').replace(/[^\w一-龥.-]+/g, '_');
  const file = resolve(backupsDir(), `template-${safe}.apstpl`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  reveal(file);
  return { ok: true, path: file };
}

// 解析导入文件（接受 {_aps:'template',template} 信封或裸模板对象）→ 模板对象
export function parseTemplateImport(obj) {
  if (obj && obj._aps && obj._aps !== 'template') throw new Error('不是模板文件（.apstpl）');
  return (obj && obj.template) ? obj.template : obj;
}
