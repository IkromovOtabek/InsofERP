#!/usr/bin/env bash
# Ko'p korxonali platformaning kunlik zaxira nusxasi (prod serverda, `deploy` foydalanuvchisi ostida).
#
# Nima qiladi:
#   1. tenants/*.env (har korxona DATABASE_URL, UPLOADS_DIR) va control.env (CONTROL_DATABASE_URL) ni o'qiydi —
#      fayllar `source` QILINMAYDI, faqat kerakli qatorlar ajratib olinadi (fayl ichidagi kod bajarilmaydi).
#   2. Har bazaga `pg_dump -Fc` → $OUT_DIR/<sana>/<nom>.dump
#   3. Har korxonaning fayllar papkasi → $OUT_DIR/<sana>/<slug>-uploads.tar.gz
#   4. SHA256SUMS, mahalliy saqlash muddati (KEEP_DAYS, standart 14 kun)
#   5. Server TASHQARISIGA: rclone yoki restic (OFFSITE=rclone|restic|local|none); vosita o'rnatilmagan bo'lsa — XATO
#   6. Biror qadam xato bersa — Telegram'ga ogohlantirish va exit 1
#
# Sozlama: /etc/insof/backup.env (namuna: docs/deploy/backup.env.example), chmod 600.
# Cron (deploy ostida, `crontab -e`):
#   30 2 * * * /var/www/insof-erp/scripts/server-backup.sh >> /var/log/insof-backup.log 2>&1
set -Eeuo pipefail
umask 077

BACKUP_ENV="${BACKUP_ENV:-/etc/insof/backup.env}"

# ── .env o'quvchi: `source` siz, faqat KALIT=qiymat (scripts/env.ts bilan bir xil qoidalar) ──
env_get() { # env_get <fayl> <KALIT> → qiymat (oxirgi uchragani)
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
load_env_file() { # faqat ruxsat etilgan kalitlarni muhitga eksport qiladi (muhitda berilgani ustun)
  local file="$1"; shift
  [ -f "$file" ] || return 0
  local k
  for k in "$@"; do
    if [ -z "${!k:-}" ]; then
      local v; v="$(env_get "$file" "$k")"
      [ -n "$v" ] && export "$k=$v"
    fi
  done
  return 0
}

load_env_file "$BACKUP_ENV" APP_DIR OUT_DIR KEEP_DAYS BACKUP_UPLOADS OFFSITE OFFSITE_DIR OFFSITE_KEEP_DAYS \
  RCLONE_REMOTE RCLONE_KEEP_DAYS RCLONE_CONFIG RESTIC_REPOSITORY RESTIC_PASSWORD_FILE RESTIC_KEEP_DAILY RESTIC_KEEP_WEEKLY RESTIC_KEEP_MONTHLY \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY B2_ACCOUNT_ID B2_ACCOUNT_KEY \
  ALERT_TG_BOT_TOKEN ALERT_TG_CHAT_ID

APP_DIR="${APP_DIR:-/var/www/insof-erp}"
OUT_DIR="${OUT_DIR:-/var/backups/insof}"
KEEP_DAYS="${KEEP_DAYS:-14}"
BACKUP_UPLOADS="${BACKUP_UPLOADS:-1}"
OFFSITE="${OFFSITE:-none}"
HOST="$(hostname -s 2>/dev/null || hostname)"

CURRENT_STEP="boshlanish"
FAILURES=()

log() { printf '[%s] %s\n' "$(date +'%F %T')" "$*"; }

tg_alert() { # Telegram'ga xabar (token/chat bo'lmasa — faqat logga, jim EMAS)
  if [ -z "${ALERT_TG_BOT_TOKEN:-}" ] || [ -z "${ALERT_TG_CHAT_ID:-}" ]; then
    log "(ALERT) Telegram sozlanmagan (ALERT_TG_BOT_TOKEN/ALERT_TG_CHAT_ID) — xabar faqat logda: ${1//$'\n'/ | }"
    return 0
  fi
  curl -fsS -m 15 -o /dev/null "https://api.telegram.org/bot${ALERT_TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_TG_CHAT_ID}" \
    --data-urlencode "text=$1" || log "⚠ Telegram ogohlantirishi yuborilmadi"
}

on_exit() {
  local code=$?
  [ -n "${LOCK_DIR:-}" ] && rm -rf "$LOCK_DIR"
  if [ "$code" -ne 0 ]; then
    log "✗ Zaxira nusxa XATO (qadam: $CURRENT_STEP, kod $code)"
    local detail=""
    [ "${#FAILURES[@]}" -gt 0 ] && detail=$'\n'"$(printf -- '- %s\n' "${FAILURES[@]}")"
    tg_alert "[XATO] Insof zaxira nusxa XATO ($HOST)
Qadam: $CURRENT_STEP${detail}
Log: /var/log/insof-backup.log"
  fi
}
trap on_exit EXIT

fail() { FAILURES+=("$1"); log "✗ $1"; }

# Bir vaqtda ikki nusxa ishlamasin (Linux — flock; flock yo'q joyda — mkdir qulfi, jarayon tugasa o'chadi)
mkdir -p "$OUT_DIR"
LOCK_DIR=""
if command -v flock >/dev/null; then
  exec 9>"$OUT_DIR/.lock"
  if ! flock -n 9; then
    CURRENT_STEP="qulf"; log "Boshqa zaxira jarayoni ishlayapti — chiqildi"; exit 1
  fi
else
  if ! mkdir "$OUT_DIR/.lock.d" 2>/dev/null; then
    other="$(cat "$OUT_DIR/.lock.d/pid" 2>/dev/null || true)"
    if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
      CURRENT_STEP="qulf"; log "Boshqa zaxira jarayoni ishlayapti (pid $other) — chiqildi"; exit 1
    fi
    log "⚠ eski qulf (pid ${other:-?} tirik emas) — olib tashlandi"
  fi
  mkdir -p "$OUT_DIR/.lock.d"; echo $$ > "$OUT_DIR/.lock.d/pid"; LOCK_DIR="$OUT_DIR/.lock.d"
fi

for bin in pg_dump tar; do
  command -v "$bin" >/dev/null || { CURRENT_STEP="tekshiruv"; log "$bin topilmadi"; exit 1; }
done
if command -v sha256sum >/dev/null; then SHA256=(sha256sum); else SHA256=(shasum -a 256); fi
sha_check() { # joriy papkadagi SHA256SUMS ni tekshiradi; mos kelmaganlarini chiqaradi (GNU va macOS)
  local out
  out="$("${SHA256[@]}" -c SHA256SUMS 2>&1)" || { printf '%s\n' "$out" | grep -v ': OK$' >&2; return 1; }
}

# Server tashqarisiga nusxa vositasi OLDINDAN tekshiriladi — o'rnatilmagan bo'lsa jim o'tib ketmasin.
# (Mahalliy nusxa baribir olinadi; oxirida exit 1 + ogohlantirish.)
OFFSITE_PROBLEM=""
case "$OFFSITE" in
  rclone) command -v rclone >/dev/null || OFFSITE_PROBLEM="OFFSITE=rclone, lekin rclone o'rnatilmagan (sudo apt install rclone)" ;;
  restic) command -v restic >/dev/null || OFFSITE_PROBLEM="OFFSITE=restic, lekin restic o'rnatilmagan (sudo apt install restic)" ;;
  local)  [ -n "${OFFSITE_DIR:-}" ] || OFFSITE_PROBLEM="OFFSITE=local, lekin OFFSITE_DIR berilmagan" ;;
  none)   ;;
  *)      OFFSITE_PROBLEM="OFFSITE noma'lum: $OFFSITE (rclone|restic|local|none)" ;;
esac
[ -z "$OFFSITE_PROBLEM" ] || log "✗ $OFFSITE_PROBLEM — mahalliy nusxa olinadi, lekin skript XATO bilan tugaydi"

STAMP="$(date +%Y-%m-%d_%H%M)"
# Shu daqiqada nusxa allaqachon bo'lsa (qo'lda + cron, xatodan keyin qayta) — `mv` uni ichiga joylab yubormasin
n=2; base="$STAMP"
while [ -e "$OUT_DIR/$STAMP" ]; do STAMP="$base-$n"; n=$((n + 1)); done
DEST="$OUT_DIR/$STAMP"
rm -rf "$DEST.partial"
mkdir -p "$DEST.partial"

# ── Bazalar ro'yxati: nom|url ──
TARGETS=()      # "nom|DATABASE_URL"
UPLOAD_DIRS=()  # "nom|papka"
SEEN_DB=" "     # bir bazani ikki marta olmaslik (bash 3 ham: assotsiativ massivsiz)

add_db() { # add_db <nom> <url>
  local name="$1" url="$2" key
  [ -n "$url" ] || return 0
  case "$url" in *"{db}"*) return 0 ;; esac  # TENANT_DATABASE_URL shabloni — baza emas
  key="${url%%\?*}"
  case "$SEEN_DB" in *" $key "*) return 0 ;; esac
  SEEN_DB="$SEEN_DB$key "
  TARGETS+=("$name|$url")
}

CURRENT_STEP="sozlamalarni o'qish"
if [ -f "$APP_DIR/control.env" ]; then
  add_db "control" "$(env_get "$APP_DIR/control.env" CONTROL_DATABASE_URL)"
fi
shopt -s nullglob
for f in "$APP_DIR"/tenants/*.env; do
  slug="$(basename "$f" .env)"
  [[ "$slug" =~ ^[a-z][a-z0-9-]{1,29}$ ]] || { log "⚠ $f — nomi slug emas, o'tkazildi"; continue; }
  url="$(env_get "$f" DATABASE_URL)"
  [ -n "$url" ] || { fail "$slug: DATABASE_URL yo'q ($f)"; continue; }
  add_db "$slug" "$url"
  up="$(env_get "$f" UPLOADS_DIR)"
  [ -n "$up" ] || up="$APP_DIR/uploads"   # eski (bitta korxonali) o'rnatish standarti
  UPLOAD_DIRS+=("$slug|$up")
done
shopt -u nullglob
# Platformaga hali ko'chirilmagan eski o'rnatish: ildizdagi .env
if [ "${#TARGETS[@]}" -eq 0 ] && [ -f "$APP_DIR/.env" ]; then
  add_db "insof" "$(env_get "$APP_DIR/.env" DATABASE_URL)"
  up="$(env_get "$APP_DIR/.env" UPLOADS_DIR)"
  UPLOAD_DIRS+=("insof|${up:-$APP_DIR/uploads}")
fi
[ "${#TARGETS[@]}" -gt 0 ] || { log "Hech qanday baza topilmadi ($APP_DIR/control.env, $APP_DIR/tenants/*.env)"; exit 1; }

# ── 1. pg_dump ──
for t in "${TARGETS[@]}"; do
  name="${t%%|*}"; url="${t#*|}"
  CURRENT_STEP="pg_dump $name"
  # Prisma'ning ?schema=/connection_limit= parametrlarini pg_dump tushunmaydi — ajratamiz.
  schema="$(printf '%s' "$url" | sed -n 's/.*[?&]schema=\([^&]*\).*/\1/p')"
  args=()
  if [ -n "$schema" ] && [ "$schema" != "public" ]; then args+=(-n "$schema"); fi
  log "→ $name: pg_dump"
  if pg_dump "${url%%\?*}" ${args[@]+"${args[@]}"} -Fc --no-owner --no-acl -f "$DEST.partial/$name.dump.tmp"; then
    mv "$DEST.partial/$name.dump.tmp" "$DEST.partial/$name.dump"
    log "  ok ($(du -h "$DEST.partial/$name.dump" | cut -f1))"
  else
    rm -f "$DEST.partial/$name.dump.tmp"
    fail "$name: pg_dump xato"
  fi
done

# ── 2. Fayllar (uploads) ──
if [ "$BACKUP_UPLOADS" = "1" ]; then
  for u in ${UPLOAD_DIRS[@]+"${UPLOAD_DIRS[@]}"}; do
    name="${u%%|*}"; dir="${u#*|}"
    CURRENT_STEP="uploads $name"
    if [ ! -d "$dir" ]; then log "  $name: $dir yo'q — o'tkazildi"; continue; fi
    log "→ $name: fayllar ($dir)"
    if tar -czf "$DEST.partial/$name-uploads.tar.gz.tmp" -C "$(dirname "$dir")" "$(basename "$dir")"; then
      mv "$DEST.partial/$name-uploads.tar.gz.tmp" "$DEST.partial/$name-uploads.tar.gz"
      log "  ok ($(du -h "$DEST.partial/$name-uploads.tar.gz" | cut -f1))"
    else
      rm -f "$DEST.partial/$name-uploads.tar.gz.tmp"
      fail "$name: uploads arxivi xato"
    fi
  done
fi

CURRENT_STEP="nazorat yig'indisi"
( cd "$DEST.partial" && "${SHA256[@]}" -- * > SHA256SUMS )
mv "$DEST.partial" "$DEST"
log "[OK] mahalliy nusxa: $DEST ($(du -sh "$DEST" | cut -f1))"

# ── 3. Server tashqarisiga ──
if [ -n "$OFFSITE_PROBLEM" ]; then
  CURRENT_STEP="offsite"; fail "$OFFSITE_PROBLEM"
else
case "$OFFSITE" in
  local)
    # Boshqa disk / mount qilingan papka (masalan /mnt/backup-disk/insof). Bir server ichida — faqat qo'shimcha himoya,
    # server yonsa/o'g'irlansa yordam bermaydi: asosiy masofa sifatida rclone/restic tavsiya etiladi.
    CURRENT_STEP="local nusxa"
    log "→ local: $OFFSITE_DIR/$STAMP"
    if mkdir -p "$OFFSITE_DIR/$STAMP.partial" && cp -R "$DEST/." "$OFFSITE_DIR/$STAMP.partial/" \
      && ( cd "$OFFSITE_DIR/$STAMP.partial" && sha_check ) \
      && mv "$OFFSITE_DIR/$STAMP.partial" "$OFFSITE_DIR/$STAMP"; then
      log "  ok (nazorat yig'indisi mos)"
      find "$OFFSITE_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????*' ! -name '*.partial' -mtime "+${OFFSITE_KEEP_DAYS:-30}" -exec rm -rf {} +
    else
      fail "local: nusxalash yoki tekshiruv xato ($OFFSITE_DIR)"
    fi
    ;;
  rclone)
    CURRENT_STEP="rclone"
    [ -n "${RCLONE_REMOTE:-}" ] || { fail "RCLONE_REMOTE berilmagan"; exit 1; }
    log "→ rclone: $RCLONE_REMOTE/$STAMP"
    if rclone copy "$DEST" "$RCLONE_REMOTE/$STAMP" --transfers 2 --retries 3 \
      && rclone check "$DEST" "$RCLONE_REMOTE/$STAMP" --one-way; then
      log "  ok"
      # Masofadagi eskilar (standart 30 kun) — faqat muvaffaqiyatli yuklashdan keyin
      rclone delete "$RCLONE_REMOTE" --min-age "${RCLONE_KEEP_DAYS:-30}d" && rclone rmdirs "$RCLONE_REMOTE" --leave-root || log "⚠ rclone: eskilarni tozalashda xato"
    else
      fail "rclone: yuklash yoki tekshiruv xato"
    fi
    ;;
  restic)
    CURRENT_STEP="restic"
    [ -n "${RESTIC_REPOSITORY:-}" ] && [ -n "${RESTIC_PASSWORD_FILE:-}" ] || { fail "RESTIC_REPOSITORY / RESTIC_PASSWORD_FILE berilmagan"; exit 1; }
    log "→ restic: $RESTIC_REPOSITORY"
    # Dump'lar + uploads papkalari xom holda (restic o'zi takrorlanmas bo'laklarga ajratadi — tar.gz dan tejamli)
    paths=("$DEST")
    for u in ${UPLOAD_DIRS[@]+"${UPLOAD_DIRS[@]}"}; do [ -d "${u#*|}" ] && paths+=("${u#*|}"); done
    if restic backup --tag insof --host "$HOST" "${paths[@]}" \
      && restic forget --tag insof --host "$HOST" --keep-daily "${RESTIC_KEEP_DAILY:-14}" --keep-weekly "${RESTIC_KEEP_WEEKLY:-8}" --keep-monthly "${RESTIC_KEEP_MONTHLY:-6}" --prune; then
      log "  ok"
    else
      fail "restic: backup/forget xato"
    fi
    ;;
  none)
    log "⚠ OFFSITE=none — nusxa faqat shu serverda (disk yonsa ikkalasi ketadi)"
    ;;
esac
fi

# ── 4. Mahalliy eskilarini tozalash (faqat to'liq nusxalar, joriy saqlanadi) ──
CURRENT_STEP="tozalash"
find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????*' ! -name '*.partial' -mtime "+$KEEP_DAYS" -exec rm -rf {} +
find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type d -name '*.partial' -mtime +1 -exec rm -rf {} +
log "→ $KEEP_DAYS kundan eskilari tozalandi. Jami: $(find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????*' ! -name '*.partial' | wc -l) ta"

if [ "${#FAILURES[@]}" -gt 0 ]; then
  CURRENT_STEP="yakun (${#FAILURES[@]} ta xato)"
  exit 1
fi
CURRENT_STEP="tayyor"
log "✓ Zaxira nusxa tugadi"
