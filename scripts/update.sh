#!/usr/bin/env bash
# Insof ERP — serverdagi ilovani yangilash (git pull → migrate → build → restart).
#
# Serverda:            bash /var/www/insof-erp/scripts/update.sh
# Lokal kompyuterdan:  ssh root@<VPS-IP> 'bash /var/www/insof-erp/scripts/update.sh'
#
# Build muvaffaqiyatsiz bo'lsa eski versiya ishlayveradi — xizmat faqat build o'tgandan keyin qayta yuklanadi.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/insof-erp}"
APP_USER="${APP_USER:-insof}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-insof-erp}"

cd "$APP_DIR"
RUN() { if [ "$(id -un)" = "$APP_USER" ]; then bash -lc "$1"; else sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && $1"; fi; }

OLD="$(git rev-parse --short HEAD)"
echo "→ Kod yangilanmoqda ($BRANCH)…"
RUN "git fetch origin $BRANCH && git reset --hard origin/$BRANCH"
NEW="$(git rev-parse --short HEAD)"
[ "$OLD" = "$NEW" ] && echo "· o'zgarish yo'q ($NEW) — baribir qayta quramiz" || echo "· $OLD → $NEW"

echo "→ Paketlar…";        RUN "npm ci"
echo "→ Migratsiyalar…";   RUN "npx prisma migrate deploy"
echo "→ Build…";           RUN "npm run build"

echo "→ Qayta ishga tushirish…"
systemctl restart "$SERVICE"
sleep 3
if systemctl is-active --quiet "$SERVICE"; then
  echo "✓ Tayyor: $NEW · $(systemctl show -p ActiveEnterTimestamp --value "$SERVICE")"
else
  echo "✗ Xizmat ko'tarilmadi — oxirgi loglar:" >&2
  journalctl -u "$SERVICE" -n 40 --no-pager >&2
  exit 1
fi
