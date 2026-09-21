#!/usr/bin/env bash
# Prod serverda ishlaydi: ERP bazasining kunlik nusxasini oladi va eskilarini tozalaydi.
# O'rnatish (serverda, root bilan):
#   install -m 755 server-backup.sh /usr/local/bin/erp-backup
#   crontab -e   → 0 3 * * * /usr/local/bin/erp-backup >> /var/log/erp-backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/insof-erp}"   # ilova papkasi (.env shu yerda)
OUT_DIR="${OUT_DIR:-/var/backups/insof-erp}"
KEEP_DAYS="${KEEP_DAYS:-14}"               # necha kunlik nusxa saqlansin

# DATABASE_URL ni ilovaning .env faylidan o'qiydi (parol logga tushmaydi)
if [ ! -f "$APP_DIR/.env" ]; then
  echo "✗ $APP_DIR/.env topilmadi — APP_DIR ni to'g'rilang" >&2
  exit 1
fi
DB_URL="$(grep -m1 '^DATABASE_URL=' "$APP_DIR/.env" | cut -d= -f2- | tr -d '"'"'"'')"
if [ -z "$DB_URL" ]; then
  echo "✗ .env da DATABASE_URL yo'q" >&2
  exit 1
fi

# Prisma'ning `?schema=...` parametrini pg_dump tushunmaydi — ajratib olamiz.
# Sxema `public` dan boshqa bo'lsa (masalan ECO bazasidagi `erp`), faqat o'shani nusxalaymiz.
SCHEMA="$(printf '%s' "$DB_URL" | sed -n 's/.*[?&]schema=\([^&]*\).*/\1/p')"
DB_URL="${DB_URL%%\?*}"
DUMP_ARGS=()
if [ -n "$SCHEMA" ] && [ "$SCHEMA" != "public" ]; then
  DUMP_ARGS+=(-n "$SCHEMA")
fi

mkdir -p "$OUT_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
FILE="$OUT_DIR/insof-erp_$STAMP.dump"

echo "→ [$(date +'%F %T')] nusxa olinmoqda: $FILE"
# -Fc = custom format: siqilgan, pg_restore bilan tanlab tiklash mumkin
# ${DUMP_ARGS[@]+...} — bo'sh massiv `set -u` ostida xato bermasligi uchun (eski bash)
pg_dump "$DB_URL" ${DUMP_ARGS[@]+"${DUMP_ARGS[@]}"} -Fc --no-owner --no-acl -f "$FILE.tmp"
mv "$FILE.tmp" "$FILE"   # to'liq yozilgandan keyingina nomini beradi

SIZE="$(du -h "$FILE" | cut -f1)"
echo "✓ tayyor: $FILE ($SIZE)"

# Eskilarini o'chirish — faqat muvaffaqiyatli nusxadan keyin
find "$OUT_DIR" -name 'insof-erp_*.dump' -mtime "+$KEEP_DAYS" -delete
echo "→ $KEEP_DAYS kundan eski nusxalar tozalandi. Jami: $(ls -1 "$OUT_DIR"/insof-erp_*.dump 2>/dev/null | wc -l) ta"
