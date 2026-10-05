#!/bin/bash
# QA (C): test serverini qayta qurish va ishga tushirish (port 3203). Faqat shu worktree ichida.
#   QA_LOG_DIR=/tmp/qa bash scripts/qa/c-rebuild.sh
set -e
cd "$(dirname "$0")/../.."
LOG="${QA_LOG_DIR:-/tmp}"
pkill -f "next start -p 3203" 2>/dev/null || true
npx next build > "$LOG/c-build.log" 2>&1 || { tail -30 "$LOG/c-build.log"; exit 1; }
nohup npx next start -p 3203 > "$LOG/c-server.log" 2>&1 &
for i in $(seq 1 60); do
  curl -sf http://localhost:3203/api/health >/dev/null && { echo "server tayyor"; exit 0; }
  sleep 1
done
echo "server ishga tushmadi"; tail -30 "$LOG/c-server.log"; exit 1
