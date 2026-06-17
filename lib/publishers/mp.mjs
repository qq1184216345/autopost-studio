// 微信公众号「图片消息(贴图)」UI 自动化发布（mp.weixin.qq.com 的 appmsg 编辑器 createType=8）。
// 要点：所有后台页需 &token=<会话token>；编辑器是 ProseMirror（标题/描述各一个）；
// 传图=点「+」(.image-selector__add)→对弹层 pop-opr 里的隐藏 input[type=file] setInputFiles（直接点本地上传被浏览器安全策略挡）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function publishMp(ctx, { imgPaths = [], title, body, hashtags = [], mode, titleMaxLen = 20 }) {
  const page = await ctx.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    // 1) 取 token
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3500);
    if (/login|bizlogin/i.test(page.url())) return { ok: false, error: '公众号未登录（请先在账号里打开并登录）' };
    const token = (page.url().match(/token=(\d+)/) || [])[1];
    if (!token) return { ok: false, error: '未取到公众号 token（可能未登录）' };

    // 2) 进图片消息编辑器（createType=8）
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=8&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    // 3) 上传图片：点「+」展开本地上传弹层，对其 file input setInputFiles
    await page.click('.image-selector__add', { timeout: 10000 }).catch(() => {});
    await sleep(1800);
    const h = await page.evaluateHandle(() => {
      const inputs = [...document.querySelectorAll('input[type=file]')];
      return inputs.find((i) => { let p = i; for (let k = 0; k < 5; k++) { p = p && p.parentElement; if (p && /pop-opr|js_upload_btn_container/.test((p.className || '').toString())) return true; } return false; }) || inputs[inputs.length - 1];
    });
    const fileEl = h && h.asElement();
    if (!fileEl) return { ok: false, error: '未找到图片上传输入' };
    await fileEl.setInputFiles(imgPaths);
    // 等上传完成（转圈消失、图片插入）
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      const done = await page.evaluate(() => {
        const loading = document.querySelector('.image-selector .weui-desktop-loading, .image-selector [class*="loading" i]');
        const imgs = document.querySelectorAll('.image-selector img').length;
        return imgs > 0 && !loading;
      }).catch(() => false);
      if (done) break;
    }
    await sleep(1500);

    // 4) 标题(ProseMirror[0], ≤titleMaxLen) + 描述(ProseMirror[1])
    const t = (title || '').slice(0, titleMaxLen);
    if (await page.evaluate(() => { const e = document.querySelectorAll('.ProseMirror')[0]; if (e) { e.focus(); return true; } return false; })) {
      await page.keyboard.type(t, { delay: 16 });
    }
    if (await page.evaluate(() => { const e = document.querySelectorAll('.ProseMirror')[1]; if (e) { e.focus(); return true; } return false; })) {
      await page.keyboard.type(body || '', { delay: 8 });
      for (const tag of hashtags) { await page.keyboard.type(' #' + tag, { delay: 25 }); await sleep(150); }
    }
    await sleep(1200);

    // 5) 保存草稿 / 发表
    const label = mode === 'draft' ? '保存为草稿' : '发表';
    let clicked = false;
    for (let i = 0; i < 15 && !clicked; i++) {
      clicked = await page.evaluate((lb) => { const el = [...document.querySelectorAll('button,.weui-desktop-btn,.weui-desktop-icon-btn')].find((b) => (b.textContent || '').trim() === lb && b.offsetParent && !b.disabled); if (el) { el.click(); return true; } return false; }, label);
      if (!clicked) await sleep(600);
    }
    if (!clicked) return { ok: false, error: `未找到「${label}」按钮` };

    if (mode === 'draft') { await sleep(3500); return { ok: true, mode: 'draft' }; }
    // 发表：处理「群发/确认发表」二次确认
    let landed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      await page.evaluate(() => { const c = [...document.querySelectorAll('.weui-desktop-dialog button, [class*="dialog"] button')].find((b) => /^(继续群发|确定|确认|群发|确认发表)$/.test((b.textContent || '').trim()) && b.offsetParent); if (c) c.click(); }).catch(() => {});
      if (/appmsgpublish|publish.*success|home/.test(page.url())) { landed = true; break; }
    }
    return { ok: landed, mode: 'publish', resp: page.url() };
  } finally {
    await page.close().catch(() => {});
  }
}
