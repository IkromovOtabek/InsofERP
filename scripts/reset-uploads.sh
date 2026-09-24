#!/usr/bin/env bash
# Yuklangan fayllarni tozalash — faqat mobil ilova APK si qoladi.
#
#   bash scripts/reset-uploads.sh          # nima o'chishini ko'rsatadi
#   bash scripts/reset-uploads.sh --yes    # o'chiradi
#
# Baza tozalangach shartnoma/hujjat/suratlar yetim qoladi, shuning uchun
# uploads/ ichidagi hamma narsa o'chiriladi; *.apk saqlanadi (ilova yuklab
# olish havolasi ishlab turishi uchun).
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${UPLOADS_DIR:-$ROOT/uploads}"

[ -d "$DIR" ] || { echo "uploads papkasi topilmadi: $DIR"; exit 1; }

LIST="$(mktemp)"; KEEP="$(mktemp)"
trap 'rm -f "$LIST" "$KEEP"' EXIT
find "$DIR" -type f ! -iname '*.apk' | sort > "$LIST"
find "$DIR" -type f   -iname '*.apk' | sort > "$KEEP"

echo "Papka: $DIR"
echo
echo "Saqlanadi ($(wc -l < "$KEEP" | tr -d ' ')):"
while IFS= read -r f; do echo "  + ${f#"$DIR"/}  ($(du -h "$f" | cut -f1))"; done < "$KEEP"
echo
echo "O'chiriladi ($(wc -l < "$LIST" | tr -d ' ')):"
while IFS= read -r f; do echo "  - ${f#"$DIR"/}"; done < "$LIST"

if [ "${1:-}" != "--yes" ]; then
  echo
  echo "Hech narsa o'chirilmadi. Tasdiqlash: bash scripts/reset-uploads.sh --yes"
  exit 0
fi

while IFS= read -r f; do rm -f "$f"; done < "$LIST"
# Bo'shab qolgan papkalarni yig'ishtirish (uploads o'zi qoladi)
find "$DIR" -mindepth 1 -type d -empty -delete 2>/dev/null || true
echo
echo "Tayyor. Qolgan fayllar:"
find "$DIR" -type f | sed "s|^$DIR/|  |"
