#!/usr/bin/env bash
# VPS'da ERP va ECO API'ni bitta buyruq bilan yangilash (deploy foydalanuvchisi ostida, root EMAS):
#   cd /var/www/insof-erp && git pull --ff-only && bash scripts/deploy.sh
#
# Nima qiladi: ikkala repo'ni tortadi → paketlar → Prisma migratsiya → build → systemd restart → tekshiruv.
# Faqat ERP kerak bo'lsa: SKIP_ECO=1 bash scripts/deploy.sh
set -euo pipefail

ERP_DIR=${ERP_DIR:-/var/www/insof-erp}
ECO_DIR=${ECO_DIR:-/var/www/insof-eco}
step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }

if [ "$(id -u)" = "0" ]; then
  echo "root bilan ishga tushirmang — node_modules egaligi buziladi. Avval: su - deploy" >&2
  exit 1
fi

# ───────────── Insof ERP ─────────────
step "ERP: git pull"
cd "$ERP_DIR"
git pull --ff-only
step "ERP: paketlar"
npm ci --no-audit --no-fund
step "ERP: bazaga migratsiya"
npx prisma migrate deploy
npx prisma generate
step "ERP: build"
# /_next/image keshi: public/ dagi surat almashsa ham eski optimallashtirilgan nusxa qolib ketadi.
rm -rf .next/cache/images
npm run build
step "ERP: qayta ishga tushirish"
sudo systemctl restart insof-erp

# ───────────── Insof ECO API ─────────────
if [ "${SKIP_ECO:-0}" != "1" ] && [ -d "$ECO_DIR" ]; then
  step "ECO: git pull"
  cd "$ECO_DIR"
  git pull --ff-only
  step "ECO: paketlar"
  yarn install --frozen-lockfile --network-timeout 600000
  yarn workspace @insof/shared build
  step "ECO: bazaga migratsiya va build"
  cd apps/api
  npx prisma migrate deploy
  npx prisma generate
  npx nest build
  step "ECO: qayta ishga tushirish"
  sudo systemctl restart insof-eco
fi

# ───────────── Tekshiruv ─────────────
step "Tekshiruv"
sleep 6
ok=1
curl -fsS -o /dev/null http://127.0.0.1:3000/login && echo "ERP  3000 — ishlayapti" || { echo "ERP 3000 javob bermadi: journalctl -u insof-erp -n 50"; ok=0; }
if [ "${SKIP_ECO:-0}" != "1" ]; then
  curl -fsS -o /dev/null http://127.0.0.1:3010/v1/health && echo "ECO  3010 — ishlayapti" || { echo "ECO 3010 javob bermadi: journalctl -u insof-eco -n 50"; ok=0; }
fi
APK="$ERP_DIR/uploads/app/insof-eco.apk"
[ -f "$APK" ] && echo "Android APK: $(du -h "$APK" | cut -f1), $(date -r "$APK" '+%d.%m.%Y %H:%M')" || echo "Android APK yo'q: $APK"
[ "$ok" = "1" ] && echo -e "\n\033[1;32m✓ Deploy tugadi\033[0m" || exit 1
