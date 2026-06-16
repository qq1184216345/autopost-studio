// 配图渲染 + 发布编排。复用已跑通的 publishers（小红书/抖音 UI 自动化）。
// 浏览器来源：每账号自管 profile（用户自己的浏览器）或外部 CDP（指纹浏览器）—— 见 lib/browser.mjs。
import { resolve } from 'node:path';
import { publishXhs } from './publishers/xhs.mjs';
import { publishDouyin } from './publishers/douyin.mjs';
import { publishWxsph } from './publishers/wxsph.mjs';
import { get, run, getSettings, UPLOADS_DIR } from './db.mjs';
import { launchForAccount } from './browser.mjs';

const PUBLISHERS = { xhs: publishXhs, douyin: publishDouyin, wxsph: publishWxsph };

// 发布一条草稿到指定 targets。逐 target：启动该账号的浏览器(自管 profile / 外部 CDP)→发布→更新状态。
export async function publishDraft(draftId, targetIds, { mode = 'draft', onLog = () => {} } = {}) {
  const draft = get('SELECT * FROM drafts WHERE id = ?', draftId);
  if (!draft) throw new Error('草稿不存在');
  const template = draft.template_id ? get('SELECT * FROM templates WHERE id = ?', draft.template_id) : null;
  const spec = template ? JSON.parse(template.spec || '{}') : {};
  const titleMaxLen = spec.titleMaxLen || { xhs: 20, douyin: 30 };
  const hashtags = JSON.parse(draft.hashtags || '[]');
  // 多图（长内容分页）；兼容老草稿只有 image_path
  let imgList = [];
  try { imgList = JSON.parse(draft.image_paths || '[]'); } catch { imgList = []; }
  if (!imgList.length && draft.image_path) imgList = [draft.image_path];
  const imgPaths = imgList.map((f) => resolve(UPLOADS_DIR, f));
  const settings = getSettings();

  const targets = targetIds.map((tid) => get(
    `SELECT dt.id tid, a.* FROM draft_targets dt JOIN accounts a ON a.id = dt.account_id WHERE dt.id = ? AND dt.draft_id = ?`,
    tid, draftId)).filter(Boolean);

  const results = [];
  for (const t of targets) {
    const publish = PUBLISHERS[t.platform];
    if (!publish) { mark(t.tid, 'failed', '', '不支持的平台 ' + t.platform); onLog(`⚠️ ${t.name}: 不支持平台`); results.push({ tid: t.tid, ok: false }); continue; }
    mark(t.tid, 'publishing');
    onLog(`▸ [${t.name}/${t.platform}] ${t.conn_mode === 'cdp' ? '连接外部浏览器' : '启动本机浏览器(独立配置)'} …`);
    let handle;
    try {
      handle = await launchForAccount(t, settings);
    } catch (e) {
      mark(t.tid, 'failed', '', e.message); onLog(`❌ [${t.name}] ${e.message}`); results.push({ tid: t.tid, ok: false }); continue;
    }
    try {
      onLog(`③ [${t.name}] ${mode === 'publish' ? '发布' : '存草稿'}…`);
      const res = await publish(handle.ctx, { imgPaths, title: draft.title, body: draft.caption || '', hashtags, mode, titleMaxLen: titleMaxLen[t.platform] });
      if (res.ok) { mark(t.tid, 'published', res.noteId || res.resp || mode); onLog(`✅ [${t.name}] ${res.mode === 'draft' ? '已存草稿' : '已发布'}${res.noteId ? ' ' + res.noteId : ''}`); results.push({ tid: t.tid, ok: true }); }
      else { mark(t.tid, 'failed', '', res.error || res.resp || '未确认'); onLog(`⚠️ [${t.name}] ${res.error || '未确认'}`); results.push({ tid: t.tid, ok: false }); }
    } catch (e) { mark(t.tid, 'failed', '', e.message); onLog(`❌ [${t.name}] ${e.message}`); results.push({ tid: t.tid, ok: false }); }
    finally { await handle?.close?.(); }
  }
  return results;
}

function mark(tid, status, result, error) {
  if (status === 'published') run("UPDATE draft_targets SET status=?, result=?, error='', published_at=datetime('now') WHERE id=?", status, result || '', tid);
  else if (status === 'failed') run('UPDATE draft_targets SET status=?, error=? WHERE id=?', status, error || '', tid);
  else run('UPDATE draft_targets SET status=? WHERE id=?', status, tid);
}
