#!/usr/bin/env bash
# Zaxira nusxa haqiqatan tiklanishini sinash (oyda kamida bir marta, yoki cron bilan haftada).
# Tiklanmagan nusxa — nusxa emas.
#
#   bash scripts/restore-test.sh                 # eng oxirgi nusxadagi BARCHA .dump fayllar
#   bash scripts/restore-test.sh insof           # faqat insof.dump
#   DUMP=/yo'l/fayl.dump bash scripts/restore-test.sh
#
# Har dump uchun: vaqtinchalik baza `insof_restore_<nom>_<tasodif>` → pg_restore → jadval va qator sonlari
# tekshiriladi (dumpdagi TABLE DATA soni = tiklangan jadvallar; User va _prisma_migrations bo'sh emas) →
# baza o'chiriladi (xato bo'lsa ham). Xato bo'lsa Telegram ogohlantirish (backup.env) va exit 1.
#
# Ulanish: control.env dagi TENANT_DATABASE_URL shabloni ({db}) — foydalanuvchida CREATEDB bor.
# Yoki aniq: RESTORE_DB_URL_TEMPLATE="postgresql://insof:PAROL@127.0.0.1:5432/{db}"
set -Eeuo pipefail
umask 077

BACKUP_ENV="${BACKUP_ENV:-/etc/insof/backup.env}"

env_get() { # env_get <fayl> <KALIT> — `source` siz o'qish
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

APP_DIR="${APP_DIR:-$(env_get "$BACKUP_ENV" APP_DIR)}"; APP_DIR="${APP_DIR:-/var/www/insof-erp}"
OUT_DIR="${OUT_DIR:-$(env_get "$BACKUP_ENV" OUT_DIR)}"; OUT_DIR="${OUT_DIR:-/var/backups/insof}"
ALERT_TG_BOT_TOKEN="${ALERT_TG_BOT_TOKEN:-$(env_get "$BACKUP_ENV" ALERT_TG_BOT_TOKEN)}"
ALERT_TG_CHAT_ID="${ALERT_TG_CHAT_ID:-$(env_get "$BACKUP_ENV" ALERT_TG_CHAT_ID)}"
TPL="${RESTORE_DB_URL_TEMPLATE:-$(env_get "$APP_DIR/control.env" TENANT_DATABASE_URL)}"
HOST="$(hostname -s 2>/dev/null || hostname)"
# Vaqtinchalik baza nomi prefiksi (lokal sinovda: RESTORE_DB_PREFIX=insof_test_restore — test himoyasi qabul qiladi)
RESTORE_DB_PREFIX="${RESTORE_DB_PREFIX:-insof_restore}"
[[ "$RESTORE_DB_PREFIX" =~ ^[a-z][a-z0-9_]{2,30}$ ]] || { echo "RESTORE_DB_PREFIX noto'g'ri: $RESTORE_DB_PREFIX" >&2; exit 1; }

log() { printf '[%s] %s\n' "$(date +'%F %T')" "$*"; }
tg_alert() {
  if [ -z "${ALERT_TG_BOT_TOKEN:-}" ] || [ -z "${ALERT_TG_CHAT_ID:-}" ]; then
    log "(ALERT) Telegram sozlanmagan — xabar faqat logda: $1"; return 0
  fi
  curl -fsS -m 15 -o /dev/null "https://api.telegram.org/bot${ALERT_TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_TG_CHAT_ID}" --data-urlencode "text=$1" || log "⚠ Telegram ogohlantirishi yuborilmadi"
}

case "$TPL" in
  *"{db}"*) ;;
  *) echo "TENANT_DATABASE_URL ({db} shabloni) topilmadi — RESTORE_DB_URL_TEMPLATE bering" >&2; exit 1 ;;
esac
TPL="${TPL%%\?*}"
url_for() { printf '%s' "${TPL/\{db\}/$1}"; }

CREATED=()
cleanup() {
  local code=$? db
  for db in ${CREATED[@]+"${CREATED[@]}"}; do
    psql "$(url_for postgres)" -qAtX -c "DROP DATABASE IF EXISTS \"$db\"" >/dev/null 2>&1 || log "⚠ $db o'chirilmadi — qo'lda: DROP DATABASE \"$db\""
  done
  if [ "$code" -ne 0 ]; then
    log "✗ Tiklash sinovi XATO"
    tg_alert "[XATO] Insof: zaxira nusxadan tiklash sinovi muvaffaqiyatsiz ($HOST). Log: /var/log/insof-restore-test.log"
  fi
}
trap cleanup EXIT

# ── Qaysi dump'lar ──
DUMPS=()
if [ -n "${DUMP:-}" ]; then
  DUMPS=("$DUMP")
else
  LATEST="$(find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????*' ! -name '*.partial' | sort | tail -n1)"
  [ -n "$LATEST" ] || { log "$OUT_DIR da nusxa yo'q"; exit 1; }
  log "Oxirgi nusxa: $LATEST"
  if [ -f "$LATEST/SHA256SUMS" ]; then
    if command -v sha256sum >/dev/null; then SHA256=(sha256sum); else SHA256=(shasum -a 256); fi
    sums="$(cd "$LATEST" && "${SHA256[@]}" -c SHA256SUMS 2>&1)" \
      || { printf '%s\n' "$sums" | grep -v ': OK$' >&2; log "SHA256SUMS mos emas — nusxa buzilgan"; exit 1; }
  fi
  if [ -n "${1:-}" ]; then
    DUMPS=("$LATEST/$1.dump")
  else
    shopt -s nullglob; DUMPS=("$LATEST"/*.dump); shopt -u nullglob
  fi
fi
[ "${#DUMPS[@]}" -gt 0 ] || { log "Dump topilmadi"; exit 1; }

bad=0
for dump in "${DUMPS[@]}"; do
  [ -f "$dump" ] || { log "✗ $dump yo'q"; bad=1; continue; }
  name="$(basename "$dump" .dump | tr -c 'a-z0-9\n' '_')"
  db="${RESTORE_DB_PREFIX}_${name}_$(date +%s)_$RANDOM"
  db="${db:0:63}"
  log "→ $(basename "$dump") → $db"
  psql "$(url_for postgres)" -qAtX -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$db\"" >/dev/null
  CREATED+=("$db")
  if ! pg_restore --no-owner --no-acl --exit-on-error -d "$(url_for "$db")" "$dump"; then
    log "  ✗ pg_restore xato"; bad=1; continue
  fi

  expected="$(pg_restore -l "$dump" | grep -c ' TABLE DATA ' || true)"
  sql="SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"
  restored="$(psql "$(url_for "$db")" -qAtX -c "$sql")"
  log "  jadvallar: dumpda $expected, tiklangan $restored"
  if [ "$restored" -lt 1 ] || [ "$restored" -lt "$expected" ]; then log "  ✗ jadvallar soni mos emas"; bad=1; fi

  # Asosiy jadvallardagi qatorlar (qaysi sxemada bo'lmasin). Control bazada — Tenant/SuperAdmin.
  for tbl in _prisma_migrations User Customer Order Trip Payment Tenant SuperAdmin; do
    schema="$(psql "$(url_for "$db")" -qAtX -c "SELECT schemaname FROM pg_tables WHERE tablename = '$tbl' AND schemaname NOT IN ('pg_catalog','information_schema') LIMIT 1")"
    [ -n "$schema" ] || continue
    n="$(psql "$(url_for "$db")" -qAtX -c "SELECT count(*) FROM \"$schema\".\"$tbl\"")"
    log "  $tbl: $n"
    case "$tbl" in
      _prisma_migrations|User|SuperAdmin) [ "$n" -gt 0 ] || { log "  ✗ $tbl bo'sh — nusxa yaroqsiz"; bad=1; } ;;
    esac
  done
done

[ "$bad" -eq 0 ] || exit 1
log "✓ Barcha dump'lar tiklandi va tekshirildi (vaqtinchalik bazalar o'chiriladi)"
