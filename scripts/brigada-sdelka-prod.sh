#!/usr/bin/env bash
# Brigada a'zolarini «Sdelka»ga o'tkazish — prodda (foydalanuvchi o'zi ishga tushiradi).
# 1) skript serverga /tmp ga yuklanadi; 2) pg_dump zaxira; 3) faqat zaxira muvaffaqiyatli bo'lsa — --yes.
set -euo pipefail
cd "$(dirname "$0")/.."
EXPECT="${1:-22}"
scp scripts/brigada-sdelka.ts insof:/tmp/brigada-sdelka.ts
ssh insof "set -euo pipefail
  TS=\$(date +%Y-%m-%d-%H%M)
  URL=\$(grep -E '^DATABASE_URL=' /var/www/insof-erp/tenants/insof.env | head -1 | cut -d= -f2- | tr -d '\"' | sed 's/[?&]schema=[^&]*//')
  pg_dump -Fc \"\$URL\" -f ~/insof-oldin-brigada-sdelka-\$TS.dump
  ls -lh ~/insof-oldin-brigada-sdelka-\$TS.dump
  cd /var/www/insof-erp/current
  ENV_FILE=/var/www/insof-erp/tenants/insof.env npx tsx /tmp/brigada-sdelka.ts --yes --expect $EXPECT
  rm -f /tmp/brigada-sdelka.ts"
