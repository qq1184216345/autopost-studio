#!/bin/bash
# autopost-studio 一键脚本（macOS 双击运行，或命令行： ./go.command <run|build|release> ...）
#   run               本机一键启动/初始化：装依赖 → 开 App（有打包版开 .app，否则起服务开浏览器）
#   build             打包可发送安装包：stage + tauri build → 压成 zip（含给收件人的「安装.command」）
#   release [版本] [说明]   发版热更新：升版本 → 生成 dist/release.json →（有 upload 钩子则）上传
# 双击无参数时进入交互菜单。
set -euo pipefail
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
cd "$(cd "$(dirname "$0")" && pwd)"
ROOT="$(pwd)"

c_ok(){ printf "\033[32m%s\033[0m\n" "$*"; }
c_warn(){ printf "\033[33m%s\033[0m\n" "$*"; }
c_err(){ printf "\033[31m%s\033[0m\n" "$*"; }
need_node(){ command -v node >/dev/null 2>&1 || { c_err "未找到 Node（≥22.5）。请先安装：https://nodejs.org"; exit 1; }; }

ensure_deps(){
  need_node
  if [ ! -d node_modules ] || [ ! -d node_modules/playwright-core ]; then
    c_warn "安装依赖（npm install）…"; npm install
  fi
}

cmd_run(){
  ensure_deps
  APP="src-tauri/target/release/bundle/macos/autopost-studio.app"
  if [ -d "$APP" ]; then
    c_ok "打开已打包的 App：$APP"; open "$APP"; exit 0
  fi
  c_warn "未发现打包版 App，改为本机起服务 + 浏览器（想要桌面 App 跑 ./go.command build）"
  # 释放端口后台起服务
  lsof -ti:8787 2>/dev/null | xargs kill -9 2>/dev/null || true
  ( node server.mjs >/tmp/autopost-studio.log 2>&1 & )
  for i in $(seq 1 30); do curl -s -o /dev/null http://127.0.0.1:8787/ && break; sleep 0.5; done
  c_ok "已启动 → http://127.0.0.1:8787"; open "http://127.0.0.1:8787"
}

cmd_build(){
  need_node
  command -v cargo >/dev/null 2>&1 || { c_err "未找到 cargo/Rust（打包需要）。安装：https://rustup.rs"; exit 1; }
  ensure_deps
  VER="$(cat VERSION 2>/dev/null | tr -d '[:space:]')"; VER="${VER:-1.0.0}"
  c_warn "打包 v${VER}（stage + tauri build，首次编译较久）…"
  npm run app:build
  APP="src-tauri/target/release/bundle/macos/autopost-studio.app"
  [ -d "$APP" ] || { c_err "未生成 .app"; exit 1; }
  OUT="$ROOT/dist-installer"; mkdir -p "$OUT"
  STAGE="$(mktemp -d)"; cp -R "$APP" "$STAGE/"
  # 给收件人的一键安装脚本（去隔离 + 移到 /应用程序 + 启动）
  cat > "$STAGE/安装.command" <<'INS'
#!/bin/bash
cd "$(cd "$(dirname "$0")" && pwd)"
APP="autopost-studio.app"
echo "正在安装 $APP …"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
rm -rf "/Applications/$APP" 2>/dev/null || true
cp -R "$APP" /Applications/ && xattr -dr com.apple.quarantine "/Applications/$APP" 2>/dev/null || true
open "/Applications/$APP" && echo "已安装并启动。以后在「启动台/应用程序」里打开即可。"
INS
  chmod +x "$STAGE/安装.command"
  cat > "$STAGE/使用说明.txt" <<TXT
autopost-studio v$VER

安装：双击「安装.command」（会把 App 装到「应用程序」并首次启动）。
若提示「无法打开/已损坏」：因为未做苹果公证，安装脚本已自动去隔离；
 仍不行就右键 App →「打开」一次即可。

需要：本机装有 Chrome / Edge / Brave（Chromium 内核）浏览器。
首次进入「设置」选择浏览器、填 AI 密钥即可使用。
TXT
  ZIP="$OUT/autopost-studio-v$VER.zip"
  rm -f "$ZIP"; ( cd "$STAGE" && zip -q -r -y "$ZIP" "autopost-studio.app" "安装.command" "使用说明.txt" )
  rm -rf "$STAGE"
  c_ok "安装包已生成：$ZIP"
  c_ok "直接把这个 zip 发给别人即可。"
  open "$OUT"
}

cmd_release(){
  need_node; ensure_deps
  VER="${1:-}"; shift || true; NOTES="${*:-}"
  if [ -z "$VER" ]; then
    CUR="$(cat VERSION 2>/dev/null | tr -d '[:space:]')"
    read -r -p "新版本号（当前 ${CUR:-?}，如 1.0.1）： " VER
    [ -z "$NOTES" ] && read -r -p "更新说明： " NOTES
  fi
  node scripts/build-update.mjs "$VER" "$NOTES"
  REL="$ROOT/dist/release.json"
  if [ -x scripts/upload.sh ]; then
    c_warn "调用 scripts/upload.sh 上传…"; ./scripts/upload.sh "$REL" && c_ok "已上传。用户 App 即可热更新到 v${VER} 。"
  else
    c_ok "已生成：$REL"
    c_warn "把它上传到你的 update_url 指向的地址即完成发版（可写 scripts/upload.sh 自动化，见 scripts/upload.sh.example）。"
  fi
}

menu(){
  echo "================ autopost-studio 一键脚本 ================"
  echo "  1) 本机启动/初始化   （开 App / 起服务）"
  echo "  2) 打包安装包         （出 .app + zip，可发送）"
  echo "  3) 发版热更新         （生成 release.json）"
  echo "  q) 退出"
  read -r -p "选择 [1/2/3/q]： " ch
  case "$ch" in
    1) cmd_run ;;
    2) cmd_build ;;
    3) cmd_release ;;
    *) exit 0 ;;
  esac
}

case "${1:-}" in
  run) cmd_run ;;
  build) cmd_build ;;
  release) shift; cmd_release "$@" ;;
  "") menu ;;
  *) echo "用法: ./go.command <run|build|release [版本] [说明]>"; exit 1 ;;
esac
