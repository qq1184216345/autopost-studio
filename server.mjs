// autopost-studio 服务：模板/账号/草稿箱/发布 一体。Node 内置 http，零额外依赖。
// 用法：node server.mjs  →  http://127.0.0.1:8787（仅绑本机）
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { all, get, run, batchDelete, getSettings, setSettings, touch, UPLOADS_DIR, ROOT } from './lib/db.mjs';
import { validateTemplate, defaultTemplate, SUPPORTED_PLATFORMS } from './lib/template-spec.mjs';
import { generateTemplate, editTemplate, genContent } from './lib/ai.mjs';
import { renderImage, publishDraft } from './lib/publish.mjs';
import { detectBrowsers, launchScratch, openLogin, closeLogin } from './lib/browser.mjs';
import { buildHtml } from './lib/render.mjs';
import { checkUpdate, applyUpdate, currentVersion } from './lib/updater.mjs';

const PORT = Number(process.env.PORT) || 8787;
const WEB = resolve(ROOT, 'web');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type + (type.startsWith('image') ? '' : '; charset=utf-8'), 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBuf = (req) => new Promise((r) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => r(Buffer.concat(c))); });
const readJson = async (req) => { const b = (await readBuf(req)).toString('utf8'); return b ? JSON.parse(b) : {}; };

// —— 序列化 ——
const tplOut = (r) => r && ({ id: r.id, name: r.name, description: r.description, platforms: JSON.parse(r.platforms || '[]'), spec: JSON.parse(r.spec || '{}'), created_at: r.created_at, updated_at: r.updated_at });
function draftOut(r) {
  if (!r) return null;
  const tpl = r.template_id ? get('SELECT id,name,platforms FROM templates WHERE id=?', r.template_id) : null;
  const platforms = tpl ? JSON.parse(tpl.platforms || '[]') : [];
  const targets = all(`SELECT dt.id tid, dt.status, dt.result, dt.error, dt.published_at, a.id account_id, a.name, a.platform
    FROM draft_targets dt JOIN accounts a ON a.id=dt.account_id WHERE dt.draft_id=? ORDER BY dt.id`, r.id);
  const status = targets.length && targets.every((t) => t.status === 'published') ? 'published' : 'pending';
  return { id: r.id, title: r.title, brand_title: r.brand_title, paragraphs: JSON.parse(r.paragraphs || '[]'),
    hashtags: JSON.parse(r.hashtags || '[]'), caption: r.caption, image_path: r.image_path, image_source: r.image_source,
    template_id: r.template_id, template: tpl ? { id: tpl.id, name: tpl.name } : null, platforms, targets, status,
    created_at: r.created_at, updated_at: r.updated_at };
}

// 由模板 captionTemplate 生成正文（话题单独处理，这里去掉 {hashtags}）
const buildCaption = (tpl, title) => (tpl?.spec?.captionTemplate || '{title}').replace('{title}', title || '').replace('{hashtags}', '').replace(/\n+\s*$/, '').trim();

// —— 路由表 ——
const R = [];
const route = (method, re, fn) => R.push({ method, re, fn });

// ===== 模板 =====
route('GET', /^\/api\/templates$/, (req, res, m, u) => {
  const plat = u.searchParams.get('platform');
  let rows = all('SELECT * FROM templates ORDER BY updated_at DESC').map(tplOut);
  if (plat) rows = rows.filter((t) => t.platforms.includes(plat));
  send(res, 200, rows);
});
route('GET', /^\/api\/templates\/(\d+)$/, (req, res, m) => send(res, 200, tplOut(get('SELECT * FROM templates WHERE id=?', +m[1])) || { error: '不存在' }));
route('POST', /^\/api\/templates$/, async (req, res) => {
  const { value, errors } = validateTemplate(await readJson(req));
  const info = run('INSERT INTO templates(name,description,platforms,spec) VALUES(?,?,?,?)', value.name, value.description, JSON.stringify(value.platforms), JSON.stringify(value.spec));
  send(res, 200, { ok: true, id: Number(info.lastInsertRowid), warnings: errors });
});
route('PUT', /^\/api\/templates\/(\d+)$/, async (req, res, m) => {
  const { value, errors } = validateTemplate(await readJson(req));
  run('UPDATE templates SET name=?,description=?,platforms=?,spec=?,updated_at=datetime(\'now\') WHERE id=?', value.name, value.description, JSON.stringify(value.platforms), JSON.stringify(value.spec), +m[1]);
  send(res, 200, { ok: true, warnings: errors });
});
route('DELETE', /^\/api\/templates$/, async (req, res) => send(res, 200, batchDelete('templates', (await readJson(req)).ids)));
route('POST', /^\/api\/templates\/generate$/, async (req, res) => { try { send(res, 200, await generateTemplate((await readJson(req)).text || '')); } catch (e) { send(res, 500, { error: e.message }); } });
route('POST', /^\/api\/templates\/edit$/, async (req, res) => { try { const b = await readJson(req); send(res, 200, await editTemplate(b.template || {}, b.text || '')); } catch (e) { send(res, 500, { error: e.message }); } });

// ===== 账号 =====
route('GET', /^\/api\/accounts$/, (req, res, m, u) => { const plat = u.searchParams.get('platform'); let rows = all('SELECT * FROM accounts ORDER BY id DESC'); if (plat) rows = rows.filter((a) => a.platform === plat); send(res, 200, rows); });
route('POST', /^\/api\/accounts$/, async (req, res) => { const b = await readJson(req); const info = run('INSERT INTO accounts(name,platform,conn_mode,cdp_url,brand_title,note) VALUES(?,?,?,?,?,?)', b.name || '未命名', b.platform || 'xhs', b.conn_mode === 'cdp' ? 'cdp' : 'managed', b.cdp_url || '', b.brand_title || '', b.note || ''); send(res, 200, { ok: true, id: Number(info.lastInsertRowid) }); });
route('PUT', /^\/api\/accounts\/(\d+)$/, async (req, res, m) => { const b = await readJson(req); run('UPDATE accounts SET name=?,platform=?,conn_mode=?,cdp_url=?,brand_title=?,note=?,updated_at=datetime(\'now\') WHERE id=?', b.name, b.platform, b.conn_mode === 'cdp' ? 'cdp' : 'managed', b.cdp_url || '', b.brand_title || '', b.note || '', +m[1]); send(res, 200, { ok: true }); });
route('DELETE', /^\/api\/accounts$/, async (req, res) => send(res, 200, batchDelete('accounts', (await readJson(req)).ids)));
// 检测已装浏览器
route('GET', /^\/api\/browsers$/, (req, res) => send(res, 200, detectBrowsers()));
// 登录此账号（managed）：开浏览器到平台创作者页；/done 关闭
route('POST', /^\/api\/accounts\/(\d+)\/login$/, async (req, res, m) => { try { const a = get('SELECT * FROM accounts WHERE id=?', +m[1]); if (!a) return send(res, 404, { error: '账号不存在' }); send(res, 200, await openLogin(a)); } catch (e) { send(res, 500, { error: e.message }); } });
route('POST', /^\/api\/accounts\/(\d+)\/login\/done$/, async (req, res, m) => { try { send(res, 200, await closeLogin(+m[1])); } catch (e) { send(res, 500, { error: e.message }); } });

// ===== 草稿 =====
route('GET', /^\/api\/drafts$/, (req, res, m, u) => {
  const plat = u.searchParams.get('platform'); const st = u.searchParams.get('status');
  let rows = all('SELECT * FROM drafts ORDER BY updated_at DESC').map(draftOut);
  if (plat) rows = rows.filter((d) => d.platforms.includes(plat));
  if (st) rows = rows.filter((d) => d.status === st);
  send(res, 200, rows);
});
route('GET', /^\/api\/drafts\/(\d+)$/, (req, res, m) => send(res, 200, draftOut(get('SELECT * FROM drafts WHERE id=?', +m[1])) || { error: '不存在' }));
route('POST', /^\/api\/drafts$/, async (req, res) => {
  const b = await readJson(req);
  const tpl = b.template_id ? tplOut(get('SELECT * FROM templates WHERE id=?', b.template_id)) : null;
  const brand = b.brand_title || (tpl ? tpl.name : '');
  const info = run('INSERT INTO drafts(title,brand_title,paragraphs,hashtags,caption,image_path,image_source,template_id) VALUES(?,?,?,?,?,?,?,?)',
    b.title || '', brand, JSON.stringify(b.paragraphs || []), JSON.stringify(b.hashtags || (tpl?.spec?.hashtags) || []), b.caption || '', b.image_path || '', b.image_source || 'ai', b.template_id || null);
  send(res, 200, { ok: true, id: Number(info.lastInsertRowid) });
});
route('PUT', /^\/api\/drafts\/(\d+)$/, async (req, res, m) => {
  const b = await readJson(req);
  run('UPDATE drafts SET title=?,brand_title=?,paragraphs=?,hashtags=?,caption=?,template_id=?,updated_at=datetime(\'now\') WHERE id=?',
    b.title || '', b.brand_title || '', JSON.stringify(b.paragraphs || []), JSON.stringify(b.hashtags || []), b.caption || '', b.template_id || null, +m[1]);
  send(res, 200, { ok: true });
});
route('DELETE', /^\/api\/drafts$/, async (req, res) => send(res, 200, batchDelete('drafts', (await readJson(req)).ids)));

// AI 出内容 + 渲染配图
route('POST', /^\/api\/drafts\/(\d+)\/generate$/, async (req, res, m) => {
  try {
    const id = +m[1]; const b = await readJson(req);
    const draft = get('SELECT * FROM drafts WHERE id=?', id); if (!draft) return send(res, 404, { error: '草稿不存在' });
    const tpl = draft.template_id ? tplOut(get('SELECT * FROM templates WHERE id=?', draft.template_id)) : null;
    if (!tpl) return send(res, 400, { error: '草稿未关联模板，无法生成' });
    const brand = draft.brand_title || tpl.name;
    const content = await genContent({ brandTitle: brand, template: tpl, theme: b.theme || draft.title });
    const file = `draft-${id}-${Date.now()}.png`;
    const sc = await launchScratch();
    try { await renderImage(sc.browser, { brandTitle: brand, title: content.title, paragraphs: content.paragraphs, footer: tpl.spec?.content?.footer, visual: tpl.spec?.visual, outPath: resolve(UPLOADS_DIR, file) }); }
    finally { await sc.close(); }
    const caption = buildCaption(tpl, content.title);
    run('UPDATE drafts SET title=?,paragraphs=?,caption=?,image_path=?,image_source=?,updated_at=datetime(\'now\') WHERE id=?', content.title, JSON.stringify(content.paragraphs), caption, file, 'ai', id);
    send(res, 200, draftOut(get('SELECT * FROM drafts WHERE id=?', id)));
  } catch (e) { send(res, 500, { error: e.message }); }
});

// 重新渲染（用当前 draft 内容 + 模板样式；改完正文/样式后刷新图）
route('POST', /^\/api\/drafts\/(\d+)\/render$/, async (req, res, m) => {
  try {
    const id = +m[1]; const draft = get('SELECT * FROM drafts WHERE id=?', id); if (!draft) return send(res, 404, { error: '草稿不存在' });
    const tpl = draft.template_id ? tplOut(get('SELECT * FROM templates WHERE id=?', draft.template_id)) : null;
    if (!tpl) return send(res, 400, { error: '无模板' });
    const file = `draft-${id}-${Date.now()}.png`;
    const sc = await launchScratch();
    try { await renderImage(sc.browser, { brandTitle: draft.brand_title || tpl.name, title: draft.title, paragraphs: JSON.parse(draft.paragraphs || '[]'), footer: tpl.spec?.content?.footer, visual: tpl.spec?.visual, outPath: resolve(UPLOADS_DIR, file) }); }
    finally { await sc.close(); }
    run('UPDATE drafts SET image_path=?,image_source=?,updated_at=datetime(\'now\') WHERE id=?', file, 'ai', id);
    send(res, 200, draftOut(get('SELECT * FROM drafts WHERE id=?', id)));
  } catch (e) { send(res, 500, { error: e.message }); }
});

// 上传图片（原始字节，?name=xx.png）→ uploads/ 并绑定到草稿
route('POST', /^\/api\/drafts\/(\d+)\/image$/, async (req, res, m, u) => {
  try {
    const id = +m[1]; const buf = await readBuf(req);
    const ext = (extname(u.searchParams.get('name') || '') || '.png').toLowerCase();
    const file = `draft-${id}-${Date.now()}${MIME[ext] ? ext : '.png'}`;
    writeFileSync(resolve(UPLOADS_DIR, file), buf);
    run('UPDATE drafts SET image_path=?,image_source=?,updated_at=datetime(\'now\') WHERE id=?', file, 'upload', id);
    send(res, 200, draftOut(get('SELECT * FROM drafts WHERE id=?', id)));
  } catch (e) { send(res, 500, { error: e.message }); }
});

// ===== targets（草稿×账号）=====
route('POST', /^\/api\/drafts\/(\d+)\/targets$/, async (req, res, m) => {
  const id = +m[1]; const b = await readJson(req);
  const draft = get('SELECT * FROM drafts WHERE id=?', id); if (!draft) return send(res, 404, { error: '草稿不存在' });
  const tpl = draft.template_id ? tplOut(get('SELECT * FROM templates WHERE id=?', draft.template_id)) : null;
  const platforms = tpl ? tpl.platforms : SUPPORTED_PLATFORMS;
  const added = []; const skipped = [];
  for (const aid of (b.accountIds || [])) {
    const acc = get('SELECT * FROM accounts WHERE id=?', aid); if (!acc) continue;
    if (!platforms.includes(acc.platform)) { skipped.push({ id: aid, reason: '平台不匹配' }); continue; }
    try { run('INSERT INTO draft_targets(draft_id,account_id) VALUES(?,?)', id, aid); added.push(aid); }
    catch { skipped.push({ id: aid, reason: '已添加(去重)' }); } // UNIQUE 冲突
  }
  send(res, 200, { ok: true, added, skipped, draft: draftOut(get('SELECT * FROM drafts WHERE id=?', id)) });
});
route('DELETE', /^\/api\/drafts\/(\d+)\/targets\/(\d+)$/, (req, res, m) => { run('DELETE FROM draft_targets WHERE id=? AND draft_id=?', +m[2], +m[1]); send(res, 200, { ok: true }); });

// ===== 发布（SSE）=====
route('GET', /^\/api\/drafts\/(\d+)\/publish$/, async (req, res, m, u) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const id = +m[1];
  const targetIds = (u.searchParams.get('targets') || '').split(',').map(Number).filter(Boolean);
  const mode = u.searchParams.get('mode') === 'publish' ? 'publish' : 'draft';
  const onLog = (s) => res.write(`data: ${s}\n\n`);
  try {
    const tids = targetIds.length ? targetIds : all('SELECT id FROM draft_targets WHERE draft_id=?', id).map((r) => r.id);
    if (!tids.length) { onLog('⚠️ 没有可发布的目标账号'); res.write('event: done\ndata: 0\n\n'); return res.end(); }
    await publishDraft(id, tids, { mode, onLog });
    res.write('event: done\ndata: 0\n\n'); res.end();
  } catch (e) { onLog('❌ ' + e.message); res.write('event: done\ndata: 1\n\n'); res.end(); }
});

// ===== 预览 HTML（已存模板/未存模板皆可，前端 iframe.srcdoc）=====
route('POST', /^\/api\/preview-html$/, async (req, res) => {
  const b = await readJson(req); const v = b.visual || b.spec?.visual || {};
  send(res, 200, buildHtml({ brandTitle: b.brandTitle || '示例账号', title: b.title || '示例标题占位', paragraphs: b.paragraphs || ['这是预览示例的第一段文字，看排版。', '换主题、换字体、换配色都所见即所得。'], footer: b.footer || b.spec?.content?.footer || '', theme: v }), 'text/html');
});

// ===== 设置 =====
route('GET', /^\/api\/settings$/, (req, res) => send(res, 200, getSettings()));
route('PUT', /^\/api\/settings$/, async (req, res) => { setSettings(await readJson(req)); send(res, 200, { ok: true }); });

// ===== 元数据 =====
route('GET', /^\/api\/meta$/, (req, res) => send(res, 200, { platforms: SUPPORTED_PLATFORMS, defaultTemplate: defaultTemplate(), version: currentVersion(), bundled: process.env.APS_BUNDLED === '1' }));

// ===== 热更新 =====
route('GET', /^\/api\/update\/check$/, async (req, res) => { try { send(res, 200, await checkUpdate()); } catch (e) { send(res, 500, { error: e.message }); } });
route('POST', /^\/api\/update\/apply$/, async (req, res) => { try { send(res, 200, await applyUpdate()); } catch (e) { send(res, 500, { error: e.message }); } });

// —— server ——
const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = u.pathname;
  try {
    // 静态：uploads
    if (p.startsWith('/uploads/')) { const f = resolve(UPLOADS_DIR, basename(p)); if (existsSync(f)) return send(res, 200, readFileSync(f), MIME[extname(f)] || 'application/octet-stream'); return send(res, 404, 'not found', 'text/plain'); }
    // 静态：前端
    if (p === '/' || p === '/index.html') return send(res, 200, readFileSync(resolve(WEB, 'index.html')), 'text/html');
    if (p.startsWith('/web/') || /\.(js|css)$/.test(p)) { const f = resolve(WEB, basename(p)); if (existsSync(f)) return send(res, 200, readFileSync(f), MIME[extname(f)] || 'text/plain'); }
    // API 路由
    for (const r of R) { const mm = p.match(r.re); if (mm && req.method === r.method) return await r.fn(req, res, mm, u); }
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: e.message }); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`[autopost-studio] http://127.0.0.1:${PORT}  （Ctrl+C 退出）`));
export { server };
