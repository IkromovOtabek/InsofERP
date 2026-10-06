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
#   SKIP_AGENT_RESTART=1  insof-agent ni qayta ishga tushirmaslik (agent deploy'ni o'zi ishga tushirgan va o'zi qayta
#                   ishga tushadi — scripts/agent/devops.ts, «detached» rejim)
#   DEPLOY_LOCK     bir vaqtda bitta deploy: flock qulf fayli (standart $APP_DIR/.deploy.lock)
#   DEPLOY_REF=<tag|sha>  HEAD o'rniga aniq commit/teg build qilish (standart HEAD); faqat origin/main tarixidagi commit
#                   (`git merge-base --is-ancestor`), aks holda to'xtaydi. ROLLBACK=1 ga taalluqli emas.
#   APP_DIR, REPO_DIR (git manbasi, standart APP_DIR), RELEASES_DIR, CONTROL_PORT (3100), HEALTH_TIMEOUT (60 s)
#
# Lokal sinov rejimi — DRY_RUN=1 (faqat sinov APP_DIR bilan; /var/www/insof-erp da rad etiladi):
#   systemd, sudo, git pull, ECO va timedatectl'ga TEGMAYDI. Build, migratsiya (control + har korxona),
#   symlink almashtirish, /api/health tekshiruvi va avtomatik qaytarish esa HAQIQATAN bajariladi.
#   Xizmatlar: barcha tenants/*.env (+ control.env bo'lsa panel); qayta ishga tushirish — RESTART_CMD <unit>
#   (berilmasa faqat yoziladi). NODE_MODULES_FROM=<papka> — npm ci o'rniga node_modules symlink (tezkor sinov).
#   Namuna: scripts/qa/d-deploy-test.sh
set -Eeuo pipefail

DEFAULT_APP_DIR=/var/www/insof-erp
APP_DIR=${APP_DIR:-$DEFAULT_APP_DIR}
REPO_DIR=${REPO_DIR:-$APP_DIR}
ECO_DIR=${ECO_DIR:-/var/www/insof-eco}
RELEASES=${RELEASES_DIR:-$APP_DIR/releases}
CURRENT=${CURRENT_LINK:-$APP_DIR/current}
KEEP_RELEASES=${KEEP_RELEASES:-3}
CONTROL_PORT=${CONTROL_PORT:-3100}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-60}
DRY_RUN=${DRY_RUN:-0}

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

if [ "$DRY_RUN" = "1" ]; then
  [ "$APP_DIR" != "$DEFAULT_APP_DIR" ] || die "DRY_RUN=1 faqat sinov APP_DIR bilan (prod papkasida emas): APP_DIR=/tmp/... DRY_RUN=1 bash scripts/deploy.sh"
  SKIP_PULL=1; SKIP_ECO=1
  printf '\033[1;36m[DRY_RUN] systemd/sudo/git pull/ECO ishlatilmaydi. APP_DIR=%s\033[0m\n' "$APP_DIR"
elif [ -n "${NODE_MODULES_FROM:-}" ]; then
  die "NODE_MODULES_FROM faqat DRY_RUN=1 bilan (prodda har reliz o'z npm ci si bilan)"
fi
if [ "$(id -u)" = "0" ]; then
  die "root bilan ishga tushirmang — node_modules egaligi buziladi. Avval: su - deploy"
fi
cd "$APP_DIR"

# ── Bir vaqtda faqat bitta deploy/rollback (qo'lda ham, IT paneldan ham) — flock, jarayon tugashi bilan qulf bo'shaydi ──
if command -v flock >/dev/null 2>&1; then
  exec 9>"${DEPLOY_LOCK:-$APP_DIR/.deploy.lock}"
  flock -n 9 || die "Boshqa deploy/rollback hozir ishlayapti (${DEPLOY_LOCK:-$APP_DIR/.deploy.lock}) — tugashini kuting"
fi

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

# Xizmat yoqilganmi (DRY_RUN da — hammasi «yoqilgan» deb olinadi)
unit_enabled() {
  if [ "$DRY_RUN" = "1" ]; then return 0; fi
  systemctl is-enabled --quiet "$1" 2>/dev/null
}
# Prodda xizmatni qayta ishga tushirish — root egaligidagi o'ram /usr/local/sbin/insof-restart orqali (sudoers'da faqat shu;
# eski `systemctl restart insof-erp@*` wildcard'i olib tashlangan — PLATFORMA.md → «Root o'ramlari»).
# O'ram hali o'rnatilmagan serverda vaqtincha eski buyruq ishlatiladi (ogohlantirish bilan) — deploy to'xtab qolmasin.
RESTART_WRAPPER=/usr/local/sbin/insof-restart
RESTART_WARNED=0
sys_restart() {
  if [ -x "$RESTART_WRAPPER" ]; then
    sudo "$RESTART_WRAPPER" "$1"
  else
    if [ "$RESTART_WARNED" = 0 ]; then
      warn "$RESTART_WRAPPER o'rnatilmagan — vaqtincha 'sudo systemctl restart'. O'rnating: sudo install -o root -g root -m 755 scripts/insof-restart.sh $RESTART_WRAPPER (va sudoers: docs/deploy/sudoers-insof-agent)"
      RESTART_WARNED=1
    fi
    sudo systemctl restart "$1"
  fi
}
# Xizmatni qayta ishga tushirish: prodda sys_restart, DRY_RUN da RESTART_CMD (yoki faqat yozuv)
restart_unit() {
  if [ "$DRY_RUN" = "1" ]; then
    if [ -n "${RESTART_CMD:-}" ]; then
      # RESTART_CMD bir nechta so'zdan iborat bo'lishi mumkin ("bash scripts/qa/d-svc.sh restart")
      # shellcheck disable=SC2086
      $RESTART_CMD "$1"
    else
      echo "  [DRY_RUN] restart $1 (RESTART_CMD berilmagan)"
    fi
  else
    sys_restart "$1"
  fi
}

# Faqat yoqilgan xizmatlar qayta ishga tushiriladi
UNITS=()      # "unit|port"
for s in ${TENANTS[@]+"${TENANTS[@]}"}; do
  if unit_enabled "insof-erp@$s"; then
    port="$(env_get "$APP_DIR/tenants/$s.env" PORT)"
    [ -n "$port" ] || die "tenants/$s.env da PORT yo'q"
    UNITS+=("insof-erp@$s|$port")
  fi
done
if [ "$HAS_CONTROL" = 1 ] && unit_enabled insof-control; then
  UNITS+=("insof-control|$CONTROL_PORT")
fi

health() { # health <port> — /api/health 200 bo'lguncha kutadi
  local port="$1" i
  for ((i = 0; i < HEALTH_TIMEOUT; i++)); do
    if curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

switch_to() { # atomar: current.new → current (rename(2) — GNU mv -T; BSD/macOS da perl rename)
  ln -sfn "$1" "$CURRENT.new"
  if mv -Tf "$CURRENT.new" "$CURRENT" 2>/dev/null; then return 0; fi
  perl -e 'rename($ARGV[0], $ARGV[1]) or die "rename: $!\n"' "$CURRENT.new" "$CURRENT"
}

# Relizlar — eng yangisi birinchi (mtime). Nomi sha (bo'sh joysiz), *.tmp lar kirmaydi.
list_releases() {
  local d
  # shellcheck disable=SC2012
  ls -1dt "$RELEASES"/*/ 2>/dev/null | while IFS= read -r d; do
    d="${d%/}"
    case "$d" in *.tmp) continue ;; esac
    printf '%s\n' "$d"
  done
}

FAILED_UNIT=""
restart_all() { # restart_all <unit|port>... — bittadan, har biri health bilan; yiqilgani FAILED_UNIT da
  local u
  FAILED_UNIT=""
  for u in "$@"; do
    if ! restart_unit "${u%%|*}"; then FAILED_UNIT="${u%%|*}"; return 1; fi
    if health "${u#*|}"; then ok "${u%%|*}"; else FAILED_UNIT="${u%%|*}"; return 1; fi
  done
}

unit_check() { # repodagi unit fayllar o'rnatilganidan farq qilsa — ogohlantirish
  local name
  [ "$DRY_RUN" = "1" ] && return 0
  for name in "insof-erp@.service" "insof-control.service" "insof-agent.service"; do
    [ -f "/etc/systemd/system/$name" ] || continue
    cmp -s "$APP_DIR/docs/deploy/$name" "/etc/systemd/system/$name" \
      || warn "/etc/systemd/system/$name repodagidan farq qiladi: sudo install -m 644 docs/deploy/$name /etc/systemd/system/ && sudo systemctl daemon-reload"
  done
  # Root o'ramlari (PLATFORMA.md → «Root o'ramlari») — repodagidan farq qilsa yoki o'rnatilmagan bo'lsa ogohlantirish
  for name in insof-restart insof-ufw; do
    if [ -f "/usr/local/sbin/$name" ]; then
      cmp -s "$APP_DIR/scripts/$name.sh" "/usr/local/sbin/$name" \
        || warn "/usr/local/sbin/$name repodagidan farq qiladi: sudo install -o root -g root -m 755 scripts/$name.sh /usr/local/sbin/$name"
    else
      warn "/usr/local/sbin/$name o'rnatilmagan: sudo install -o root -g root -m 755 scripts/$name.sh /usr/local/sbin/$name (PLATFORMA.md → «Root o'ramlari»)"
    fi
  done
  # Root egaligidagi insof-tenant-up va uning shablonlari (PLATFORMA.md → «Infratuzilma») — faqat ogohlantirish, root talab qilinmaydi
  if [ -f /usr/local/sbin/insof-tenant-up ]; then
    cmp -s "$APP_DIR/scripts/tenant-up.sh" /usr/local/sbin/insof-tenant-up \
      || warn "/usr/local/sbin/insof-tenant-up repodagidan farq qiladi: sudo install -o root -g root -m 755 scripts/tenant-up.sh /usr/local/sbin/insof-tenant-up"
    for name in "insof-erp@.service" "nginx-tenant.conf" "nginx-limits.conf"; do
      cmp -s "$APP_DIR/docs/deploy/$name" "/usr/local/share/insof/$name" \
        || warn "/usr/local/share/insof/$name repodagidan farq qiladi: sudo install -o root -g root -m 644 docs/deploy/$name /usr/local/share/insof/"
    done
  fi
  return 0
}

PREV="$(readlink -f "$CURRENT" 2>/dev/null || true)"
[ -n "$PREV" ] && [ -d "$PREV" ] || PREV=""

# ───────────── Qo'lda qaytarish ─────────────
if [ "${ROLLBACK:-0}" = "1" ]; then
  step "Oldingi relizga qaytarish"
  [ -n "$PREV" ] || die "current yo'q"
  TARGET="$(list_releases | grep -vxF "$PREV" | head -n1 || true)"
  [ -n "$TARGET" ] || die "Qaytish uchun boshqa reliz yo'q"
  switch_to "$TARGET"
  restart_all ${UNITS[@]+"${UNITS[@]}"} || die "Qaytarilgan reliz ham ishga tushmadi ($FAILED_UNIT) — journalctl -u $FAILED_UNIT -n 80"
  touch "$TARGET"   # keyingi ROLLBACK/tozalash tartibi uchun — endi eng yangisi shu
  ok "current → $(basename "$TARGET")"
  exit 0
fi

# ───────────── 1. Build (alohida papkada) ─────────────
if [ "${SKIP_PULL:-0}" != "1" ]; then
  step "ERP: git pull"
  git -C "$REPO_DIR" pull --ff-only
fi
SHA="$(git -C "$REPO_DIR" rev-parse --verify "${DEPLOY_REF:-HEAD}^{commit}")" || die "DEPLOY_REF topilmadi: ${DEPLOY_REF:-HEAD}"
# Aniq ref (IT panel → Relizlar yoki qo'lda) faqat origin/main tarixidagi commit bo'lishi mumkin: ko'rib chiqilmagan
# shoxcha yoki fork'dan olingan commit prodga chiqmasin. DEPLOY_REF_BASE — faqat DRY_RUN sinovlari uchun (prodda rad).
if [ -n "${DEPLOY_REF:-}" ]; then
  REF_BASE=origin/main
  if [ -n "${DEPLOY_REF_BASE:-}" ]; then
    [ "$DRY_RUN" = "1" ] || die "DEPLOY_REF_BASE faqat DRY_RUN=1 bilan (prodda tekshiruv har doim origin/main bo'yicha)"
    REF_BASE="$DEPLOY_REF_BASE"
  fi
  git -C "$REPO_DIR" rev-parse --verify -q "$REF_BASE^{commit}" >/dev/null || die "$REF_BASE topilmadi — avval: git -C $REPO_DIR fetch origin main"
  git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" "$REF_BASE" \
    || die "DEPLOY_REF=$DEPLOY_REF (${SHA:0:12}) $REF_BASE tarixida yo'q — faqat main'ga qo'shilgan commitni deploy qilish mumkin (avval main'ga merge qiling va git fetch)"
fi
REL="$RELEASES/$SHA"
mkdir -p "$RELEASES"

if [ -f "$REL/RELEASE" ] && [ -f "$REL/.next/BUILD_ID" ]; then
  step "Reliz ${SHA:0:7} allaqachon build qilingan — qayta ishlatiladi"
  touch "$REL"   # tozalash tartibi (mtime) uchun — eng yangisi bo'lsin
else
  step "ERP: build → releases/${SHA:0:7}"
  rm -rf "$REL.tmp"
  mkdir -p "$REL.tmp"
  git -C "$REPO_DIR" archive --format=tar "$SHA" | tar -x -C "$REL.tmp"
  (
    cd "$REL.tmp"
    # Build vaqtidagi kalitlar (NEXT_PUBLIC_* — brauzer kodiga yoziladi) faqat build.env dan.
    # Korxona sirlari (tenants/*.env) build'ga KIRMAYDI.
    if [ -f "$APP_DIR/build.env" ]; then export_env_file "$APP_DIR/build.env"; else warn "build.env yo'q — NEXT_PUBLIC_YANDEX_MAPS_KEY bo'sh bo'ladi (build.env.example)"; fi
    export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
    if [ -n "${NODE_MODULES_FROM:-}" ]; then
      [ -d "$NODE_MODULES_FROM" ] || { echo "NODE_MODULES_FROM yo'q: $NODE_MODULES_FROM" >&2; exit 1; }
      ln -s "$NODE_MODULES_FROM" node_modules   # faqat DRY_RUN (yuqorida tekshirilgan)
    else
      # npm 10: lock fayl bilan aniq o'rnatish (dev paketlar ham kerak: prisma CLI, build)
      NODE_ENV=development npm ci --no-audit --no-fund
    fi
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
# `prisma migrate deploy` bazasi yo'q bo'lsa uni O'ZI YARATADI — .env dagi xato nom (yoki o'chirilgan baza)
# jim bo'sh baza bo'lib qolardi va korxona bo'sh tizim bilan ochilardi. Shuning uchun avval baza borligini tekshiramiz.
db_reachable() { # db_reachable <url> — psql bilan ulanish (Prisma ?schema=/connection_limit= parametrlarisiz)
  command -v psql >/dev/null || { warn "psql yo'q — baza borligi tekshirilmadi"; return 0; }
  psql "${1%%\?*}" -qAtX -c 'SELECT 1' >/dev/null 2>&1
}
if [ "$HAS_CONTROL" = 1 ]; then
  CTRL_URL="$(env_get "$APP_DIR/control.env" CONTROL_DATABASE_URL)"
  [ -n "$CTRL_URL" ] || die "control.env da CONTROL_DATABASE_URL yo'q"
  db_reachable "$CTRL_URL" || die "control bazasiga ulanib bo'lmadi yoki u yo'q (control.env → CONTROL_DATABASE_URL) — xizmatlar eski relizda qoldi"
  ( cd "$REL" && env CONTROL_DATABASE_URL="$CTRL_URL" "$PRISMA" migrate deploy --schema prisma/control/schema.prisma >/dev/null ) \
    || die "control baza migratsiyasi xato — xizmatlar eski relizda qoldi"
  ok "control"
fi
MIGRATED=" "   # bir bazani ikki marta migratsiya qilmaslik (bash 3 ham: assotsiativ massivsiz)
for s in ${TENANTS[@]+"${TENANTS[@]}"}; do
  url="$(env_get "$APP_DIR/tenants/$s.env" DATABASE_URL)"
  [ -n "$url" ] || die "tenants/$s.env da DATABASE_URL yo'q"
  case "$MIGRATED" in *" $url "*) ok "$s (baza allaqachon yangilandi)"; continue ;; esac
  db_reachable "$url" || die "$s bazasi migratsiyasi xato: bazaga ulanib bo'lmadi yoki u yo'q (tenants/$s.env → DATABASE_URL) — xizmatlar eski relizda qoldi"
  ( cd "$REL" && env DATABASE_URL="$url" "$PRISMA" migrate deploy >/dev/null ) \
    || die "$s bazasi migratsiyasi xato — xizmatlar eski relizda qoldi (oldingi korxonalar bazasi allaqachon yangilangan)"
  MIGRATED="$MIGRATED$url "
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
    if [ -n "$PREV" ] && [ "$PREV" != "$REL" ]; then
      step "AVTOMATIK QAYTARISH → $(basename "$PREV")"
      switch_to "$PREV"
      # Qayta ishga tushirilgan (va yiqilgan) xizmatlarni eski relizga qaytaramiz
      for u in "${UNITS[@]}"; do
        restart_unit "${u%%|*}" || warn "${u%%|*} qayta ishga tushmadi"
        if [ "${u%%|*}" = "$failed" ]; then break; fi
      done
      for u in "${UNITS[@]}"; do
        if health "${u#*|}"; then ok "${u%%|*} (eski reliz)"; else warn "${u%%|*} eski relizda ham javob bermayapti"; fi
      done
      ok "current → $(basename "$PREV")"
    else
      warn "Qaytish uchun oldingi reliz yo'q"
    fi
    die "Deploy bekor qilindi: ${SHA:0:7} ishga tushmadi"
  fi
fi

# ───────────── Monitoring agenti (insof-agent) ─────────────
# Control migratsiyasidan (monitoring jadvallari) va symlink almashgandan KEYIN — agent yangi relizdan ishga tushsin.
# Agent yiqilsa deploy qaytarilmaydi (foydalanuvchilarga ta'sir qilmaydi) — faqat ogohlantirish.
# sudoers: /usr/local/sbin/insof-restart insof-agent (docs/deploy/sudoers-insof-agent).
AGENT_STATUS="o'rnatilmagan"
if [ "$HAS_CONTROL" = 1 ]; then
  if [ "$DRY_RUN" = "1" ]; then
    AGENT_STATUS="[DRY_RUN] qayta ishga tushirilmadi"
    echo "  [DRY_RUN] restart insof-agent (o'tkazib yuborildi)"
  elif [ "${SKIP_RESTART:-0}" = "1" ]; then
    AGENT_STATUS="SKIP_RESTART=1"
  elif [ "${SKIP_AGENT_RESTART:-0}" = "1" ]; then
    AGENT_STATUS="deploy'ni agent boshlagan — u natijani yozib, o'zi qayta ishga tushadi"
  elif systemctl is-enabled --quiet insof-agent 2>/dev/null; then
    step "insof-agent qayta ishga tushirish"
    if sys_restart insof-agent; then
      sleep 3
      if systemctl is-active --quiet insof-agent; then AGENT_STATUS="active"; ok "insof-agent"; else AGENT_STATUS="ishlamayapti"; warn "insof-agent ishga tushmadi: journalctl -u insof-agent -n 50"; fi
    else
      AGENT_STATUS="restart xato"; warn "insof-agent qayta ishga tushmadi (sudoers? docs/deploy/sudoers-insof-agent)"
    fi
  fi
fi

# ───────────── 5. Eski relizlarni tozalash ─────────────
step "Eski relizlar (saqlanadi: $KEEP_RELEASES)"
find "$RELEASES" -mindepth 1 -maxdepth 1 -type d -name '*.tmp' -mmin +120 -exec rm -rf {} +
keep=0
while IFS= read -r dir; do
  [ -n "$dir" ] || continue
  if [ "$dir" = "$REL" ] || [ "$dir" = "$PREV" ]; then keep=$((keep + 1)); continue; fi
  if [ "$keep" -lt "$KEEP_RELEASES" ]; then keep=$((keep + 1)); continue; fi
  rm -rf "$dir" && ok "o'chirildi: $(basename "$dir")"
done < <(list_releases)

# Vaqt zonasi: ilova o'zi Asia/Tashkent o'rnatadi (src/instrumentation.ts), lekin server soati ham shunday bo'lsin
if [ "$DRY_RUN" != "1" ] && [ "$(timedatectl show -p Timezone --value 2>/dev/null)" != "Asia/Tashkent" ]; then
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
  sys_restart insof-eco
  sleep 5
  curl -fsS -o /dev/null http://127.0.0.1:3010/v1/health && ok "ECO 3010 ishlayapti" || die "ECO 3010 javob bermadi: journalctl -u insof-eco -n 50"
fi

# ───────────── Yakuniy tekshiruv ─────────────
step "Tekshiruv"
if [ "$HAS_CONTROL" = 1 ]; then
  (cd "$CURRENT" && CONTROL_ENV_FILE="$APP_DIR/control.env" npm run -s tenant -- stats) || warn "tenant stats xato"
  # Agent heartbeat (AgentHeartbeat "main") — necha soniya oldin yozilgan
  HB=""
  if command -v psql >/dev/null && [ -n "${CTRL_URL:-}" ]; then
    HB="$(psql "${CTRL_URL%%\?*}" -qAtX -c "SELECT version || ', ' || EXTRACT(EPOCH FROM now() - \"lastSeenAt\")::int || ' s oldin' FROM \"AgentHeartbeat\" WHERE id = 'main'" 2>/dev/null || true)"
  fi
  echo "insof-agent: $AGENT_STATUS${HB:+ (heartbeat: $HB)}"
fi
APK="$(env_get "$APP_DIR/tenants/insof.env" APK_PATH 2>/dev/null || true)"; APK="${APK:-$APP_DIR/uploads/app/insof-eco.apk}"
if [ -f "$APK" ]; then echo "Android APK: $(du -h "$APK" | cut -f1)"; else echo "Android APK yo'q: $APK"; fi
printf '\n\033[1;32m✓ Deploy tugadi: %s\033[0m\n' "${SHA:0:7}"
