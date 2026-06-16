#!/bin/bash
# 把 release.json 发布到 GitHub Releases（qq1184216345/autopost-studio）。
# 由 go.command release 自动调用：./scripts/upload.sh <release.json 绝对路径>
# 前置一次性：brew install gh && gh auth login（仓库需为【公开】，App 才能匿名拉取）。
set -euo pipefail
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
REL="${1:?用法: upload.sh <release.json 路径>}"
REPO="qq1184216345/autopost-studio"

command -v gh >/dev/null 2>&1 || { echo "需要 gh：brew install gh 然后 gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh 未登录：先跑 gh auth login"; exit 1; }

VER="$(node -e "process.stdout.write(require('$REL').version)")"
NOTES="$(node -e "process.stdout.write(require('$REL').notes||'release')")"
TAG="v$VER"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "覆盖已存在的 ${TAG} 资产 …"
  gh release upload "$TAG" "$REL" --repo "$REPO" --clobber
else
  echo "创建 release ${TAG} …"
  gh release create "$TAG" "$REL" --repo "$REPO" --title "$TAG" --notes "$NOTES" --latest
fi
echo "✅ 已发布 ${TAG}"
echo "App 内置默认 update_url = https://github.com/$REPO/releases/latest/download/release.json"
