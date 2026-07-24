#!/bin/sh
# 打包并后台启动 Pi-a 桌面 App（窗口常驻、命令立即返回）。
# deno task 的内置 shell 不支持重定向/后台，故逻辑放此脚本，由系统 sh 执行。
set -e

cd "$(dirname "$0")/.."

# 1) 清理旧实例
pkill laufey_webview 2>/dev/null || true

# 2) 打包前端 + 生成内嵌资源
cd frontend && npm run build && cd ..
deno run --allow-read --allow-write scripts/gen-frontend.ts

# 3) 后台启动桌面 App：deno desktop 会先打包（产出 Pi-a.app）再运行，
#    用 nohup + 子 shell 让其脱离当前 shell 常驻，窗口随用户操作独立存活。
( nohup deno desktop --output Pi-a.app --icon resources/app-icon.png \
    --allow-read --allow-write --allow-env --allow-net \
    --allow-ffi --allow-sys --allow-run --allow-scripts main.ts \
    > /tmp/pi-a-app.log 2>&1 & )

echo "Pi-a 已启动（窗口即将弹出，日志见 /tmp/pi-a-app.log）"
