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
#
# ESLATMA: insof-agent (scripts/insof-agent.ts, docs/deploy/insof-agent.service) buning o'rnini bosadi — har 15 s
# /api/health + systemd + Postgres + SSL + zaxira, hodisalar panelda, Telegram ogohlantirishi o'zida. Agent yoqilgach bu
# cron qatorini o'chiring (aks holda bir yiqilish uchun ikki xabar keladi). Skript ishlashda qoladi — agentsiz
# muhit yoki agentning o'zi to'xtaganini sezish uchun zaxira kuzatuv sifatida (masalan har 5 daqiqada) qoldirish mumkin.
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
if command -v flock >/dev/null; then
  exec 9>"$STATE_DIR/.lock"
  flock -n 9 || exit 0   # oldingi tekshiruv hali tugamagan
else
  # flock yo'q (macOS) — mkdir qulfi; eski (o'lgan jarayon) qulfi olib tashlanadi
  if ! mkdir "$STATE_DIR/.lock.d" 2>/dev/null; then
    other="$(cat "$STATE_DIR/.lock.d/pid" 2>/dev/null || true)"
    if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then exit 0; fi
    mkdir -p "$STATE_DIR/.lock.d"
  fi
  echo $$ > "$STATE_DIR/.lock.d/pid"
  trap 'rm -rf "$STATE_DIR/.lock.d"' EXIT
fi

log() { printf '[%s] %s\n' "$(date +'%F %T')" "$*"; }
tg() {
  if [ -z "${ALERT_TG_BOT_TOKEN:-}" ] || [ -z "${ALERT_TG_CHAT_ID:-}" ]; then
    log "(Telegram sozlanmagan) $1"; return 0
  fi
  curl -fsS -m 15 -o /dev/null "https://api.telegram.org/bot${ALERT_TG_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_TG_CHAT_ID}" --data-urlencode "text=$1" || log "⚠ Telegram xabari yuborilmadi"
}

# Kuzatiladigan nishonlar: "nom|port" — faqat yoqilgan (enabled) xizmatlar.
# CHECK_ALL=1 — systemd so'ralmaydi: barcha tenants/*.env (+ control.env bo'lsa panel). Lokal sinov yoki systemd'siz muhit.
CHECK_ALL="${CHECK_ALL:-0}"
if [ "$CHECK_ALL" != "1" ] && ! command -v systemctl >/dev/null; then
  log "✗ systemctl topilmadi — qaysi xizmat yoqilganini bilib bo'lmaydi. Hammasini tekshirish: CHECK_ALL=1"
  exit 1
fi
enabled() { [ "$CHECK_ALL" = "1" ] || systemctl is-enabled --quiet "$1" 2>/dev/null; }
TARGETS=()
shopt -s nullglob
for f in "$APP_DIR"/tenants/*.env; do
  slug="$(basename "$f" .env)"
  [[ "$slug" =~ ^[a-z][a-z0-9-]{1,29}$ ]] || continue
  enabled "insof-erp@$slug" || continue
  port="$(env_get "$f" PORT)"
  [ -n "$port" ] && TARGETS+=("insof-erp@$slug|$port")
done
shopt -u nullglob
if { [ "$CHECK_ALL" != "1" ] || [ -f "$APP_DIR/control.env" ]; } && enabled insof-control; then TARGETS+=("insof-control|$CONTROL_PORT"); fi
[ "${#TARGETS[@]}" -gt 0 ] || log "⚠ kuzatiladigan xizmat topilmadi ($APP_DIR/tenants/*.env)"

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
