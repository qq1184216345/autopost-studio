// 微信视频号「图文」发表 UI 自动化（视频号助手 channels.weixin.qq.com/platform）。
// ⚠️ 选择器为基于视频号助手结构的初版，需在登录态页面现场联调校正（同 xhs/douyin 当初做法）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 图文发表入口（视频号助手）。不同账号/版本可能是 /platform/post/create 后选「图片」。
const CREATE_URLS = [
  'https://channels.weixin.qq.com/platform/post/create',
  'https://channels.weixin.qq.com/platform/post/finderNewLifeCreate',
];

export async function publishWxsph(ctx, { imgPath, title, body, hashtags = [], mode, titleMaxLen = 16 }) {
  const page = await ctx.newPage();
  let postResp = null;
  page.on('response', async (r) => {
    if (/post\/(create|publish)|finder.*create|helper_upload|webcgi/i.test(r.url()) && r.request().method() === 'POST') {
      try { postResp = (await r.text()).slice(0, 400); } catch { /* */ }
    }
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CREATE_URLS[0], { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3500);
    if (/login|auth/i.test(page.url())) return { ok: false, error: '视频号未登录（请先在账号里登录此账号）' };

    // 1) 若有「图片/图文」入口先切到图文
    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('*')].find((e) => /^(图片|图文)$/.test((e.textContent || '').trim()) && e.offsetParent && e.getBoundingClientRect().width < 200);
      if (hit) hit.click();
    }).catch(() => {});
    await sleep(1500);

    // 2) 上传图片
    const fi = await page.waitForSelector('input[type=file]', { timeout: 20000 }).catch(() => null);
    if (!fi) return { ok: false, error: '未找到图片上传输入（选择器需联调）' };
    await page.setInputFiles('input[type=file]', imgPath);
    await sleep(5000); // 等上传/处理（视频号上传走 finderassistance 较慢）

    // 3) 描述（正文 + 话题；视频号 # 自动识别）
    const descSel = '.input-editor[contenteditable], [contenteditable="true"], textarea[placeholder*="描述"], textarea';
    const ed = await page.$(descSel);
    if (ed) {
      await ed.click().catch(() => {});
      await page.keyboard.type(body || '', { delay: 8 });
      for (const tag of hashtags) { await page.keyboard.type(' #' + tag, { delay: 30 }); await sleep(250); await page.keyboard.type(' '); await sleep(150); }
    }

    // 4) 短标题（视频号短标题需 6-16 字，否则报错；不满足则跳过）
    const t = (title || '').trim();
    if (t.length >= 6) {
      const tt = t.slice(0, titleMaxLen);
      const tin = await page.$('input[placeholder*="标题"], input[placeholder*="概括"]');
      if (tin) { await tin.click().catch(() => {}); await page.keyboard.type(tt, { delay: 16 }); }
    }
    await sleep(1500);

    // 5) 发表 / 存草稿
    const wantText = mode === 'draft' ? ['保存草稿', '存草稿', '草稿'] : ['发表', '发布'];
    const clicked = await page.evaluate((texts) => {
      const btn = [...document.querySelectorAll('button, [role=button], .weui-desktop-btn')].find((b) => {
        const x = (b.textContent || '').trim(); return texts.some((t) => x === t) && !b.disabled && b.offsetParent;
      });
      if (btn) { btn.click(); return true; } return false;
    }, wantText);
    if (!clicked) return { ok: false, error: `未找到「${wantText[0]}」按钮（选择器需联调）` };

    if (mode === 'draft') { await sleep(3000); return { ok: true, mode: 'draft' }; }
    let landed = false;
    for (let i = 0; i < 30; i++) { await sleep(1000); if (postResp || /post\/list|success|platform\/post$/.test(page.url())) { landed = true; break; } }
    return { ok: landed, mode: 'publish', resp: postResp || page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}
