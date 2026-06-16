// autopost-studio 前端 SPA（原生 JS）。
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PLAT = { xhs: '小红书', douyin: '抖音', wxsph: '视频号' };
const ST = { pending: '待发布', published: '已发布', publishing: '发布中', failed: '失败' };
async function api(method, url, body) {
  const o = { method, headers: {} };
  if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  const r = await fetch(url, o); const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
let META = { platforms: ['xhs', 'douyin'], defaultTemplate: {} };

// ---------- 主题 ----------
function applyTheme() {
  const c = localStorage.getItem('aps-theme') || 'system';
  const d = c === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : c;
  document.documentElement.setAttribute('data-theme', d);
  $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.c === c));
}
$$('#themeSeg button').forEach((b) => b.onclick = () => { localStorage.setItem('aps-theme', b.dataset.c); applyTheme(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((localStorage.getItem('aps-theme') || 'system') === 'system') applyTheme(); });

// ---------- 预览组件（iframe srcdoc + 按宽缩放）----------
async function mountPreview(container, payload) {
  container.innerHTML = '<div id="pw" style="position:relative;width:100%;flex:none;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:#000"><iframe class="pvframe"></iframe></div>';
  const wrap = $('#pw', container), f = $('iframe', container);
  const html = await api('POST', '/api/preview-html', payload);
  f.onload = () => sizeFrame(wrap, f);
  f.srcdoc = typeof html === 'string' ? html : '';
}
function sizeFrame(wrap, f) {
  let nw = 1080, nh = 1440;
  try { const d = f.contentDocument; const el = d.getElementById('c') || d.body; const cs = d.defaultView.getComputedStyle(el); nw = parseFloat(cs.width) || nw; nh = parseFloat(cs.height) || nh; } catch (e) {}
  const k = wrap.clientWidth / nw;
  f.style.width = nw + 'px'; f.style.height = nh + 'px'; f.style.transform = `scale(${k})`;
  wrap.style.height = (nh * k) + 'px';
}

// ---------- modal ----------
function modal(html) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay">${html}</div>`;
  const ov = $('.overlay', root);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(); });
  return ov;
}
const closeModal = () => { $('#modalRoot').innerHTML = ''; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// 轻提示 + 自定义确认（WKWebView 里原生 alert/confirm 常不弹，统一用自绘）
function toast(msg, kind = 'ok') {
  const t = document.createElement('div'); t.className = 'toast' + (kind === 'ok' ? '' : ' ' + kind); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, kind === 'err' ? 4000 : 2600);
}
function confirmDialog(message) {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'up-ov';
    ov.innerHTML = `<div class="up-card" style="width:380px;text-align:left">
      <div style="font-size:15px;margin-bottom:18px;white-space:pre-wrap">${esc(message)}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="sm" id="cf-no">取消</button><button class="run sm" id="cf-yes">确定</button></div></div>`;
    document.body.appendChild(ov);
    const done = (v) => { ov.remove(); resolve(v); };
    $('#cf-no', ov).onclick = () => done(false);
    $('#cf-yes', ov).onclick = () => done(true);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) done(false); });
  });
}

// ---------- tabs ----------
const TABS = { templates: renderTemplates, accounts: renderAccounts, drafts: renderDrafts, settings: renderSettings };
$$('#tabs button').forEach((b) => b.onclick = () => {
  $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  TABS[b.dataset.tab]();
});

// ===================== 模板 =====================
let tplSel = new Set();
async function renderTemplates() {
  tplSel = new Set();
  const platFilter = renderTemplates._pf || '';
  const list = await api('GET', '/api/templates' + (platFilter ? '?platform=' + platFilter : ''));
  $('#view').innerHTML = `
    <div class="toolbar">
      <select id="tplPf">${platOptions(platFilter)}</select>
      <button class="primary sm" onclick="openTemplateEditor()">＋ 新建模板</button>
      <button class="sm" onclick="openAiGen()">✨ AI 生成模板</button>
      <button class="sm" onclick="importTemplate()">⇩ 导入模板</button>
      <span class="sp"></span>
      <button class="danger sm" id="tplDel" disabled onclick="batchDel('templates',tplSel,renderTemplates)">批量删除</button>
    </div>
    <div class="grid" id="tplGrid"></div>`;
  $('#tplPf').onchange = (e) => { renderTemplates._pf = e.target.value; renderTemplates(); };
  const grid = $('#tplGrid');
  grid.innerHTML = list.length ? '' : '<p class="muted">还没有模板。点「AI 生成模板」用大白话造一个，或「新建模板」。</p>';
  for (const t of list) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<input type="checkbox" class="chk" data-id="${t.id}">
      <div class="nm">${esc(t.name)}</div>
      <div class="pills">${t.platforms.map((p) => `<span class="pill plat">${PLAT[p] || p}</span>`).join('')}</div>
      <div class="prev"></div>
      <div class="desc">${esc(t.description)}</div>
      <div class="row" style="margin-top:8px"><button class="sm" data-edit="${t.id}">编辑</button><button class="sm" data-exp="${t.id}">导出</button></div>`;
    grid.appendChild(card);
    mountPreview($('.prev', card), { brandTitle: t.name, spec: t.spec, visual: t.spec.visual });
    $('.chk', card).onchange = (e) => { e.target.checked ? tplSel.add(t.id) : tplSel.delete(t.id); card.classList.toggle('sel', e.target.checked); $('#tplDel').disabled = !tplSel.size; };
    $('[data-edit]', card).onclick = () => openTemplateEditor(t);
    $('[data-exp]', card).onclick = async () => { const r = await api('POST', `/api/templates/${t.id}/export`); if (r.ok) toast('已导出模板并打开所在文件夹'); else toast('导出失败: ' + (r.error || ''), 'err'); };
  }
}
// 导入模板：选 .apstpl/.json 文件 → 解析 → 落库
function importTemplate() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.apstpl,.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    let obj; try { obj = JSON.parse(await f.text()); } catch { toast('文件不是有效的 JSON', 'err'); return; }
    const r = await api('POST', '/api/templates/import', obj);
    if (r.ok) { toast('已导入模板：' + r.name); renderTemplates(); } else toast('导入失败: ' + (r.error || ''), 'err');
  };
  inp.click();
}

function platOptions(sel, withAll = true) {
  return (withAll ? `<option value="">全部平台</option>` : '') + META.platforms.map((p) => `<option value="${p}" ${p === sel ? 'selected' : ''}>${PLAT[p] || p}</option>`).join('');
}

function openAiGen() {
  modal(`<div class="modal" style="max-width:560px"><h2>✨ AI 生成模板</h2>
    <p class="muted">用大白话描述你要的账号/风格，AI 按规范产出模板，可再调。</p>
    <textarea id="aiText" placeholder="例：做一个治愈系英语朗读号，每天一句英文金句配中文翻译，蓝紫渐变背景，适合小红书和抖音"></textarea>
    <div class="right-actions"><button onclick="closeModal()">取消</button><button class="primary" id="aiGo">生成</button></div>
    <div class="log" id="aiLog" style="display:none;margin-top:10px">生成中…</div></div>`);
  $('#aiGo').onclick = async () => {
    const text = $('#aiText').value.trim(); if (!text) return;
    $('#aiLog').style.display = 'block'; $('#aiGo').disabled = true;
    const t = await api('POST', '/api/templates/generate', { text });
    if (t.error) { $('#aiLog').innerHTML = `<span class="err">${esc(t.error)}</span>`; $('#aiGo').disabled = false; return; }
    closeModal(); openTemplateEditor({ name: t.name, description: t.description, platforms: t.platforms, spec: t.spec }, true);
  };
}

// 模板编辑器（isNew=未落库的 AI 产物也走这里）
function openTemplateEditor(tpl, isNew) {
  const d = META.defaultTemplate;
  const t = tpl ? JSON.parse(JSON.stringify(tpl)) : JSON.parse(JSON.stringify(d));
  const s = t.spec || (t.spec = JSON.parse(JSON.stringify(d.spec)));
  const c = s.content, v = s.visual;
  const ov = modal(`<div class="modal"><h2>${tpl && tpl.id ? '编辑模板' : '新建模板'}</h2>
    <div class="cols">
      <div>
        <label>名称</label><input id="t_name" value="${esc(t.name)}">
        <label>描述</label><input id="t_desc" value="${esc(t.description || '')}">
        <label>适用平台</label><div id="t_plats" class="pills">${META.platforms.map((p) => `<label class="tag"><input type="checkbox" value="${p}" ${(t.platforms || []).includes(p) ? 'checked' : ''}> ${PLAT[p]}</label>`).join('')}</div>

        <details class="section" open><summary>文案规则 content（AI 写什么）</summary>
          <label>人设 persona</label><input id="c_persona" value="${esc(c.persona)}">
          <label>文体 style</label><textarea id="c_style">${esc(c.style)}</textarea>
          <div class="row"><div><label>段落数 [最少,最多]</label><input id="c_para" value="${(c.paragraphs || []).join(',')}"></div>
            <div><label>字数 [最少,最多]</label><input id="c_char" value="${(c.charRange || []).join(',')}"></div></div>
          <label>标题要求 titleHint</label><input id="c_title" value="${esc(c.titleHint)}">
          <label>额外约束 extraRules</label><input id="c_rules" value="${esc(c.extraRules)}">
          <label>配图落款 footer</label><input id="c_footer" value="${esc(c.footer || '')}">
        </details>

        <details class="section"><summary>配图样式 visual（长什么样）</summary>
          <label>背景 bg (CSS)</label><textarea id="v_bg">${esc(v.bg)}</textarea>
          <div class="row"><div><label>正文色 ink</label><input id="v_ink" value="${esc(v.ink)}"></div>
            <div><label>点缀色 accent</label><input id="v_accent" value="${esc(v.accent)}"></div></div>
          <div class="row"><div><label>标题字体</label><input id="v_tf" value="${esc(v.titleFont)}"></div>
            <div><label>正文字体</label><input id="v_bf" value="${esc(v.bodyFont)}"></div></div>
          <div class="row"><div><label>图标 emblem</label><input id="v_emblem" value="${esc(v.emblem || '')}"></div>
            <div><label>边框 frame</label><select id="v_frame">${['dashed', 'solid', 'none'].map((x) => `<option ${x === v.frame ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
            <div><label>纹理</label><select id="v_tex"><option value="true" ${v.texture ? 'selected' : ''}>有</option><option value="false" ${!v.texture ? 'selected' : ''}>无</option></select></div></div>
          <div class="row"><div><label>宽</label><input id="v_w" type="number" value="${v.width}"></div>
            <div><label>高</label><input id="v_h" type="number" value="${v.height}"></div>
            <div><label>倍率</label><input id="v_s" type="number" value="${v.scale}"></div></div>
          <div class="row"><div><label>品牌字号</label><input id="v_bs" type="number" value="${v.brandSize}"></div>
            <div><label>标题字号</label><input id="v_ts" type="number" value="${v.titleSize}"></div>
            <div><label>正文字号</label><input id="v_ds" type="number" value="${v.bodySize}"></div>
            <div><label>落款字号</label><input id="v_fs" type="number" value="${v.footerSize}"></div></div>
        </details>

        <label>话题（逗号分隔，不带#）</label><input id="t_tags" value="${esc((s.hashtags || []).join(','))}">
        <label>正文模板 captionTemplate</label><textarea id="t_caption">${esc(s.captionTemplate || '')}</textarea>
        <div class="row"><div><label>小红书标题上限</label><input id="t_lx" type="number" value="${(s.titleMaxLen || {}).xhs ?? 20}"></div>
          <div><label>抖音标题上限</label><input id="t_ld" type="number" value="${(s.titleMaxLen || {}).douyin ?? 30}"></div></div>

        <details class="section"><summary>✨ AI 修改这个模板</summary>
          <input id="aiEditText" placeholder="例：把配色换成宣纸风、字体用楷体">
          <button class="sm" style="margin-top:8px" id="aiEditGo">让 AI 改</button>
          <span class="hint" id="aiEditHint"></span>
        </details>
      </div>
      <div>
        <label>实时预览</label><div class="prev"></div>
        <button class="sm" style="margin-top:8px" id="t_refresh">刷新预览</button>
      </div>
    </div>
    <div class="right-actions"><button onclick="closeModal()">取消</button><button class="primary" id="t_save">保存</button></div>
  </div>`);

  const collect = () => {
    const platforms = $$('#t_plats input:checked').map((x) => x.value);
    const numPair = (id) => $('#' + id).value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)).slice(0, 2);
    return {
      id: tpl && tpl.id, name: $('#t_name').value.trim(), description: $('#t_desc').value.trim(), platforms,
      spec: {
        content: { persona: $('#c_persona').value, style: $('#c_style').value, paragraphs: numPair('c_para'), charRange: numPair('c_char'), titleHint: $('#c_title').value, extraRules: $('#c_rules').value, footer: $('#c_footer').value },
        visual: { bg: $('#v_bg').value, ink: $('#v_ink').value, accent: $('#v_accent').value, titleFont: $('#v_tf').value, bodyFont: $('#v_bf').value, emblem: $('#v_emblem').value, frame: $('#v_frame').value, texture: $('#v_tex').value === 'true', width: +$('#v_w').value, height: +$('#v_h').value, scale: +$('#v_s').value, brandSize: +$('#v_bs').value, titleSize: +$('#v_ts').value, bodySize: +$('#v_ds').value, footerSize: +$('#v_fs').value },
        hashtags: $('#t_tags').value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean),
        captionTemplate: $('#t_caption').value,
        titleMaxLen: { xhs: +$('#t_lx').value, douyin: +$('#t_ld').value },
      },
    };
  };
  const preview = () => { const cur = collect(); mountPreview($('.prev', ov), { brandTitle: cur.name, spec: cur.spec, visual: cur.spec.visual, footer: cur.spec.content.footer }); };
  preview();
  $('#t_refresh', ov).onclick = preview;
  $('#aiEditGo', ov).onclick = async () => {
    const text = $('#aiEditText').value.trim(); if (!text) return;
    $('#aiEditHint').textContent = '改写中…';
    const r = await api('POST', '/api/templates/edit', { template: collect(), text });
    if (r.error) { $('#aiEditHint').textContent = '失败: ' + r.error; return; }
    closeModal(); openTemplateEditor({ id: tpl && tpl.id, ...r }, isNew);
  };
  $('#t_save', ov).onclick = async () => {
    const cur = collect();
    const r = cur.id ? await api('PUT', '/api/templates/' + cur.id, cur) : await api('POST', '/api/templates', cur);
    if (r.ok) { closeModal(); renderTemplates(); } else toast('保存失败: ' + (r.error || ''), 'err');
  };
}

// ===================== 账号 =====================
let accSel = new Set();
async function renderAccounts() {
  accSel = new Set();
  const pf = renderAccounts._pf || '';
  const list = await api('GET', '/api/accounts' + (pf ? '?platform=' + pf : ''));
  $('#view').innerHTML = `
    <div class="toolbar">
      <select id="accPf">${platOptions(pf)}</select>
      <button class="primary sm" onclick="openAccountEditor()">＋ 新建账号</button>
      <span class="sp"></span>
      <button class="danger sm" id="accDel" disabled onclick="batchDel('accounts',accSel,renderAccounts)">批量删除</button>
    </div>
    <div class="grid" id="accGrid"></div>`;
  $('#accPf').onchange = (e) => { renderAccounts._pf = e.target.value; renderAccounts(); };
  const grid = $('#accGrid');
  grid.innerHTML = list.length ? '' : '<p class="muted">还没有账号。</p>';
  for (const a of list) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<input type="checkbox" class="chk" data-id="${a.id}">
      <div class="nm">${esc(a.name)}</div>
      <div class="pills"><span class="pill plat">${PLAT[a.platform] || a.platform}</span><span class="pill">${a.conn_mode === 'cdp' ? '外部CDP' : '本机浏览器'}</span></div>
      <div class="desc">品牌：${esc(a.brand_title || '-')}<br>${a.conn_mode === 'cdp' ? 'CDP：' + esc(a.cdp_url || '-') : '独立登录配置'}</div>
      <div class="row" style="margin-top:8px"><button class="sm" data-edit="${a.id}">编辑</button></div>`;
    grid.appendChild(card);
    $('.chk', card).onchange = (e) => { e.target.checked ? accSel.add(a.id) : accSel.delete(a.id); card.classList.toggle('sel', e.target.checked); $('#accDel').disabled = !accSel.size; };
    $('[data-edit]', card).onclick = () => openAccountEditor(a);
  }
}
function openAccountEditor(a) {
  a = a || { name: '', platform: 'xhs', conn_mode: 'managed', cdp_url: '', brand_title: '', note: '' };
  const cdp = a.conn_mode === 'cdp';
  const ov = modal(`<div class="modal" style="max-width:560px"><h2>${a.id ? '编辑账号' : '新建账号'}</h2>
    <label>名称</label><input id="a_name" value="${esc(a.name)}">
    <label>平台</label><select id="a_plat">${META.platforms.map((p) => `<option value="${p}" ${p === a.platform ? 'selected' : ''}>${PLAT[p]}</option>`).join('')}</select>
    <label>连接方式</label>
    <select id="a_mode">
      <option value="managed" ${!cdp ? 'selected' : ''}>本机浏览器（独立登录配置，推荐）</option>
      <option value="cdp" ${cdp ? 'selected' : ''}>外部 CDP（指纹浏览器，高级）</option>
    </select>
    <div id="a_managed" style="display:${cdp ? 'none' : 'block'}">
      <div class="hint">用你在「设置」里选的浏览器，为该账号开一份独立登录配置。${a.id ? '点下面按钮登录。' : '保存后再来编辑里登录。'}</div>
      ${a.id ? `<div class="row" style="margin-top:8px"><button class="sm" id="a_login">🔑 登录此账号（开浏览器）</button><button class="sm" id="a_logindone">完成/关闭</button></div><span class="hint" id="a_loginhint"></span>` : ''}
    </div>
    <div id="a_cdpwrap" style="display:${cdp ? 'block' : 'none'}">
      <label>CDP 地址（指纹浏览器调试地址）</label><input id="a_cdp" value="${esc(a.cdp_url)}" placeholder="http://127.0.0.1:9223">
    </div>
    <label>品牌标题（配图大字）</label><input id="a_brand" value="${esc(a.brand_title)}">
    <label>备注</label><input id="a_note" value="${esc(a.note || '')}">
    <div class="right-actions"><button onclick="closeModal()">取消</button><button class="primary" id="a_save">保存</button></div></div>`);
  const syncMode = () => { const m = $('#a_mode').value; $('#a_managed', ov).style.display = m === 'cdp' ? 'none' : 'block'; $('#a_cdpwrap', ov).style.display = m === 'cdp' ? 'block' : 'none'; };
  $('#a_mode', ov).onchange = syncMode;
  if (a.id) {
    const lg = $('#a_login', ov), ld = $('#a_logindone', ov);
    if (lg) lg.onclick = async () => { $('#a_loginhint').textContent = '正在打开浏览器…在弹出的窗口里登录，完成后点「完成/关闭」'; const r = await api('POST', `/api/accounts/${a.id}/login`); if (r.error) $('#a_loginhint').textContent = '失败: ' + r.error; else $('#a_loginhint').textContent = '浏览器已打开，请在其中登录' + (PLAT[a.platform] || ''); };
    if (ld) ld.onclick = async () => { await api('POST', `/api/accounts/${a.id}/login/done`); $('#a_loginhint').textContent = '已关闭登录窗口（登录态已保存）'; };
  }
  $('#a_save', ov).onclick = async () => {
    const b = { name: $('#a_name').value.trim(), platform: $('#a_plat').value, conn_mode: $('#a_mode').value, cdp_url: (cdp || $('#a_mode').value === 'cdp') ? ($('#a_cdp') ? $('#a_cdp').value.trim() : '') : '', brand_title: $('#a_brand').value.trim(), note: $('#a_note').value.trim() };
    const r = a.id ? await api('PUT', '/api/accounts/' + a.id, b) : await api('POST', '/api/accounts', b);
    if (r.ok) { closeModal(); renderAccounts(); } else toast('保存失败', 'err');
  };
}

// ===================== 草稿箱 =====================
let drSel = new Set();
async function renderDrafts() {
  drSel = new Set();
  const pf = renderDrafts._pf || '', sf = renderDrafts._sf || '';
  const q = [pf && 'platform=' + pf, sf && 'status=' + sf].filter(Boolean).join('&');
  const list = await api('GET', '/api/drafts' + (q ? '?' + q : ''));
  $('#view').innerHTML = `
    <div class="toolbar">
      <select id="drPf">${platOptions(pf)}</select>
      <select id="drSf"><option value="">全部状态</option><option value="pending" ${sf === 'pending' ? 'selected' : ''}>待发布</option><option value="published" ${sf === 'published' ? 'selected' : ''}>已发布</option></select>
      <button class="primary sm" onclick="newDraft()">＋ 新建草稿</button>
      <span class="sp"></span>
      <button class="danger sm" id="drDel" disabled onclick="batchDel('drafts',drSel,renderDrafts)">批量删除</button>
    </div>
    <div class="grid" id="drGrid"></div>`;
  $('#drPf').onchange = (e) => { renderDrafts._pf = e.target.value; renderDrafts(); };
  $('#drSf').onchange = (e) => { renderDrafts._sf = e.target.value; renderDrafts(); };
  const grid = $('#drGrid');
  grid.innerHTML = list.length ? '' : '<p class="muted">草稿箱为空。「新建草稿」选模板→AI 出内容/上传图→加账号→发布。</p>';
  for (const d of list) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<input type="checkbox" class="chk" data-id="${d.id}">
      ${d.image_path ? `<div style="position:relative"><img class="thumb" src="/uploads/${d.image_path}?t=${Date.now()}">${(d.image_paths && d.image_paths.length > 1) ? `<span class="pill" style="position:absolute;top:14px;right:10px;background:rgba(0,0,0,.6);color:#fff">${d.image_paths.length}图</span>` : ''}</div>` : '<div class="thumb"></div>'}
      <div class="nm">${esc(d.title || '(未生成)')}</div>
      <div class="pills"><span class="pill ${d.status}">${ST[d.status]}</span>${d.platforms.map((p) => `<span class="pill plat">${PLAT[p] || p}</span>`).join('')}</div>
      <div class="desc">模板：${esc(d.template ? d.template.name : '-')} · 账号 ${d.targets.length}</div>
      <div class="row" style="margin-top:8px"><button class="sm" data-open="${d.id}">打开</button></div>`;
    grid.appendChild(card);
    $('.chk', card).onchange = (e) => { e.target.checked ? drSel.add(d.id) : drSel.delete(d.id); card.classList.toggle('sel', e.target.checked); $('#drDel').disabled = !drSel.size; };
    $('[data-open]', card).onclick = () => openDraft(d.id);
  }
}

async function newDraft() {
  const tpls = await api('GET', '/api/templates');
  if (!tpls.length) { toast('请先到「模板」创建一个模板', 'warn'); return; }
  const ov = modal(`<div class="modal" style="max-width:520px"><h2>新建草稿</h2>
    <label>选择模板</label><select id="nd_tpl">${tpls.map((t) => `<option value="${t.id}">${esc(t.name)}（${t.platforms.map((p) => PLAT[p]).join('/')}）</option>`).join('')}</select>
    <label>品牌标题（配图大字，默认用模板名）</label><input id="nd_brand" placeholder="如 张口就来">
    <label>主题（给 AI 的方向，可空）</label><input id="nd_theme" placeholder="如 开口的勇气">
    <div class="right-actions"><button onclick="closeModal()">取消</button><button class="primary" id="nd_go">创建并打开</button></div></div>`);
  $('#nd_go', ov).onclick = async () => {
    const tid = +$('#nd_tpl').value;
    const r = await api('POST', '/api/drafts', { template_id: tid, brand_title: $('#nd_brand').value.trim(), title: $('#nd_theme').value.trim() });
    if (r.ok) { closeModal(); openDraft(r.id, $('#nd_theme') ? undefined : undefined); }
  };
}

async function openDraft(id) {
  const d = await api('GET', '/api/drafts/' + id);
  const accounts = await api('GET', '/api/accounts');
  const usable = accounts.filter((a) => d.platforms.includes(a.platform));
  const targetAccIds = new Set(d.targets.map((t) => t.account_id));
  const ov = modal(`<div class="modal"><h2>草稿 #${d.id}</h2>
    <div class="cols">
      <div>
        <label>品牌标题（配图大字）</label><input id="d_brand" value="${esc(d.brand_title)}">
        <label>标题</label><input id="d_title" value="${esc(d.title)}">
        <label>正文段落（每段一行，配图用）</label><textarea id="d_paras" style="min-height:120px">${esc((d.paragraphs || []).join('\n'))}</textarea>
        <label>平台正文 caption</label><textarea id="d_caption">${esc(d.caption)}</textarea>
        <label>话题（逗号分隔，不带#）</label><input id="d_tags" value="${esc((d.hashtags || []).join(','))}">
        <div class="row" style="margin-top:10px">
          <input id="d_theme" placeholder="AI 主题(可空)">
          <button class="sm" id="d_gen">✨ AI 出内容+配图</button>
        </div>
        <div class="row" style="margin-top:6px">
          <button class="sm" id="d_render">按当前内容重渲染图</button>
          <button class="sm" id="d_upbtn">上传图片</button>
          <input type="file" id="d_file" accept="image/*" style="display:none">
        </div>
        <div class="log" id="d_log" style="display:none;margin-top:8px"></div>

        <details class="section" open><summary>发布目标账号（${d.platforms.map((p) => PLAT[p]).join('/')}）</summary>
          <div id="d_targets"></div>
          <label>添加账号（仅列匹配平台、未添加的）</label>
          <div id="d_addable"></div>
        </details>
      </div>
      <div>
        <label>配图预览</label>
        ${(d.image_paths && d.image_paths.length) ? `<div class="muted" style="margin-bottom:6px">共 ${d.image_paths.length} 张（长内容自动分页）</div>` + d.image_paths.map((f, i) => `<div style="position:relative;margin-bottom:8px"><img src="/uploads/${f}?t=${Date.now()}" style="width:100%;display:block;border:1px solid var(--line);border-radius:10px"><span class="pill" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.6);color:#fff">${i + 1}/${d.image_paths.length}</span></div>`).join('') : (d.image_path ? `<img src="/uploads/${d.image_path}?t=${Date.now()}" style="width:100%;display:block;border:1px solid var(--line);border-radius:10px">` : '<div class="muted">尚无配图，点「AI 出内容+配图」或「上传图片」。</div>')}
        <label style="margin-top:14px">发布</label>
        <div class="row"><select id="d_mode"><option value="draft">存草稿(稳)</option><option value="publish">直接发布</option></select>
          <button class="run sm" id="d_pub">▶ 发布选中目标</button></div>
        <div class="log" id="d_publog" style="display:none;margin-top:8px"></div>
      </div>
    </div>
    <div class="right-actions"><button onclick="closeModal()">关闭</button><button class="primary" id="d_save">保存文案</button></div>
  </div>`);

  // targets 列表
  const renderTargets = (draft) => {
    $('#d_targets', ov).innerHTML = draft.targets.length ? draft.targets.map((t) => `<div class="checkline">
      <input type="checkbox" class="tsel" data-tid="${t.tid}" checked>
      <span style="flex:1">${esc(t.name)} <span class="pill plat">${PLAT[t.platform]}</span></span>
      <span class="pill ${t.status}">${ST[t.status]}</span>
      <button class="sm danger" data-rm="${t.tid}">移除</button></div>`).join('') : '<p class="muted">还没加目标账号。</p>';
    $$('[data-rm]', $('#d_targets', ov)).forEach((b) => b.onclick = async () => { await api('DELETE', `/api/drafts/${id}/targets/${b.dataset.rm}`); refresh(); });
  };
  const renderAddable = (draft) => {
    const have = new Set(draft.targets.map((t) => t.account_id));
    const add = usable.filter((a) => !have.has(a.id));
    $('#d_addable', ov).innerHTML = add.length ? add.map((a) => `<label class="tag"><input type="checkbox" value="${a.id}"> ${esc(a.name)}(${PLAT[a.platform]})</label>`).join('') + `<div style="margin-top:8px"><button class="sm" id="d_addgo">添加选中</button></div>` : '<span class="muted">没有可添加的匹配账号了。</span>';
    const go = $('#d_addgo', ov); if (go) go.onclick = async () => {
      const ids = $$('#d_addable input:checked').map((x) => +x.value); if (!ids.length) return;
      const r = await api('POST', `/api/drafts/${id}/targets`, { accountIds: ids });
      if (r.skipped && r.skipped.length) toast('部分未添加：' + r.skipped.map((s) => s.reason).join('、'), 'warn');
      refresh();
    };
  };
  const refresh = async () => { const nd = await api('GET', '/api/drafts/' + id); renderTargets(nd); renderAddable(nd); };
  renderTargets(d); renderAddable(d);

  const logTo = (sel, msg, cls = '') => { const l = $(sel, ov); l.style.display = 'block'; l.innerHTML += `<span class="${cls}">${esc(msg)}</span>\n`; l.scrollTop = l.scrollHeight; };

  $('#d_save', ov).onclick = async () => {
    await api('PUT', '/api/drafts/' + id, { title: $('#d_title').value, brand_title: $('#d_brand').value, paragraphs: $('#d_paras').value.split('\n').map((s) => s.trim()).filter(Boolean), caption: $('#d_caption').value, hashtags: $('#d_tags').value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean), template_id: d.template_id });
    closeModal(); renderDrafts();
  };
  $('#d_gen', ov).onclick = async () => {
    $('#d_log', ov).style.display = 'block'; $('#d_log', ov).innerHTML = ''; logTo('#d_log', 'AI 出内容 + 渲染配图中…', 'step');
    const nd = await api('POST', `/api/drafts/${id}/generate`, { theme: $('#d_theme').value.trim() });
    if (nd.error) return logTo('#d_log', '失败: ' + nd.error, 'err');
    closeModal(); openDraft(id);
  };
  $('#d_render', ov).onclick = async () => {
    await api('PUT', '/api/drafts/' + id, { title: $('#d_title').value, brand_title: $('#d_brand').value, paragraphs: $('#d_paras').value.split('\n').map((s) => s.trim()).filter(Boolean), caption: $('#d_caption').value, hashtags: $('#d_tags').value.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean), template_id: d.template_id });
    logTo('#d_log', '重渲染中…', 'step');
    const nd = await api('POST', `/api/drafts/${id}/render`);
    if (nd.error) return logTo('#d_log', '失败: ' + nd.error, 'err');
    closeModal(); openDraft(id);
  };
  $('#d_upbtn', ov).onclick = () => $('#d_file', ov).click();
  $('#d_file', ov).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    logTo('#d_log', '上传中…', 'step');
    await fetch(`/api/drafts/${id}/image?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    closeModal(); openDraft(id);
  };
  $('#d_pub', ov).onclick = async () => {
    const log = $('#d_publog', ov); log.style.display = 'block';
    let tids = $$('.tsel:checked', ov).map((x) => x.dataset.tid);
    // 没有已添加的目标：把下方「添加账号」里勾选的自动加为目标再发（省去「添加选中」这一步）
    if (!tids.length) {
      const pend = $$('#d_addable input:checked', ov).map((x) => +x.value);
      if (pend.length) {
        log.innerHTML = '<span class="step">添加目标账号…</span>\n';
        const r = await api('POST', `/api/drafts/${id}/targets`, { accountIds: pend });
        if (r.skipped && r.skipped.length) toast('部分未添加：' + r.skipped.map((s) => s.reason).join('、'), 'warn');
        await refresh();
        tids = $$('.tsel:checked', ov).map((x) => x.dataset.tid);
      }
    }
    if (!tids.length) { log.innerHTML = '<span class="err">请先勾选要发布的账号（上方「发布目标账号」里勾选，或下方「添加账号」里勾选后再点发布）</span>\n'; return; }
    const mode = $('#d_mode').value;
    log.innerHTML = '';
    const es = new EventSource(`/api/drafts/${id}/publish?targets=${tids.join(',')}&mode=${mode}`);
    es.onmessage = (ev) => { const cls = /✅/.test(ev.data) ? 'ok' : /❌|⚠️/.test(ev.data) ? 'err' : /^[①②③]/.test(ev.data) ? 'step' : ''; log.innerHTML += `<span class="${cls}">${esc(ev.data)}</span>\n`; log.scrollTop = log.scrollHeight; };
    es.addEventListener('done', () => { es.close(); log.innerHTML += '<span class="ok">— 完成 —</span>\n'; refresh(); });
    es.onerror = () => { es.close(); };
  };
}

// ===================== 设置 =====================
async function renderSettings() {
  const s = await api('GET', '/api/settings');
  $('#view').innerHTML = `<div class="card" style="max-width:640px">
    <h2 style="margin-top:0">设置</h2>

    <h3 style="margin:6px 0">浏览器</h3>
    <p class="hint">渲染配图、发布都用浏览器驱动。<b>推荐 Chrome / Edge / Brave</b>（Chromium 内核）。Safari / Firefox 不支持。</p>
    <label>当前选择</label>
    <div class="row"><input id="s_bpath" value="${esc(s.browser_path || '')}" placeholder="点下面检测并选择，或手填浏览器可执行文件路径">
      <button class="sm" id="s_detect" style="flex:0 0 auto">🔍 检测已安装</button></div>
    <div id="s_blist" class="tags" style="margin-top:6px"></div>

    <h3 style="margin:16px 0 6px">AI</h3>
    <label>密钥 ai_key（OpenAI 兼容）</label><input id="s_key" value="${esc(s.ai_key || '')}" placeholder="sk-...">
    <div class="row"><div><label>Base ai_base</label><input id="s_base" value="${esc(s.ai_base || 'https://apihub.agnes-ai.com/v1')}"></div>
      <div><label>模型 ai_model</label><input id="s_model" value="${esc(s.ai_model || 'agnes-2.0-flash')}"></div></div>

    <h3 style="margin:16px 0 6px">更新</h3>
    <p class="hint">当前版本 <b id="s_ver">${esc(META.version || '?')}</b>。留空默认从官方 GitHub Releases 检查更新；也可填自己的 release.json 地址。</p>
    <label>更新地址 update_url（留空=默认 GitHub）</label>
    <div class="row"><input id="s_upurl" value="${esc(s.update_url || '')}" placeholder="https://github.com/qq1184216345/autopost-studio/releases/latest/download/release.json">
      <button class="sm" id="s_check" style="flex:0 0 auto">检查更新</button></div>
    <div id="s_upinfo" class="hint" style="margin-top:6px"></div>

    <h3 style="margin:16px 0 6px">备份 / 还原</h3>
    <p class="hint">备份会把<b>全部数据（模板/账号/草稿/设置 + 所有配图）</b>打包成一个 .apsbak 文件，换机器搬这个文件即可。</p>
    <div class="row" style="max-width:360px">
      <button class="sm" id="s_backup">💾 一键备份</button>
      <button class="sm" id="s_restore">♻️ 还原备份</button>
    </div>
    <div id="s_bakinfo" class="hint" style="margin-top:6px"></div>

    <div class="right-actions"><button class="primary" id="s_save">保存</button></div>
    <p class="hint" id="s_hint"></p>
  </div>`;
  $('#s_backup').onclick = async () => {
    const info = $('#s_bakinfo'); info.textContent = '备份中…';
    const r = await api('POST', '/api/backup');
    if (r.ok) info.innerHTML = `✅ 已备份（含 ${r.uploads} 张配图）并打开文件夹：<br>${esc(r.path)}<br>把这个 .apsbak 文件拷到新机器，用「还原备份」导入即可。`;
    else info.innerHTML = `<span style="color:var(--danger)">备份失败：${esc(r.error || '')}</span>`;
  };
  $('#s_restore').onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.apsbak,.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      if (!(await confirmDialog('还原会用备份覆盖当前全部数据（模板/账号/草稿/设置），确定？'))) return;
      const info = $('#s_bakinfo'); info.textContent = '还原中…';
      let obj; try { obj = JSON.parse(await f.text()); } catch { toast('文件不是有效的备份(.apsbak)', 'err'); return; }
      const r = await api('POST', '/api/restore', obj);
      if (!r.ok) { info.innerHTML = `<span style="color:var(--danger)">还原失败：${esc(r.error || '')}</span>`; return; }
      info.textContent = '已写入，正在重启应用以加载还原的数据…';
      const inv = window.__TAURI__?.core?.invoke;
      if (inv) { try { await inv('restart_backend'); } catch (e) { /* reload 会断连 */ } }
      else { toast('已还原，请重开应用生效'); setTimeout(() => location.reload(), 800); }
    };
    inp.click();
  };
  $('#s_detect').onclick = async () => {
    const list = await api('GET', '/api/browsers');
    $('#s_blist').innerHTML = list.length ? list.map((b) => `<button class="sm" data-p="${esc(b.path)}">${esc(b.name)}</button>`).join('') : '<span class="hint">没检测到 Chromium 系浏览器，请安装 Chrome 或手填路径。</span>';
    $$('#s_blist button').forEach((btn) => btn.onclick = () => { $('#s_bpath').value = btn.dataset.p; });
  };
  $('#s_check').onclick = async () => {
    await api('PUT', '/api/settings', { update_url: $('#s_upurl').value.trim() }); // 先存地址再查
    const info = $('#s_upinfo'); info.textContent = '检查中…';
    const r = await api('GET', '/api/update/check');
    if (r.error) { info.innerHTML = `<span style="color:var(--danger)">${esc(r.error)}</span>`; return; }
    if (!r.enabled) { info.textContent = '未配置更新地址'; return; }
    if (!r.hasUpdate) { info.textContent = `已是最新（${r.current}）`; return; }
    info.innerHTML = `发现新版本 <b>${esc(r.latest)}</b>（当前 ${esc(r.current)}）${r.notes ? '：' + esc(r.notes) : ''} <button class="run sm" id="s_apply">立即更新</button>`;
    $('#s_apply').onclick = () => runUpdate(r.latest, r.notes);
  };
  $('#s_save').onclick = async () => {
    await api('PUT', '/api/settings', { browser_path: $('#s_bpath').value.trim(), ai_key: $('#s_key').value.trim(), ai_base: $('#s_base').value.trim(), ai_model: $('#s_model').value.trim(), update_url: $('#s_upurl').value.trim() });
    $('#s_hint').textContent = '已保存 ✓';
  };
  $('#s_detect').click(); // 进页面自动检测一次
}

// 先检查再更新（用于「重试」入口）
async function startUpdate() {
  const r = await api('GET', '/api/update/check');
  if (r.error) return toast('检查失败：' + r.error, 'err');
  if (!r.hasUpdate) return toast('已是最新版本');
  runUpdate(r.latest, r.notes);
}

// 带动画的更新流程：火箭 + 进度条 + 分步骤
function runUpdate(latest, notes) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ov = document.createElement('div'); ov.className = 'up-ov';
  ov.innerHTML = `<div class="up-card">
    <div class="up-rocket">🚀</div>
    <div class="up-title">正在更新${latest ? ' 到 v' + esc(latest) : ''}</div>
    <div class="up-sub" id="up-sub">请稍候，马上就好…</div>
    <div class="up-bar" id="up-bar"><i></i></div>
    <div class="up-steps">
      <div class="up-step" data-k="fetch"><span class="dot"></span><span>获取新版本</span></div>
      <div class="up-step" data-k="write"><span class="dot"></span><span>写入更新文件</span></div>
      <div class="up-step" data-k="restart"><span class="dot"></span><span>重启并加载新版本</span></div>
    </div>
    ${notes ? `<div class="up-notes">📝 ${esc(notes)}</div>` : ''}
  </div>`;
  document.body.appendChild(ov);
  const setStep = (k, cls) => { const el = ov.querySelector(`[data-k="${k}"]`); if (!el) return; el.className = 'up-step ' + cls; const d = el.querySelector('.dot'); if (cls === 'done') d.textContent = '✓'; else if (cls === 'err') d.textContent = '✕'; };
  const fail = (msg) => {
    $('#up-bar', ov).style.display = 'none';
    $('#up-sub', ov).innerHTML = '<span style="color:var(--danger)">更新失败</span>';
    const box = document.createElement('div'); box.style.marginTop = '14px';
    box.innerHTML = `<div class="up-notes" style="color:var(--danger)">${esc(msg)}</div>
      <div style="margin-top:14px;display:flex;gap:8px;justify-content:center">
        <button class="run sm" id="up-retry">重试</button><button class="sm" id="up-close">关闭</button></div>`;
    ov.querySelector('.up-card').appendChild(box);
    $('#up-close', box).onclick = () => ov.remove();
    $('#up-retry', box).onclick = () => { ov.remove(); startUpdate(); };
  };
  (async () => {
    try {
      setStep('fetch', 'active'); await sleep(550);
      setStep('fetch', 'done'); setStep('write', 'active');
      const r = await api('POST', '/api/update/apply');
      if (!r || r.error || !r.ok) { setStep('write', 'err'); fail((r && r.error) || '写入失败'); return; }
      await sleep(450); setStep('write', 'done');
      setStep('restart', 'active'); $('#up-sub', ov).textContent = '正在重启应用…';
      localStorage.setItem('aps-updated', latest || r.version || '');
      await sleep(400);
      // 触发后端重启：优先让后端自我退出（壳守护会自动拉起全新进程，最可靠）；
      // 老壳无守护则退回 Tauri restart_backend 命令。
      if (META && META.supervisor) {
        await api('POST', '/api/_restart').catch(() => {});
      } else {
        const inv = window.__TAURI__?.core?.invoke;
        if (inv) inv('restart_backend').catch(() => {});
      }
      // 轮询后端恢复（重启期间会短暂 502/断连），恢复后整页重载 → 新前端+新后端
      await sleep(800);
      for (let i = 0; i < 60; i++) {
        try { const rr = await fetch('/api/meta', { cache: 'no-store' }); if (rr.ok) { await sleep(400); break; } } catch (e) { /* 后端重启中 */ }
        await sleep(500);
      }
      location.reload();
    } catch (e) { setStep('write', 'err'); fail(e.message); }
  })();
}

const showToast = (msg) => toast(msg, 'ok');

// ---------- 批量删除 ----------
async function batchDel(table, set, rerender) {
  if (!set.size) return;
  if (!(await confirmDialog(`确认删除选中的 ${set.size} 项？`))) return;
  await api('DELETE', '/api/' + table, { ids: [...set] });
  rerender();
}

// ---------- 启动时静默检查更新，有则顶部 banner ----------
async function autoCheckUpdate() {
  try {
    const r = await api('GET', '/api/update/check');
    if (r && r.enabled && r.hasUpdate) {
      const bar = document.createElement('div');
      bar.style.cssText = 'background:var(--acc2);color:#fff;padding:8px 14px;display:flex;gap:10px;align-items:center;font-size:13px';
      bar.innerHTML = `发现新版本 ${esc(r.latest)}（当前 ${esc(r.current)}）${r.notes ? ' · ' + esc(r.notes) : ''} <span style="flex:1"></span>`;
      const btn = document.createElement('button'); btn.className = 'sm'; btn.textContent = '立即更新'; btn.onclick = () => { bar.remove(); runUpdate(r.latest, r.notes); };
      const x = document.createElement('button'); x.className = 'sm'; x.textContent = '稍后'; x.onclick = () => bar.remove();
      bar.append(btn, x);
      document.body.insertBefore(bar, document.querySelector('main'));
    }
  } catch (e) { /* 离线/未配置，忽略 */ }
}

// ---------- 启动 ----------
(async () => {
  applyTheme();
  META = await api('GET', '/api/meta');
  renderTemplates();
  // 热更新完成后的成功提示
  const upd = localStorage.getItem('aps-updated');
  if (upd !== null) { localStorage.removeItem('aps-updated'); showToast('✅ 已更新到 v' + (META.version || upd)); }
  else autoCheckUpdate();
})();
addEventListener('resize', () => { const wrap = $('#pw'); const f = wrap && $('iframe', wrap); if (wrap && f) sizeFrame(wrap, f); });
