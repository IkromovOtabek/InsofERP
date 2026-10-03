#!/usr/bin/env bash
# VPS'da ERP platformasini (barcha korxonalar + IT panel) va ECO API'ni yangilash — `deploy` foydalanuvchisi ostida (root EMAS):
#   cd /var/www/insof-erp && bash scripts/deploy.sh
#
# Tuzilma (docs/deploy/PLATFORMA.md → «Relizlar»):
#   /var/www/insof-erp/                 git repo (manba) + tenants/*.env, control.env, build.env, uploads/
#   /var/www/insof-erp/releases/<sha>/  har reliz alohida: git archive → npm ci → build
#   /var/www/insof-erp/current → releases/<sha>   systemd xizmatlari shu yerdan ishlaydi
#
# Tartib (deyarli uzilishsiz, avtomatik qaytarish bilan):
#   1. git pull → releases/<sha> ga alohida build (ishlayotgan jarayonlarga tegilmaydi)
#   2. `prisma migrate deploy` — control baza va HAR korxona bazasi (almashtirishdan OLDIN; xato bo'lsa to'xtaydi)
#   3. current symlinkini atomar almashtirish
#   4. Xizmatlarni bittadan qayta ishga tushirish + /api/health tekshiruvi
#      → biri o'tmasa: current eski relizga qaytadi, qayta ishga tushirilganlar qaytariladi, exit 1
#   5. Eski relizlarni tozalash (KEEP_RELEASES, standart 3)
#
# Muhim: migratsiyalar orqaga qaytarilmaydi — kod qaytsa ham baza yangi sxemada qoladi. Shuning uchun
# migratsiyalar «kengaytiruvchi» bo'lsin (ustun qo'shish; o'chirish keyingi relizda).
#
# O'zgaruvchilar:
#   SKIP_PULL=1     git pull qilmaslik (joriy HEAD build qilinadi)
#   SKIP_ECO=1      ECO API'ni yangilamaslik
#   SKIP_RESTART=1  faqat build + migratsiya + symlink (birinchi ko'chishda — PLATFORMA.md)
#   KEEP_RELEASES=3 nechta reliz saqlansin
#   ROLLBACK=1      xizmatlarni oldingi relizga qaytarish (build qilmasdan)
set -Eeuo pipefail

APP_DIR=${APP_DIR:-/var/www/insof-erp}
ECO_DIR=${ECO_DIR:-/var/www/insof-eco}
RELEASES="$APP_DIR/releases"
CURRENT="$APP_DIR/current"
KEEP_RELEASES=${KEEP_RELEASES:-3}
CONTROL_PORT=${CONTROL_PORT:-3100}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-60}

step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── .env o'quvchi: `source` siz (fayl ichidagi kod bajarilmaydi) ──
env_get() {
  local line val
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$2[[:space:]]*=" "$1" 2>/dev/null | tail -n1 || true)"
  [ -n "$line" ] || return 0
  val="${line#*=}"
  val="${val#"${val%%[![:space:]]*}"}"
  case "$val" in
    \"*) val="${val#\"}"; val="${val%%\"*}" ;;
    \'*) val="${val#\'}"; val="${val%%\'*}" ;;
    *) val="$(printf '%s' "$val" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//')" ;;
  esac
  printf '%s' "$val"
}
# Fayldagi barcha KALIT=qiymat larni eksport qiladi (build.env uchun) — eval/source siz
export_env_file() {
  local file="$1" key
  [ -f "$file" ] || return 0
  while IFS= read -r key; do
    export "$key=$(env_get "$file" "$key")"
  done < <(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=.*/\2/p' "$file" | sort -u)
}

if [ "$(id -u)" = "0" ]; then
  die "root bilan ishga tushirmang — node_modules egaligi buziladi. Avval: su - deploy"
fi
cd "$APP_DIR"

# ── Korxonalar ro'yxati (tenants/*.env) ──
TENANTS=()
shopt -s nullglob
for f in "$APP_DIR"/tenants/*.env; do
  s="$(basename "$f" .env)"
  [[ "$s" =~ ^[a-z][a-z0-9-]{1,29}$ ]] && TENANTS+=("$s")
done
shopt -u nullglob
HAS_CONTROL=0; [ -f "$APP_DIR/control.env" ] && HAS_CONTROL=1
[ "${#TENANTS[@]}" -gt 0 ] || [ "$HAS_CONTROL" = 1 ] || die "tenants/*.env ham, control.env ham topilmadi. Eski (ildizda .env) o'rnatishni avval ko'chiring: docs/deploy/PLATFORMA.md → «Mavjud Insof'ni platformaga ko'chirish»"
[ -f "$APP_DIR/.env" ] && warn "Ildizda .env bor — Next uni har jarayonga yuklaydi (kalitlar korxonalarga sizadi). tenants/insof.env ga ko'chiring."

# Faqat yoqilgan xizmatlar qayta ishga tushiriladi
UNITS=()      # "unit|port"
for s in ${TENANTS[@]+"${TENANTS[@]}"}; do
  if systemctl is-enabled --quiet "insof-erp@$s" 2>/dev/null; then
    port="$(env_get "$APP_DIR/tenants/$s.env" PORT)"
    [ -n "$port" ] || die "tenants/$s.env da PORT yo'q"
    UNITS+=("insof-erp@$s|$port")
  fi
done
if [ "$HAS_CONTROL" = 1 ] && systemctl is-enabled --quiet insof-control 2>/dev/null; then
  UNITS+=("insof-control|$CONTROL_PORT")
fi

health() { # health <port> — /api/health 200 bo'lguncha kutadi
  local port="$1" i
  for ((i = 0; i < HEALTH_TIMEOUT; i++)); do
    if curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$port/api/health"; then return 0; fi
    sleep 1
  done
  return 1
}

switch_to() { # atomar: current.new → current
  ln -sfn "$1" "$CURRENT.new"
  mv -Tf "$CURRENT.new" "$CURRENT"
}

FAILED_UNIT=""
restart_all() { # restart_all <unit|port>... — bittadan, har biri health bilan; yiqilgani FAILED_UNIT da
  local u
  FAILED_UNIT=""
  for u in "$@"; do
    sudo systemctl restart "${u%%|*}"
    if health "${u#*|}"; then ok "${u%%|*}"; else FAILED_UNIT="${u%%|*}"; return 1; fi
  done
}

unit_check() { # repodagi unit fayllar o'rnatilganidan farq qilsa — ogohlantirish
  local name
  for name in "insof-erp@.service" "insof-control.service"; do
    [ -f "/etc/systemd/system/$name" ] || continue
    cmp -s "$APP_DIR/docs/deploy/$name" "/etc/systemd/system/$name" \
      || warn "/etc/systemd/system/$name repodagidan farq qiladi: sudo install -m 644 docs/deploy/$name /etc/systemd/system/ && sudo systemctl daemon-reload"
  done
  return 0
}

PREV="$(readlink -f "$CURRENT" 2>/dev/null || true)"

# ───────────── Qo'lda qaytarish ─────────────
if [ "${ROLLBACK:-0}" = "1" ]; then
  step "Oldingi relizga qaytarish"
  [ -n "$PREV" ] || die "current yo'q"
  TARGET="$(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '*.tmp' -printf '%T@ %p\n' | sort -rn | awk '{print $2}' | grep -vxF "$PREV" | head -n1)"
  [ -n "$TARGET" ] || die "Qaytish uchun boshqa reliz yo'q"
  switch_to "$TARGET"
  restart_all ${UNITS[@]+"${UNITS[@]}"} || die "Qaytarilgan reliz ham ishga tushmadi — journalctl -u insof-erp@<slug> -n 80"
  ok "current → $(basename "$TARGET")"
  exit 0
fi

# ───────────── 1. Build (alohida papkada) ─────────────
if [ "${SKIP_PULL:-0}" != "1" ]; then
  step "ERP: git pull"
  git pull --ff-only
fi
SHA="$(git rev-parse HEAD)"
REL="$RELEASES/$SHA"
mkdir -p "$RELEASES"

if [ -f "$REL/RELEASE" ] && [ -f "$REL/.next/BUILD_ID" ]; then
  step "Reliz ${SHA:0:7} allaqachon build qilingan — qayta ishlatiladi"
  touch "$REL"   # tozalash tartibi (mtime) uchun — eng yangisi bo'lsin
else
  step "ERP: build → releases/${SHA:0:7}"
  rm -rf "$REL.tmp"
  mkdir -p "$REL.tmp"
  git archive --format=tar "$SHA" | tar -x -C "$REL.tmp"
  (
    cd "$REL.tmp"
    # Build vaqtidagi kalitlar (NEXT_PUBLIC_* — brauzer kodiga yoziladi) faqat build.env dan.
    # Korxona sirlari (tenants/*.env) build'ga KIRMAYDI.
    if [ -f "$APP_DIR/build.env" ]; then export_env_file "$APP_DIR/build.env"; else warn "build.env yo'q — NEXT_PUBLIC_YANDEX_MAPS_KEY bo'sh bo'ladi (build.env.example)"; fi
    export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
    # npm 10: lock fayl bilan aniq o'rnatish (dev paketlar ham kerak: prisma CLI, build)
    NODE_ENV=development npm ci --no-audit --no-fund
    npm run build
  ) || { rm -rf "$REL.tmp"; die "Build xato — ishlayotgan xizmatlarga tegilmadi"; }
  echo "$SHA" > "$REL.tmp/RELEASE"
  rm -rf "$REL"
  mv "$REL.tmp" "$REL"
  ok "build tayyor: $REL"
fi

# ───────────── 2. Migratsiyalar (almashtirishdan OLDIN) ─────────────
step "Migratsiya: control va barcha korxona bazalari"
PRISMA="$REL/node_modules/.bin/prisma"
if [ "$HAS_CONTROL" = 1 ]; then
  CTRL_URL="$(env_get "$APP_DIR/control.env" CONTROL_DATABASE_URL)"
  [ -n "$CTRL_URL" ] || die "control.env da CONTROL_DATABASE_URL yo'q"
  ( cd "$REL" && env CONTROL_DATABASE_URL="$CTRL_URL" "$PRISMA" migrate deploy --schema prisma/control/schema.prisma >/dev/null ) \
    || die "control baza migratsiyasi xato — xizmatlar eski relizda qoldi"
  ok "control"
fi
declare -A MIGRATED=()
for s in ${TENANTS[@]+"${TENANTS[@]}"}; do
  url="$(env_get "$APP_DIR/tenants/$s.env" DATABASE_URL)"
  [ -n "$url" ] || die "tenants/$s.env da DATABASE_URL yo'q"
  [ -z "${MIGRATED[$url]:-}" ] || continue
  ( cd "$REL" && env DATABASE_URL="$url" "$PRISMA" migrate deploy >/dev/null ) \
    || die "$s bazasi migratsiyasi xato — xizmatlar eski relizda qoldi (oldingi korxonalar bazasi allaqachon yangilangan)"
  MIGRATED[$url]=1
  ok "$s"
done

# ───────────── 3–4. Almashtirish va qayta ishga tushirish ─────────────
step "current → releases/${SHA:0:7}"
switch_to "$REL"
ok "symlink almashtirildi (oldingi: ${PREV:+$(basename "$PREV")})"
unit_check

if [ "${SKIP_RESTART:-0}" = "1" ]; then
  warn "SKIP_RESTART=1 — xizmatlar qayta ishga tushirilmadi"
else
  step "Xizmatlarni bittadan qayta ishga tushirish (/api/health)"
  [ "${#UNITS[@]}" -gt 0 ] || warn "Yoqilgan insof-erp@* / insof-control xizmati topilmadi"
  if [ "${#UNITS[@]}" -gt 0 ] && ! restart_all "${UNITS[@]}"; then
    failed="$FAILED_UNIT"
    printf '  \033[1;31m✗\033[0m %s /api/health javob bermadi — journalctl -u %s -n 80\n' "$failed" "$failed" >&2
    if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$REL" ]; then
      step "AVTOMATIK QAYTARISH → $(basename "$PREV")"
      switch_to "$PREV"
      # Qayta ishga tushirilgan (va yiqilgan) xizmatlarni eski relizga qaytaramiz
      for u in "${UNITS[@]}"; do
        sudo systemctl restart "${u%%|*}"
        if [ "${u%%|*}" = "$failed" ]; then break; fi
      done
      for u in "${UNITS[@]}"; do health "${u#*|}" && ok "${u%%|*} (eski reliz)" || warn "${u%%|*} eski relizda ham javob bermayapti"; done
    fi
    die "Deploy bekor qilindi: ${SHA:0:7} ishga tushmadi"
  fi
fi

# ───────────── 5. Eski relizlarni tozalash ─────────────
step "Eski relizlar (saqlanadi: $KEEP_RELEASES)"
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '*.tmp' -mmin +120 -exec rm -rf {} +
keep=0
while read -r dir; do
  [ -n "$dir" ] || continue
  if [ "$dir" = "$REL" ] || [ "$dir" = "$PREV" ]; then keep=$((keep + 1)); continue; fi
  if [ "$keep" -lt "$KEEP_RELEASES" ]; then keep=$((keep + 1)); continue; fi
  rm -rf "$dir" && ok "o'chirildi: $(basename "$dir")"
done < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d ! -name '*.tmp' -printf '%T@ %p\n' | sort -rn | awk '{print $2}')

# Vaqt zonasi: ilova o'zi Asia/Tashkent o'rnatadi (src/instrumentation.ts), lekin server soati ham shunday bo'lsin
if [ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "Asia/Tashkent" ]; then
  warn "Server vaqt zonasi: $(timedatectl show -p Timezone --value 2>/dev/null || echo aniqlanmadi). Tavsiya: sudo timedatectl set-timezone Asia/Tashkent"
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
  sleep 5
  curl -fsS -o /dev/null http://127.0.0.1:3010/v1/health && ok "ECO 3010 ishlayapti" || die "ECO 3010 javob bermadi: journalctl -u insof-eco -n 50"
fi

# ───────────── Yakuniy tekshiruv ─────────────
step "Tekshiruv"
if [ "$HAS_CONTROL" = 1 ]; then
  (cd "$CURRENT" && CONTROL_ENV_FILE="$APP_DIR/control.env" npm run -s tenant -- stats) || warn "tenant stats xato"
fi
APK="$(env_get "$APP_DIR/tenants/insof.env" APK_PATH 2>/dev/null || true)"; APK="${APK:-$APP_DIR/uploads/app/insof-eco.apk}"
if [ -f "$APK" ]; then echo "Android APK: $(du -h "$APK" | cut -f1), $(date -r "$APK" '+%d.%m.%Y %H:%M')"; else echo "Android APK yo'q: $APK"; fi
printf '\n\033[1;32m✓ Deploy tugadi: %s\033[0m\n' "${SHA:0:7}"
