// 浏览器管理：检测本机已装的 Chromium 系浏览器；按账号启动（自管 profile / 外部 CDP）；渲染用临时浏览器；登录窗口。
// 不打包 Chromium —— 用用户自己装的浏览器(executablePath)；指纹浏览器走外部 CDP。
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA_DIR, getSettings } from './db.mjs';

// 平台创作者页（登录用）
export const PLATFORM_LOGIN = {
  xhs: 'https://creator.xiaohongshu.com',
  douyin: 'https://creator.douyin.com',
};

// —— 检测已装浏览器（跨平台设计，先实现 macOS）——
const MAC_CANDIDATES = [
  { name: 'Google Chrome', app: 'Google Chrome' },
  { name: 'Microsoft Edge', app: 'Microsoft Edge' },
  { name: 'Brave', app: 'Brave Browser' },
  { name: 'Chromium', app: 'Chromium' },
  { name: 'Vivaldi', app: 'Vivaldi' },
  { name: 'Opera', app: 'Opera' },
  { name: 'Arc', app: 'Arc' },
  { name: 'Google Chrome Canary', app: 'Google Chrome Canary' },
];

export function detectBrowsers() {
  const out = [];
  if (process.platform === 'darwin') {
    for (const c of MAC_CANDIDATES) {
      for (const base of ['/Applications', `${process.env.HOME}/Applications`]) {
        const macos = `${base}/${c.app}.app/Contents/MacOS`;
        if (existsSync(macos)) {
          const bin = readdirSync(macos)[0];
          if (bin) { out.push({ name: c.name, path: `${macos}/${bin}` }); break; }
        }
      }
    }
  } else if (process.platform === 'win32') {
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean);
    const cands = [
      ['Google Chrome', 'Google\\Chrome\\Application\\chrome.exe'],
      ['Microsoft Edge', 'Microsoft\\Edge\\Application\\msedge.exe'],
      ['Brave', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    ];
    for (const [name, rel] of cands) for (const r of roots) { const p = resolve(r, rel); if (existsSync(p)) { out.push({ name, path: p }); break; } }
  } else {
    for (const [name, p] of [['Google Chrome', '/usr/bin/google-chrome'], ['Chromium', '/usr/bin/chromium'], ['Microsoft Edge', '/usr/bin/microsoft-edge'], ['Brave', '/usr/bin/brave-browser']]) if (existsSync(p)) out.push({ name, path: p });
  }
  return out;
}

const profileDir = (accountId) => {
  const d = resolve(DATA_DIR, 'profiles', `acc-${accountId}`);
  mkdirSync(d, { recursive: true });
  return d;
};

const LAUNCH_ARGS = ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'];

// 取某账号的发布用上下文。返回 { ctx, close }。managed=启动用户浏览器(独立profile)；cdp=连外部指纹浏览器。
export async function launchForAccount(account, settings = getSettings()) {
  if (account.conn_mode === 'cdp') {
    if (!account.cdp_url) throw new Error('该账号是外部 CDP 模式，但未填 CDP 地址');
    const browser = await chromium.connectOverCDP(account.cdp_url);
    return { ctx: browser.contexts()[0], close: () => browser.close().catch(() => {}) };
  }
  if (!settings.browser_path) throw new Error('请先到「设置」选择浏览器（检测并选一个 Chrome/Edge/Brave）');
  const ctx = await chromium.launchPersistentContext(profileDir(account.id), {
    executablePath: settings.browser_path, headless: false, viewport: null, args: LAUNCH_ARGS,
  });
  return { ctx, close: () => ctx.close().catch(() => {}) };
}

// 渲染专用临时浏览器（HTML→PNG，无需登录）。返回 { browser, close }。
export async function launchScratch(settings = getSettings()) {
  if (!settings.browser_path) throw new Error('请先到「设置」选择浏览器');
  const browser = await chromium.launch({ executablePath: settings.browser_path, headless: true, args: LAUNCH_ARGS });
  return { browser, close: () => browser.close().catch(() => {}) };
}

// —— 登录窗口：开 headed 持久化上下文 + 平台创作者页，用户在里面登录；profile 落盘持久。——
const loginCtxs = new Map(); // accountId -> ctx
export async function openLogin(account, settings = getSettings()) {
  if (account.conn_mode === 'cdp') throw new Error('外部 CDP 模式请在指纹浏览器里直接登录');
  if (!settings.browser_path) throw new Error('请先到「设置」选择浏览器');
  if (loginCtxs.has(account.id)) return { ok: true, already: true };
  const ctx = await chromium.launchPersistentContext(profileDir(account.id), {
    executablePath: settings.browser_path, headless: false, viewport: null, args: LAUNCH_ARGS,
  });
  loginCtxs.set(account.id, ctx);
  ctx.on('close', () => loginCtxs.delete(account.id));
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(PLATFORM_LOGIN[account.platform] || 'about:blank').catch(() => {});
  return { ok: true };
}
export async function closeLogin(accountId) {
  const ctx = loginCtxs.get(accountId);
  if (ctx) { await ctx.close().catch(() => {}); loginCtxs.delete(accountId); }
  return { ok: true };
}
