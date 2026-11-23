#!/usr/bin/env bash
# 发布整个 neon-snake-3d 工程到公开仓库 main（GitHub Pages）。
# 边界：仓库根目录即本工程目录，工程目录之外的任何文件不得进入。
# 用法：bash tools/publish_site.sh
set -euo pipefail
cd "$(dirname "$0")/.."

python tools/build_single.py

git add -A
if ! git diff --cached --quiet; then
  git commit -m "Publish site update

Co-Authored-By: Claude Code <noreply@anthropic.com>"
fi

git push origin dev:main
echo "已发布：https://yjm-only1.github.io/neon-snake-3d/"