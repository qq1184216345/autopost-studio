// 小红书 UI 自动化发布（驱动创作页，xhs 自家 JS 处理签名/x-s-common，不依赖 aitoearn.ai）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function publishXhs(ctx, { imgPaths = [], title, body, hashtags = [], mode, titleMaxLen = 20 }) {
  const page = await ctx.newPage();
  let noteResp = null;
  page.on('response', async (r) => {
    if (/web_api\/sns\/v2\/note/.test(r.url()) && r.request().method() === 'POST') {
      try { noteResp = await r.text(); } catch { /* */ }
    }
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.creator-tab', { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => { const t = Array.from(document.querySelectorAll('.creator-tab,[role=tab]')).find((e) => (e.textContent || '').trim() === '上传图文'); if (t) t.click(); });
      await sleep(800);
      if (await page.evaluate(() => [...document.querySelectorAll('input[type=file]')].some((i) => /image|png|jpe?g/i.test((i.accept || '') + i.className)))) break;
    }
    await page.setInputFiles('input[type=file].upload-input, input[type=file]', imgPaths);
    await page.waitForFunction(() => !!document.querySelector('.ProseMirror[contenteditable=true]'), null, { timeout: 40000 });

    // ★ 等图片上传完毕：上传中会有 .mask.uploading / .progress-container 遮罩，等它们消失
    await page.waitForFunction(
      () => !document.querySelector('.mask.uploading') && !document.querySelector('.progress-container'),
      null,
      { timeout: 60000 },
    ).catch(() => {});
    await sleep(1200); // 再稳一下

    // 标题
    await page.click('input.d-text, input[type=text]', { timeout: 5000 }).catch(() => {});
    await page.keyboard.type((title || '').slice(0, titleMaxLen), { delay: 16 });

    // 正文
    await page.click('.ProseMirror[contenteditable=true]', { timeout: 5000 }).catch(() => {});
    await page.keyboard.type(body || '', { delay: 8 });

    // ★ 话题：输入 #话题 后从下拉框点选匹配项 → 变蓝生效；选完补一个空格分隔
    if (hashtags.length) {
      await page.keyboard.press('Enter'); // 话题另起一行
      for (const tag of hashtags) {
        await page.keyboard.type('#' + tag, { delay: 70 });
        let picked = false;
        for (let i = 0; i < 16 && !picked; i++) {
          await sleep(200);
          picked = await page.evaluate((tag) => {
            const norm = (s) => (s || '').replace(/\s/g, '').trim();
            const items = Array.from(document.querySelectorAll('div.item')).filter((e) => {
              const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && e.querySelector('.name');
            });
            let el = items.find((m) => norm((m.querySelector('.name') || {}).innerText) === '#' + tag);
            if (!el) el = Array.from(document.querySelectorAll('[class*="newTopic" i]')).find((e) => e.offsetParent) || items[0];
            if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
            return false;
          }, tag);
        }
        await sleep(500);
        await page.keyboard.type(' '); // 话题后空格
        await sleep(300);
      }
    }
    await sleep(1500);

    const box = await page.locator('xhs-publish-btn').boundingBox();
    if (!box) return { ok: false, error: '未找到发布栏 xhs-publish-btn' };
    if (mode === 'publish') {
      for (const r of [0.62, 0.7, 0.55, 0.74]) { if (noteResp) break; await page.mouse.click(box.x + box.width * r, box.y + box.height / 2); for (let i = 0; i < 6 && !noteResp; i++) await sleep(700); }
      for (let i = 0; i < 10 && !noteResp; i++) await sleep(700);
      let id = null; try { id = JSON.parse(noteResp)?.data?.id; } catch { /* */ }
      return { ok: !!id, mode: 'publish', noteId: id, resp: noteResp };
    }
    // draft：左侧「暂存离开」约在 0.37 处
    await page.mouse.click(box.x + box.width * 0.37, box.y + box.height / 2);
    await sleep(3500);
    return { ok: true, mode: 'draft' };
  } finally {
    await page.close().catch(() => {});
  }
}
