// 渲染配图（标题 + 美文正文）→ PNG。样式由 theme 对象驱动（themes/*.json），换风格不改代码。
import { writeFileSync } from 'node:fs';

// 默认主题（themes/chalkboard.json 的等价兜底），传入 theme 时整体覆盖。
const DEFAULT_THEME = {
  width: 1080, height: 1440, scale: 2,
  bg: 'linear-gradient(160deg,#2c5440,#244a39 52%,#1b3a2c)',
  texture: true, frame: 'dashed', ink: '#fbfaf3', accent: '#ecd479',
  titleFont: '"Songti SC","STSong",serif', bodyFont: '"PingFang SC",sans-serif',
  emblem: '🎙️', brandSize: 84, titleSize: 46, bodySize: 42, footerSize: 30,
};

export function buildHtml({ brandTitle, title, paragraphs, footer, theme }) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const body = paragraphs.map((p, i) => `<p${i === 0 && /[:：]$/.test(p) ? ' class="lead"' : ''}>${p}</p>`).join('');
  const frameCss = t.frame === 'none' ? 'display:none'
    : `border:3px ${t.frame} ${t.frame === 'dashed' ? 'rgba(240,238,225,.4)' : t.ink}33;border-radius:16px`;
  const textureCss = t.texture
    ? `#c::before{content:"";position:absolute;inset:0;opacity:.09;background-image:
        radial-gradient(rgba(255,255,255,.5) 1px,transparent 1px),radial-gradient(rgba(255,255,255,.3) 1px,transparent 1px);
        background-size:8px 8px,13px 13px;background-position:0 0,5px 7px}` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}html,body{width:${t.width}px;height:${t.height}px}
  #c{width:${t.width}px;height:${t.height}px;position:relative;overflow:hidden;background:${t.bg};
    font-family:${t.bodyFont};color:${t.ink}}
  ${textureCss}
  .fr{position:absolute;inset:34px;${frameCss}}
  .pad{position:absolute;inset:0;padding:90px 96px 84px;z-index:2;display:flex;flex-direction:column}
  .h{text-align:center}.h .m{font-size:44px}
  .h h1{font-family:${t.titleFont};font-weight:900;font-size:${t.brandSize}px;letter-spacing:8px;line-height:1;margin-top:4px;text-shadow:0 3px 0 rgba(0,0,0,.18)}
  .h .t{margin-top:20px;font-size:${t.titleSize}px;font-weight:800;color:${t.accent};line-height:1.3;padding:0 20px}
  .rule{margin:34px auto 0;width:66%;border-top:3px dashed ${t.accent}b3}
  .b{margin-top:44px;flex:1;display:flex;flex-direction:column;justify-content:center}
  .b p{font-size:${t.bodySize}px;line-height:1.95;text-indent:2em}
  .b p.lead{text-indent:0;font-weight:700}.b p+p{margin-top:14px}
  .f{text-align:center;font-size:${t.footerSize}px;color:${t.accent};letter-spacing:3px}
  </style></head><body><div id="c"><div class="fr"></div><div class="pad">
  <div class="h">${t.emblem ? `<div class="m">${t.emblem}</div>` : ''}<h1>${brandTitle}</h1><div class="t">${title}</div></div>
  <div class="rule"></div><div class="b">${body}</div><div class="f">${footer || ''}</div></div></div></body></html>`;
}

export async function renderImage(browser, { brandTitle, title, paragraphs, footer, theme, outDir }) {
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const file = outDir + 'render.html';
  writeFileSync(file, buildHtml({ brandTitle, title, paragraphs, footer, theme: t }));
  const out = outDir + `post-${Date.now()}.png`;
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: t.scale });
  await page.goto('file://' + file, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  await page.close();
  return out;
}
