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
# Ko'p korxonali serverda (control.env bor) har korxona bazasi pastda `tenant migrate-all` bilan yangilanadi
if [ ! -f "$ERP_DIR/control.env" ]; then
  step "ERP: bazaga migratsiya"
  npx prisma migrate deploy
fi
npx prisma generate
step "ERP: build"
# /_next/image keshi: public/ dagi surat almashsa ham eski optimallashtirilgan nusxa qolib ketadi.
rm -rf .next/cache/images
npm run build
step "ERP: qayta ishga tushirish"
# Eski yagona xizmat — platformaga ko'chirilgach o'chirilgan bo'ladi (o'rniga insof-erp@<slug>)
if systemctl is-enabled --quiet insof-erp 2>/dev/null; then sudo systemctl restart insof-erp; fi
# Vaqt zonasi: ilova o'zi Asia/Tashkent o'rnatadi (src/instrumentation.ts), lekin server soati ham shunday bo'lsin
if [ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "Asia/Tashkent" ]; then
  echo "⚠ Server vaqt zonasi: $(timedatectl show -p Timezone --value 2>/dev/null || echo aniqlanmadi). Tavsiya: sudo timedatectl set-timezone Asia/Tashkent" >&2
fi

# ───────────── Ko'p korxonali platforma (control.env bo'lsa) ─────────────
if [ -f "$ERP_DIR/control.env" ]; then
  cd "$ERP_DIR"
  step "Platforma: control baza migratsiyasi"
  ( set -a; . ./control.env; set +a; npx prisma migrate deploy --schema prisma/control/schema.prisma )
  step "Platforma: barcha korxona bazalariga migratsiya"
  npm run -s tenant -- migrate-all
  step "Platforma: jarayonlarni qayta ishga tushirish"
  sudo systemctl restart insof-control
  for unit in $(systemctl list-units --type=service --all --no-legend 'insof-erp@*' | awk '{print $1}'); do
    sudo systemctl restart "$unit" && echo "  $unit"
  done
fi

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
if [ -f "$ERP_DIR/control.env" ]; then
  curl -fsS -o /dev/null http://127.0.0.1:3100/superadmin/login && echo "IT panel 3100 — ishlayapti" || { echo "IT panel javob bermadi: journalctl -u insof-control -n 50"; ok=0; }
  (cd "$ERP_DIR" && npm run -s tenant -- stats) || ok=0
fi
if [ "${SKIP_ECO:-0}" != "1" ]; then
  curl -fsS -o /dev/null http://127.0.0.1:3010/v1/health && echo "ECO  3010 — ishlayapti" || { echo "ECO 3010 javob bermadi: journalctl -u insof-eco -n 50"; ok=0; }
fi
APK="$ERP_DIR/uploads/app/insof-eco.apk"
[ -f "$APK" ] && echo "Android APK: $(du -h "$APK" | cut -f1), $(date -r "$APK" '+%d.%m.%Y %H:%M')" || echo "Android APK yo'q: $APK"
[ "$ok" = "1" ] && echo -e "\n\033[1;32m✓ Deploy tugadi\033[0m" || exit 1
