# autopost-studio

模板 / 账号 / 草稿箱一体的**通用社媒自动发布系统**。本地 SQLite 存数据、`uploads/` 存文件、自托管 UI 自动化发布（小红书 / 抖音），**零官方依赖**、无硬编码。

## 能做什么
- **模板管理**：模板 = 文案生成规则 + 配图样式 + 适用平台 + 话题 + 文案壳。可手工编辑，也可
- **AI 大白话管模板**：一句话**生成**新模板、一句话**修改**现有模板（AI 遵循内置规范产出合法模板）。
- **账号管理**：增删改，每账号绑定平台 + 指纹浏览器 CDP 地址。
- **草稿箱**：草稿关联模板；AI 出文案 + 自动渲染配图，或自己上传图；
  - **一稿多发**：同一草稿可发多个账号（账号平台须在模板适用平台内、**单账号对同一草稿不可重复**）；
  - 按**平台**、**待发布/已发布**筛选；可**批量删除**；
  - 选目标账号 + 模式（存草稿 / 直接发布）→ **实时日志**看发布过程，逐账号状态回写。
- **暗/亮主题**跟随系统、配图所见即所得预览、自适应缩放。

## 技术
- **纯 Node**（≥22.5），内置 `node:sqlite` —— **零原生依赖**，不用编译 better-sqlite3。
- 发布/渲染复用已跑通的 Playwright UI 自动化（`lib/publishers/`、`lib/render.mjs`），对接**外部指纹浏览器**的 CDP。
- 前端原生单页（`web/`），后端 Node 内置 http（`server.mjs`）。
- 数据：`data/app.db`（SQLite）。文件：`uploads/`。两者均 gitignore。

## 一键脚本（`go.command`）
macOS 下**双击 `go.command`** 进入菜单，或命令行：
```bash
./go.command run                 # 本机启动：装依赖→开 App（有打包版开 .app，否则起服务开浏览器）
./go.command build               # 打包：出 .app → 压成 zip（含给收件人的「安装.command」）→ dist-installer/
./go.command release 1.0.1 "说明" # 发版热更新：升版本→生成 dist/release.json→(有 scripts/upload.sh 则自动上传)
```
- 发版自动上传：把 `scripts/upload.sh.example` 复制为 `scripts/upload.sh` 填入你的上传命令（scp/gh/oss）。
- `build` 产出的 zip 直接发给别人，对方双击里面的「安装.command」即可装好（自动去隔离，免被 Gatekeeper 拦）。

## 跑起来
```bash
npm install          # 装 playwright-core
node server.mjs      # 或 npm start  →  http://127.0.0.1:8787（仅绑本机）
```
首启自动建表。然后：
1. **设置**页填 `ai_key`（OpenAI 兼容，如 Agnes）、`ai_base`、`ai_model`、`default_cdp_url`（渲染/发布连接的指纹浏览器调试地址，如 `http://127.0.0.1:9223`）。
2. **模板**页「AI 生成模板」用大白话造一个，或「新建模板」手工建。
3. **账号**页加账号（平台 + 各自的 CDP 地址）。
4. **草稿箱**「新建草稿」→选模板→「AI 出内容+配图」（或上传图）→加目标账号→发布。

## 前置
- 每个要发布的账号，先在**指纹浏览器**里登录、开放 CDP（不同账号可不同端口）。同一指纹空间可同时登录多平台（如小红书+抖音同在一个 9223），发布时复用一条连接。
- 一个 OpenAI 兼容的 AI 网关密钥（文案/模板生成用）。

## 结构
```
server.mjs              HTTP API + 静态 + SSE + 上传
lib/
  db.mjs                node:sqlite 建表/查询/批量删除/settings
  template-spec.mjs     模板「规范」：结构定义 + 校验 + 喂 AI 的 SPEC_PROMPT
  ai.mjs                AI：genContent / generateTemplate / editTemplate（密钥从 settings 读）
  render.mjs            配图渲染（主题驱动）
  publish.mjs           CDP 连接 + 渲染 + 发布编排（逐 target 更新状态）
  publishers/{xhs,douyin}.mjs   各平台 UI 自动化（已跑通落地）
web/{index.html,app.js,style.css}   单页前端
data/  uploads/         本地数据 + 文件（gitignore）
```

## 数据模型
`templates`（name/description/platforms/spec）· `accounts`（name/platform/cdp_url/brand_title）· `drafts`（title/brand_title/paragraphs/hashtags/caption/image_path/template_id）· `draft_targets`（draft×account，UNIQUE(draft,account)，status: pending/publishing/published/failed）· `settings`（kv）。

## ⚠️ 风控
小红书/抖音对机器式高频发布有强风控。建议默认 **存草稿** 模式，人工在 App 终发；真发则每账号每天≤1篇、先养号、别短时间反复操作。

## 桌面 App（Tauri，自包含分发版）
用 Tauri v2 包成原生桌面 App（`src-tauri/`），**装完即用、不依赖其他软件**：
- **内置 Node 运行时**：`.app` 里打包了一份 node 二进制（`app/node`）+ 全部代码与依赖（`app/{server.mjs,lib,web,node_modules}`），启动时用**内置 node** 跑后端——**无需用户装 Node**。
- **用用户自己的浏览器**：渲染/发布驱动用户本机的 Chrome/Edge/Brave（设置里检测并选），**不打包 Chromium、不依赖指纹浏览器**。
- 数据写到用户目录 `~/Library/Application Support/com.autopost.studio/`（SQLite + uploads），不写进只读 .app 包。
- 关窗自动结束后端，不留后台进程。

```bash
npm run app          # tauri dev：开发模式（用系统 node + 项目源码，含示例数据）
npm run app:build    # tauri build：产出自包含 .app（src-tauri/target/release/bundle/macos/，约 158M）
```

打包前需把运行所需文件 stage 到 `src-tauri/app/`（node 二进制 + server.mjs/lib/web/node_modules）。当前为手动 stage；改动代码后重 stage 再 build。

**唯一前提**：用户机器装有一个 Chromium 系浏览器（Chrome/Edge/Brave）——这是「用户自己的浏览器」，App 里检测并选用，不是强加的软件依赖。

**分发到别的 Mac**：需对 `.app` 做代码签名 + 公证，否则 Gatekeeper 拦截（本机自建自用不受影响）。Windows 版后续：补 win 的 node 二进制 + 浏览器检测路径。

## 热更新（OTA）
日常的 JS/界面/逻辑改动**无需重发安装包**，App 内一键热更新：
- **运行模型**：打包版启动时把只读底座(`Resources/app`)按版本播种到用户可写的 live 目录(`~/Library/Application Support/com.autopost.studio/app`)，后端从 live 目录跑（`seed.mjs` 用 `cpSync` 正确处理 node_modules 符号链接）。
- **更新边界**：`server.mjs`/`lib`/`web`（产品逻辑/界面）→ OTA 秒级；原生壳 / Node 运行时 / 新增 npm 依赖 → 发新安装包。
- **设置 → 更新**：填 `update_url`（指向 `release.json` 的 HTTPS 地址，建议 HTTPS）。「检查更新」→ 有新版「立即更新」→ 写入 live 目录 → 壳重启后端并重载窗口；启动时也会静默检查、有更新顶部 banner 提示。
- **安全**：apply 仅打包版允许（dev 禁用防覆盖源码）；路径白名单只允许 `server.mjs`/`lib/**`/`web/**`，越界/`..`/绝对路径整体拒绝；live 目录损坏会在下次启动从底座重新播种兜底。

### 发版流程（GitHub Releases，默认源）
默认更新源已内置：`https://github.com/qq1184216345/autopost-studio/releases/latest/download/release.json`（设置里 update_url 留空即用它）。
一次性准备：
```bash
brew install gh && gh auth login            # 安装并登录 GitHub CLI
# 仓库 qq1184216345/autopost-studio 需为【公开】(App 匿名拉取 release 资产)：
gh repo create qq1184216345/autopost-studio --public   # 若还没建
```
每次发版：
```bash
./go.command release 1.0.1 "本次更新说明"
# → 生成 dist/release.json → scripts/upload.sh 用 gh 发布到 Releases(tag v1.0.1)
# 已装的用户 App 检查更新即可热更新到 1.0.1
```
底座本身（壳/node/依赖）有变动时，才需 `./go.command build` 重打 `.app` 手动发给用户。
