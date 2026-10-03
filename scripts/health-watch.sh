#!/usr/bin/env bash
# Har korxona jarayoni va IT panelning /api/health holatini kuzatish (cron, har daqiqa) — Telegram ogohlantirish.
#
# Takrorlanmas xabar: holat O'ZGARGANDA yuboriladi (ishlayapti → yiqildi, yiqildi → tiklandi),
# yiqilgan holat davom etsa — har REALERT_MIN daqiqada (standart 60) bir eslatma.
# Bir martalik xato (masalan restart paytida) uchun ogohlantirish yo'q: ketma-ket FAIL_THRESHOLD (2) marta yiqilsa.
#
# Sozlama: /etc/insof/backup.env dagi ALERT_TG_BOT_TOKEN / ALERT_TG_CHAT_ID (zaxira nusxa bilan umumiy).
# Cron (deploy ostida):
#   * * * * * /var/www/insof-erp/scripts/health-watch.sh >> /var/log/insof-health.log 2>&1
set -uo pipefail

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
ALERT_TG_BOT_TOKEN="${ALERT_TG_BOT_TOKEN:-$(env_get "$BACKUP_ENV" ALERT_TG_BOT_TOKEN)}"
ALERT_TG_CHAT_ID="${ALERT_TG_CHAT_ID:-$(env_get "$BACKUP_ENV" ALERT_TG_CHAT_ID)}"
STATE_DIR="${STATE_DIR:-/var/tmp/insof-health}"
CONTROL_PORT="${CONTROL_PORT:-3100}"
REALERT_MIN="${REALERT_MIN:-60}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-2}"
HOST="$(hostname -s 2>/dev/null || hostname)"
NOW="$(date +%s)"

mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/.lock"
flock -n 9 || exit 0   # oldingi tekshiruv hali tugamagan

log() { printf '[%s] %s\n' "$(date +'%F %T')" "$*"; }
tg() {
  if [ -z "${ALERT_TG_BOT_TOKEN:-}" ] || [ -z "${ALERT_TG_CHAT_ID:-}" ]; then
    log "(Telegram sozlanmagan) $1"; return 0
  fi
  curl -fsS -m 15 -o /dev/null "https://api.telegram.org/bot${ALERT_TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_TG_CHAT_ID}" --data-urlencode "text=$1" || log "⚠ Telegram xabari yuborilmadi"
}

# Kuzatiladigan nishonlar: "nom|port" — faqat yoqilgan (enabled) xizmatlar
TARGETS=()
shopt -s nullglob
for f in "$APP_DIR"/tenants/*.env; do
  slug="$(basename "$f" .env)"
  [[ "$slug" =~ ^[a-z][a-z0-9-]{1,29}$ ]] || continue
  systemctl is-enabled --quiet "insof-erp@$slug" 2>/dev/null || continue
  port="$(env_get "$f" PORT)"
  [ -n "$port" ] && TARGETS+=("insof-erp@$slug|$port")
done
shopt -u nullglob
if systemctl is-enabled --quiet insof-control 2>/dev/null; then TARGETS+=("insof-control|$CONTROL_PORT"); fi

for t in ${TARGETS[@]+"${TARGETS[@]}"}; do
  name="${t%%|*}"; port="${t#*|}"
  sf="$STATE_DIR/$name.state"
  # holat fayli: <status> <ketma-ket xato soni> <oxirgi xabar vaqti>
  prev="up"; fails=0; last_alert=0
  if [ -f "$sf" ]; then read -r prev fails last_alert < "$sf" || true; fi
  [[ "$fails" =~ ^[0-9]+$ ]] || fails=0
  [[ "$last_alert" =~ ^[0-9]+$ ]] || last_alert=0
  code="$(curl -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/health" || true)"
  if [ "$code" = "200" ]; then
    if [ "$prev" = "down" ]; then
      tg "[TIKLANDI] $name ($HOST) yana ishlayapti"
      log "$name tiklandi"
    fi
    echo "up 0 0" > "$sf"
    continue
  fi
  fails=$((fails + 1))
  reason="HTTP ${code:-000}"; [ "$code" = "503" ] && reason="baza javob bermayapti (503)"; [ "$code" = "000" ] && reason="jarayon javob bermayapti"
  if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
    if [ "$prev" != "down" ] || [ $((NOW - last_alert)) -ge $((REALERT_MIN * 60)) ]; then
      tg "[XATO] $name ($HOST, port $port): $reason. Tekshirish: journalctl -u $name -n 80"
      log "$name: $reason (ogohlantirildi)"
      last_alert="$NOW"
    fi
    echo "down $fails $last_alert" > "$sf"
  else
    echo "$prev $fails $last_alert" > "$sf"
    log "$name: $reason ($fails-marta)"
  fi
done
exit 0
