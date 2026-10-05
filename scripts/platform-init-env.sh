#!/usr/bin/env bash
# Birinchi o'rnatish, 3-qadam (docs/deploy/PLATFORMA.md): mavjud ildizdagi .env dan platforma sozlama fayllarini
# avtomatik yaratadi — qo'lda nano bilan ko'chirishdagi xatolarsiz:
#   control.env        — IT panel (yangi AUTH_SECRET va CONTROL_SECRET yaratiladi, baza paroli .env dan)
#   build.env          — build vaqtidagi kalitlar (NEXT_PUBLIC_*, DATABASE_URL, APP_URL)
#   tenants/insof.env  — .env ning NUSXASI (ko'chirma emas) + PORT, TENANT_SLUG, UPLOADS_DIR, APK_PATH;
#                        CONTROL_SECRET, NEXT_PUBLIC_* va eski SMS kalitlari olib tashlanadi
#
#   cd /var/www/insof-erp && bash scripts/platform-init-env.sh
#
# Mavjud faylni HECH QACHON ustidan yozmaydi (qayta ishga tushirsa — borlarini o'tkazib yuboradi).
# Ildizdagi .env ga tegmaydi: eski xizmat 7-qadamgacha undan ishlaydi. Sir qiymatlarini ekranga chiqarmaydi.
set -Eeuo pipefail

APP_DIR=${APP_DIR:-/var/www/insof-erp}
SLUG=${SLUG:-insof}
cd "$APP_DIR"

die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
skip() { printf '  \033[1;33m•\033[0m %s\n' "$*"; }

[ -f .env ] || die ".env topilmadi ($APP_DIR/.env) — bu skript faqat birinchi o'rnatishda, eski .env joyida turganda ishlaydi"
command -v openssl >/dev/null || die "openssl yo'q"
umask 077

# .env dan qiymat o'qish — source siz (fayldagi kod bajarilmaydi), qo'shtirnoqlarni olib tashlaydi
env_get() {
  local line val
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" .env 2>/dev/null | tail -n1 || true)"
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

DB_URL="$(env_get DATABASE_URL)"
[ -n "$DB_URL" ] || die ".env da DATABASE_URL yo'q"
# postgresql://user:parol@host:port/baza?params → baza nomisiz asos va parametrlar
DB_BASE="${DB_URL%%\?*}"          # ?schema=public siz
DB_NAME="${DB_BASE##*/}"
DB_ROOT="${DB_BASE%/*}"           # postgresql://user:parol@host:port
[ -n "$DB_NAME" ] && [ "$DB_ROOT" != "$DB_BASE" ] || die "DATABASE_URL ni tahlil qilib bo'lmadi"
secret() { openssl rand -base64 48 | tr -d '\n'; }

# ── control.env ──
if [ -e control.env ]; then skip "control.env bor — o'tkazib yuborildi"
else
  cat > control.env <<EOF
# IT panel jarayoni — scripts/platform-init-env.sh yaratdi ($(date +%F)). Izohlar: docs/deploy/control.env.example
NODE_ENV=production
TZ=Asia/Tashkent
INSOF_MODE=control
AUTH_SECRET="$(secret)"
CONTROL_SECRET="$(secret)"
CONTROL_DATABASE_URL="$DB_ROOT/insof_control"
TENANT_DATABASE_URL="$DB_ROOT/{db}?connection_limit=5"
DATABASE_URL="$DB_ROOT/insof_control"
TENANTS_DIR=$APP_DIR/tenants
TENANT_DATA_ROOT=/var/lib/insof
TENANT_BASE_DOMAIN=insof-erp.uz
EOF
  chmod 600 control.env; ok "control.env yaratildi (yangi AUTH_SECRET va CONTROL_SECRET)"
fi

# ── build.env ──
if [ -e build.env ]; then skip "build.env bor — o'tkazib yuborildi"
else
  APP_URL="$(env_get APP_URL)"; APP_URL="${APP_URL:-https://insof-erp.uz}"
  {
    echo "# Build vaqtidagi kalitlar — scripts/platform-init-env.sh yaratdi ($(date +%F)). Izohlar: build.env.example"
    # .env dagi barcha NEXT_PUBLIC_* qatorlari aynan ko'chiriladi
    grep -E '^[[:space:]]*NEXT_PUBLIC_[A-Za-z0-9_]*[[:space:]]*=' .env || true
    echo "DATABASE_URL=\"$DB_BASE\""
    echo "APP_URL=\"$APP_URL\""
    echo "NEXT_TELEMETRY_DISABLED=1"
  } > build.env
  chmod 600 build.env; ok "build.env yaratildi ($(grep -c '^NEXT_PUBLIC_' build.env || true) ta NEXT_PUBLIC_* kalit)"
fi

# ── tenants/<slug>.env ──
mkdir -p -m 700 tenants
T="tenants/$SLUG.env"
if [ -e "$T" ]; then skip "$T bor — o'tkazib yuborildi"
else
  PORT_V="$(env_get PORT)"; PORT_V="${PORT_V:-3000}"
  UPLOADS_V="$(env_get UPLOADS_DIR)"; UPLOADS_V="${UPLOADS_V:-$APP_DIR/uploads}"
  APK_V="$(env_get APK_PATH)"; APK_V="${APK_V:-$UPLOADS_V/app/insof-eco.apk}"
  {
    # Ildizdagi .env nusxasi — korxonaga tegishli bo'lmagan va eskirgan qatorlarsiz
    grep -vE '^[[:space:]]*(export[[:space:]]+)?(CONTROL_SECRET|NEXT_PUBLIC_[A-Za-z0-9_]*|SMS_PROVIDER|ESKIZ_[A-Za-z0-9_]*|RESET_SMS_FALLBACK|PORT|TENANT_SLUG|UPLOADS_DIR|APK_PATH|INSOF_MODE)[[:space:]]*=' .env
    echo
    echo "# ── Platforma (scripts/platform-init-env.sh, $(date +%F)) ──"
    grep -qE '^[[:space:]]*NODE_ENV[[:space:]]*=' .env || echo "NODE_ENV=production"
    echo "PORT=$PORT_V"
    echo "TENANT_SLUG=$SLUG"
    echo "UPLOADS_DIR=$UPLOADS_V"
    echo "APK_PATH=$APK_V"
    echo "# CONTROL_SSO_KEY — 5-qadamda qo'shiladi (npm run -s tenant -- sso-key $SLUG)"
  } > "$T"
  chmod 600 "$T"; ok "$T yaratildi (PORT=$PORT_V, UPLOADS_DIR=$UPLOADS_V)"
fi

# ── Tekshiruv (qiymatlarsiz) ──
echo
printf '  Fayllar: '; ls -l control.env build.env "$T" | awk '{printf "%s %s  ", $1, $NF}'; echo
for k in AUTH_SECRET CONTROL_SECRET CONTROL_DATABASE_URL TENANT_DATABASE_URL; do
  grep -qE "^$k=\".+\"" control.env && ok "control.env: $k" || die "control.env: $k bo'sh"
done
grep -qE '^CONTROL_SECRET=' "$T" && die "$T da CONTROL_SECRET qolgan" || ok "$T: CONTROL_SECRET yo'q"
for k in PORT TENANT_SLUG UPLOADS_DIR DATABASE_URL AUTH_SECRET; do
  grep -qE "^[[:space:]]*$k[[:space:]]*=" "$T" && ok "$T: $k" || die "$T: $k yo'q"
done
grep -qE '^TELEGRAM_GATEWAY_TOKEN=..' "$T" && ok "$T: TELEGRAM_GATEWAY_TOKEN bor" \
  || printf '  \033[1;33m⚠\033[0m %s\n' "$T: TELEGRAM_GATEWAY_TOKEN bo'sh (Gateway'siz ishlaydi; keyin qo'shish mumkin)"
echo; ok "3-qadam tayyor. Ildizdagi .env o'zgarmadi."
