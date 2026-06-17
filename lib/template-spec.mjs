// 模板「规范」：模板的统一结构定义 + 校验 + 默认值 + 喂 AI 的规范说明。
// 模板 = 内容生成规则(content) + 配图样式(visual) + 适用平台(platforms) + 话题/文案壳。

export const SUPPORTED_PLATFORMS = ['xhs', 'douyin', 'wxsph'];
export const PLATFORM_LABEL = { xhs: '小红书', douyin: '抖音', wxsph: '视频号' };
export const PLATFORM_TITLE_MAX = { xhs: 20, douyin: 30, wxsph: 22 };

// 从模板反推「复刻提示词」：含精确规格，丢给「AI 生成模板」可造出一模一样的模板。
export function buildPromptFromTemplate(tpl) {
  const t = tpl || {};
  const s = t.spec || {};
  const c = s.content || {};
  const v = s.visual || {};
  const plats = (t.platforms || []).map((p) => PLATFORM_LABEL[p] || p).join('、');
  const pr = Array.isArray(c.paragraphs) ? c.paragraphs : [4, 6];
  const cr = Array.isArray(c.charRange) ? c.charRange : [150, 240];
  const tm = s.titleMaxLen || {};
  const L = [];
  L.push('做一个社媒内容模板，请严格按以下规格设置（配图颜色/字体务必用给定的精确值）：');
  L.push(`- 名称：${t.name || ''}`);
  if (t.description) L.push(`- 一句话说明：${t.description}`);
  L.push(`- 适用平台：${plats || '小红书'}`);
  L.push(`- 账号人设：${c.persona || ''}`);
  L.push(`- 文体风格：${c.style || ''}`);
  L.push(`- 每条 ${pr[0]}-${pr[1]} 段，总字数 ${cr[0]}-${cr[1]}`);
  if (c.titleHint) L.push(`- 标题要求：${c.titleHint}`);
  if (c.extraRules) L.push(`- 额外约束：${c.extraRules}`);
  if (c.footer) L.push(`- 配图底部落款：${c.footer}`);
  L.push('- 配图样式（精确值）：');
  L.push(`    背景 bg：${v.bg || ''}`);
  L.push(`    正文色 ink：${v.ink || ''}；点缀色 accent：${v.accent || ''}`);
  L.push(`    标题字体：${v.titleFont || ''}；正文字体：${v.bodyFont || ''}`);
  L.push(`    顶部图标 emblem：${v.emblem || '(无)'}；边框 frame：${v.frame || 'dashed'}；纹理 texture：${v.texture ? '有' : '无'}`);
  L.push(`    尺寸 ${v.width || 1080}×${v.height || 1440}，倍率 ${v.scale || 2}；字号 品牌${v.brandSize || 84}/标题${v.titleSize || 46}/正文${v.bodySize || 42}/落款${v.footerSize || 30}`);
  if ((s.hashtags || []).length) L.push(`- 话题（不带#）：${(s.hashtags || []).join('、')}`);
  if (s.captionTemplate) L.push(`- 正文模板：${s.captionTemplate}`);
  L.push(`- 标题上限：小红书 ${tm.xhs ?? 20}、抖音 ${tm.douyin ?? 30}、视频号 ${tm.wxsph ?? 22}`);
  return L.join('\n');
}

// 一个可直接用的默认模板（黑板朗读风，作为新建/兜底基线）。
export function defaultTemplate() {
  return {
    name: '新模板',
    description: '',
    platforms: ['xhs'],
    spec: {
      content: {
        persona: '内容创作者',
        style: '原创中文短文，朗朗上口、温暖有力',
        paragraphs: [4, 6],
        charRange: [150, 240],
        titleHint: '不超过16字、有钩子',
        extraRules: '不要话题标签、不要emoji、不要markdown、标题不要书名号',
        footer: '',
      },
      visual: {
        bg: 'radial-gradient(circle at 16% 12%,rgba(255,255,255,.05),transparent 40%),linear-gradient(160deg,#2c5440,#244a39 52%,#1b3a2c)',
        ink: '#fbfaf3', accent: '#ecd479',
        titleFont: '"Songti SC","STSong",serif', bodyFont: '"PingFang SC",sans-serif',
        emblem: '🎙️', frame: 'dashed', texture: true,
        width: 1080, height: 1440, scale: 2,
        brandSize: 84, titleSize: 46, bodySize: 42, footerSize: 30,
      },
      hashtags: [],
      captionTemplate: '{title}\n{hashtags}',
      titleMaxLen: { ...PLATFORM_TITLE_MAX },
    },
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);
const pair = (v) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);

// 校验 + 归一化（补默认、纠正类型）。返回 {ok, errors[], value}。
export function validateTemplate(input) {
  const errors = [];
  const d = defaultTemplate();
  const t = isObj(input) ? input : {};
  const out = { name: '', description: '', platforms: [], spec: {} };

  out.name = isStr(t.name) && t.name.trim() ? t.name.trim() : (errors.push('name 必填'), '未命名');
  out.description = isStr(t.description) ? t.description : '';

  const plats = Array.isArray(t.platforms) ? t.platforms.filter((p) => SUPPORTED_PLATFORMS.includes(p)) : [];
  if (!plats.length) errors.push('platforms 至少一个有效平台（xhs/douyin）');
  out.platforms = plats.length ? [...new Set(plats)] : ['xhs'];

  const s = isObj(t.spec) ? t.spec : {};
  const c = isObj(s.content) ? s.content : {};
  const dc = d.spec.content;
  out.spec.content = {
    persona: isStr(c.persona) && c.persona.trim() ? c.persona.trim() : dc.persona,
    style: isStr(c.style) && c.style.trim() ? c.style.trim() : dc.style,
    paragraphs: pair(c.paragraphs) ? c.paragraphs.map((n) => Math.max(1, Math.round(n))) : dc.paragraphs,
    charRange: pair(c.charRange) ? c.charRange.map((n) => Math.max(20, Math.round(n))) : dc.charRange,
    titleHint: isStr(c.titleHint) ? c.titleHint : dc.titleHint,
    extraRules: isStr(c.extraRules) ? c.extraRules : dc.extraRules,
    footer: isStr(c.footer) ? c.footer : '',
  };

  const v = isObj(s.visual) ? s.visual : {};
  const dv = d.spec.visual;
  const str = (k) => (isStr(v[k]) && v[k].trim() ? v[k] : dv[k]);
  const num = (k) => (isNum(v[k]) ? v[k] : dv[k]);
  out.spec.visual = {
    bg: str('bg'), ink: str('ink'), accent: str('accent'),
    titleFont: str('titleFont'), bodyFont: str('bodyFont'),
    emblem: isStr(v.emblem) ? v.emblem : dv.emblem,
    frame: ['dashed', 'solid', 'none'].includes(v.frame) ? v.frame : dv.frame,
    texture: typeof v.texture === 'boolean' ? v.texture : dv.texture,
    width: num('width'), height: num('height'), scale: num('scale'),
    brandSize: num('brandSize'), titleSize: num('titleSize'), bodySize: num('bodySize'), footerSize: num('footerSize'),
  };

  out.spec.hashtags = Array.isArray(s.hashtags) ? s.hashtags.filter(isStr).map((x) => x.replace(/^#/, '').trim()).filter(Boolean) : [];
  out.spec.captionTemplate = isStr(s.captionTemplate) && s.captionTemplate.trim() ? s.captionTemplate : d.spec.captionTemplate;

  const tm = isObj(s.titleMaxLen) ? s.titleMaxLen : {};
  out.spec.titleMaxLen = {};
  for (const p of SUPPORTED_PLATFORMS) out.spec.titleMaxLen[p] = isNum(tm[p]) ? Math.round(tm[p]) : PLATFORM_TITLE_MAX[p];

  return { ok: errors.length === 0, errors, value: out };
}

// 喂给 AI 的「规范」说明：让它产出/修改符合上面结构的模板 JSON。
export const SPEC_PROMPT = `模板是一个 JSON 对象，结构严格如下（只输出 JSON，不要解释、不要 markdown 围栏）：
{
  "name": "模板名(短)",
  "description": "一句话说明",
  "platforms": ["xhs"|"douyin", ...],            // 适用平台，至少1个，仅限 xhs(小红书)/douyin(抖音)
  "spec": {
    "content": {                                  // 决定 AI 写什么文案
      "persona": "账号人设，如：治愈系英语朗读号",
      "style": "文体风格描述",
      "paragraphs": [最少段, 最多段],              // 如 [4,6]
      "charRange": [最少字, 最多字],               // 如 [150,240]
      "titleHint": "标题要求，如 不超过16字有钩子",
      "extraRules": "额外约束，如 不要emoji不要markdown",
      "footer": "配图底部落款(可空)"
    },
    "visual": {                                   // 决定配图长什么样(CSS 值)
      "bg": "CSS background 值(可用渐变)",
      "ink": "正文色 #hex", "accent": "点缀色 #hex",
      "titleFont": "CSS font-family", "bodyFont": "CSS font-family",
      "emblem": "顶部图标emoji(可空)",
      "frame": "dashed"|"solid"|"none",
      "texture": true|false,
      "width": 1080, "height": 1440, "scale": 2,
      "brandSize": 84, "titleSize": 46, "bodySize": 42, "footerSize": 30
    },
    "hashtags": ["话题1","话题2"],                 // 不带 # 号
    "captionTemplate": "正文模板，可含占位 {title} {hashtags}",
    "titleMaxLen": { "xhs": 20, "douyin": 30 }
  }
}
配色要协调（深底配浅字或浅底配深字，accent 要醒目）。中文字体常用 "Songti SC"/"STSong"(衬线) 与 "PingFang SC"(黑体)、"Kaiti SC"(楷体)。`;
