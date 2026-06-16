// AI（OpenAI 兼容，默认 Agnes）。密钥/base/model 从 settings 读，兜底环境变量——不硬编码。
// 三件事：genContent(按模板出草稿文案) / generateTemplate(大白话→模板) / editTemplate(改模板)。
import { getSettings } from './db.mjs';
import { SPEC_PROMPT, validateTemplate } from './template-spec.mjs';

function creds() {
  const s = getSettings();
  return {
    key: s.ai_key || process.env.OPENAI_API_KEY || '',
    base: s.ai_base || process.env.OPENAI_BASE_URL || 'https://apihub.agnes-ai.com/v1',
    model: s.ai_model || process.env.OPENAI_MODEL || 'agnes-2.0-flash',
  };
}

async function chat(messages, { model } = {}) {
  const { key, base, model: m } = creds();
  if (!key) throw new Error('未配置 AI 密钥（到「设置」填入 ai_key，或设环境变量 OPENAI_API_KEY）');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: model || m, messages }),
  });
  if (!res.ok) throw new Error(`AI 请求失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || '').trim();
}

const parseJson = (raw) => {
  const s = raw.replace(/```json|```/g, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
};

const r2 = (v, d) => (Array.isArray(v) && v.length === 2 ? v : d);

// 1) 按模板的 content 生成一条草稿文案 → { title, paragraphs[] }
export async function genContent({ brandTitle, template, theme }) {
  const c = (template?.spec?.content) || template?.content || {};
  const [pmin, pmax] = r2(c.paragraphs, [4, 6]);
  const [cmin, cmax] = r2(c.charRange, [150, 240]);
  const sys = `你是账号「${brandTitle || c.persona || '内容创作者'}」（${c.persona || '内容创作者'}）的文案作者。`
    + `写一段${c.style || '原创中文短文'}：`
    + (theme ? `主题围绕「${theme}」；` : '主题自拟；')
    + `${pmin}到${pmax}个短段落，每段1-2句；总字数${cmin}-${cmax}；`
    + (c.extraRules ? c.extraRules + '；' : '')
    + `再起一个${c.titleHint || '简短有钩子'}的标题。只输出JSON：{"title":"...","paragraphs":["...","..."]}`;
  const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: theme || '来一段' }]);
  const obj = parseJson(raw);
  if (!obj.title || !Array.isArray(obj.paragraphs)) throw new Error('AI 文案返回异常: ' + raw.slice(0, 160));
  return obj;
}

// 内部：让 AI 产出模板 JSON 并校验，非法则带错误重试一次。
async function aiTemplate(userMsg, baseSystem) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys = baseSystem + (attempt ? '\n上次输出不符合规范，请严格按结构重新输出合法 JSON。' : '');
    const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: userMsg }]);
    let obj; try { obj = parseJson(raw); } catch { continue; }
    const { ok, value, errors } = validateTemplate(obj);
    if (ok) return value;
    if (attempt) return value; // 第二次仍不完美也返回归一化结果（已补默认）
  }
  throw new Error('AI 未能产出合法模板');
}

// 2) 大白话 → 新模板
export async function generateTemplate(nlText) {
  return aiTemplate(nlText, `你是模板设计助手。根据用户的大白话需求，设计一个社媒内容模板。\n${SPEC_PROMPT}`);
}

// 3) 大白话指令 → 修改现有模板（保留未提及字段）
export async function editTemplate(existing, nlInstruction) {
  const base = `你是模板设计助手。下面是现有模板 JSON，请按用户指令修改，未提及的字段保持不变，输出完整的修改后模板 JSON。\n${SPEC_PROMPT}\n\n现有模板：\n${JSON.stringify(existing)}`;
  return aiTemplate(nlInstruction, base);
}
