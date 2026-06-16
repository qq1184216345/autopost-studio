// 微信视频号「图文」发表 UI 自动化（视频号助手）。
// 编辑器在 WUJIE 微前端 iframe(/micro/content/post/...) 内，Playwright 选择器引擎进不去，
// 故用 frame.evaluate/evaluateHandle 取真实 DOM：文件→evaluateHandle.setInputFiles；
// 文本→evaluate 聚焦 + page.keyboard 真打字（话题 # 才会被识别）；按钮→evaluate 点击。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIST_URL = 'https://channels.weixin.qq.com/platform/post/finderNewLifePostList';

export async function publishWxsph(ctx, { imgPath, title, body, hashtags = [], mode, titleMaxLen = 22 }) {
  const page = await ctx.newPage();
  let postResp = null;
  page.on('response', async (r) => {
    if (/post\/(create|publish)|webcgi.*post|finder.*(create|publish)/i.test(r.url()) && r.request().method() === 'POST') {
      try { postResp = (await r.text()).slice(0, 300); } catch { /* */ }
    }
  });
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(LIST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    if (/login|auth/i.test(page.url())) return { ok: false, error: '视频号未登录（请先在账号里登录此账号）' };
    await page.getByText('发表图文', { exact: true }).first().click({ timeout: 10000 }).catch(() => {});
    await sleep(2500);

    // 编辑器微前端 iframe
    let frame = null;
    for (let i = 0; i < 25 && !frame; i++) { frame = page.frames().find((f) => /micro\/content\/post/.test(f.url())); if (!frame) await sleep(800); }
    if (!frame) return { ok: false, error: '未加载图文编辑器(iframe)' };

    // 1) 上传图片：点隐藏 input 触发原生选择框，用页面级 filechooser 拦截（绕开 WUJIE 句柄失效）
    // 先确认 input 存在
    for (let i = 0; i < 20; i++) { if (await frame.evaluate(() => !!document.querySelector('input[type=file]')).catch(() => false)) break; await sleep(800); }
    let chooser;
    try {
      [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        frame.evaluate(() => { const i = document.querySelector('input[type=file]'); if (i) i.click(); }),
      ]);
    } catch { return { ok: false, error: '未弹出图片选择（上传入口未触发）' }; }
    await chooser.setFiles(imgPath);
    await sleep(8000); // 等上传 + 处理

    // 2) 标题（聚焦后真打字，≤22）
    const focusedTitle = await frame.evaluate(() => { const i = document.querySelector('input[placeholder*="填写标题"]'); if (i) { i.focus(); return true; } return false; });
    if (focusedTitle) await page.keyboard.type((title || '').slice(0, titleMaxLen), { delay: 16 });

    // 3) 描述 + 话题（聚焦 contenteditable 后真打字；# 触发话题）
    const focusedDesc = await frame.evaluate(() => { const d = document.querySelector('.input-editor[contenteditable], .input-editor'); if (d) { d.focus(); return true; } return false; });
    if (focusedDesc) {
      await page.keyboard.type(body || '', { delay: 8 });
      for (const tag of hashtags) { await page.keyboard.type(' #' + tag, { delay: 35 }); await sleep(350); await page.keyboard.type(' '); await sleep(200); }
    }
    await sleep(1500);

    // 4) 发表 / 保存草稿（evaluate 点击）
    const label = mode === 'draft' ? '保存草稿' : '发表';
    let clicked = false;
    for (let i = 0; i < 20 && !clicked; i++) {
      clicked = await frame.evaluate((lb) => {
        const el = [...document.querySelectorAll('.weui-desktop-btn, button')].find((b) => (b.textContent || '').trim() === lb && !b.disabled && b.offsetParent);
        if (el) { el.click(); return true; } return false;
      }, label);
      if (!clicked) await sleep(700);
    }
    if (!clicked) return { ok: false, error: `未找到可点的「${label}」按钮` };

    if (mode === 'draft') { await sleep(3500); return { ok: true, mode: 'draft' }; }

    // 发表：处理可能的二次确认弹窗，等结果
    let landed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      await frame.evaluate(() => {
        const c = [...document.querySelectorAll('.weui-desktop-dialog button, [class*="dialog"] button, [class*="modal"] button, .weui-desktop-btn')]
          .find((b) => /^(确定|继续发表|确认发表)$/.test((b.textContent || '').trim()) && b.offsetParent);
        if (c) c.click();
      }).catch(() => {});
      if (postResp || /finderNewLifePostList|success/.test(page.url())) { landed = true; break; }
    }
    return { ok: landed, mode: 'publish', resp: postResp || page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}
