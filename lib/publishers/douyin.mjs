// 抖音图文 UI 自动化发布（驱动 creator.douyin.com，抖音自家 JS 处理鉴权，不依赖 aitoearn.ai）。
// 真实选择器已联调：标题 input[placeholder=添加作品标题]、正文 .editor-kit-container[contenteditable]、发布按钮普通 button「发布」。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IMAGE_TEXT_URL = 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3';

export async function publishDouyin(ctx, { imgPaths = [], title, body, hashtags = [], mode, titleMaxLen = 30 }) {
  const page = await ctx.newPage();
  let postResp = null;
  page.on('response', async (r) => {
    if (/aweme\/v1\/create|content\/publish|web\/api\/media\/aweme\/create|\/post\/create/.test(r.url()) && r.request().method() === 'POST') {
      try { postResp = await r.text(); } catch { /* */ }
    }
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(IMAGE_TEXT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3500);
    if (/login|passport|sso/i.test(page.url())) return { ok: false, error: '抖音未登录' };

    // 1) 上传图片
    const fi = await page.waitForSelector('input[type=file]', { timeout: 20000 }).catch(() => null);
    if (!fi) return { ok: false, error: '未找到图片上传输入' };
    await page.setInputFiles('input[type=file]', imgPaths);

    // 2) 等编辑区出现（标题输入框 = 上传完成进入编辑态）
    const titleSel = 'input[placeholder="添加作品标题"]';
    const ok = await page.waitForSelector(titleSel, { timeout: 40000 }).catch(() => null);
    if (!ok) return { ok: false, error: '上传后未进入编辑态（标题框未出现）' };
    await sleep(3500); // 等图片处理稳定

    // 3) 标题
    await page.fill(titleSel, (title || '').slice(0, titleMaxLen)).catch(() => {});

    // 4) 正文 + 话题（抖音描述里 # 自动识别为话题，空格分隔）
    const editor = await page.$('.editor-kit-container[contenteditable], [data-placeholder="添加作品描述..."], .editor-kit-container [contenteditable=true]');
    if (editor) {
      await editor.click();
      await page.keyboard.type(body || '', { delay: 8 });
      for (const tag of hashtags) { await page.keyboard.type(' #' + tag, { delay: 30 }); await sleep(300); await page.keyboard.type(' '); await sleep(200); }
    }
    await sleep(1500);

    // 5) 等「发布」按钮可用，点击（普通按钮，非 closed shadow）
    const pubBtn = page.getByRole('button', { name: mode === 'draft' ? '存草稿' : '发布', exact: true });
    const draftBtn = page.getByRole('button', { name: '存草稿', exact: true });
    const target = mode === 'draft' && (await draftBtn.count()) ? draftBtn : page.getByRole('button', { name: '发布', exact: true });
    await target.first().scrollIntoViewIfNeeded().catch(() => {});
    // 等可用
    for (let i = 0; i < 20; i++) { if (await target.first().isEnabled().catch(() => false)) break; await sleep(700); }
    await target.first().click({ timeout: 8000 }).catch(async () => {
      // 兜底：按文本找并点
      await page.evaluate((t) => { const el = Array.from(document.querySelectorAll('button')).find((e) => (e.textContent || '').trim() === t && !e.disabled); if (el) el.click(); }, mode === 'draft' ? '存草稿' : '发布');
    });

    if (mode === 'draft') { await sleep(3000); return { ok: true, mode: 'draft' }; }
    // 发布：等结果（URL 跳转到内容管理/成功，或捕获 create 响应）
    let landed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (postResp || /content\/manage|publish\/success|creator-micro\/content\/manage/.test(page.url())) { landed = true; break; }
    }
    return { ok: landed, mode: 'publish', resp: postResp || page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}
