#!/usr/bin/env bash
# QA (agent D): systemd o'rnini bosuvchi lokal xizmat boshqaruvchisi — `next start` ni $D_APP/current dan
# korxona .env i bilan ishga tushiradi (insof-erp@.service / insof-control.service bilan bir xil buyruq).
#   bash scripts/qa/d-svc.sh start|stop|restart|status <insof-control | insof-erp@<slug>>
#   bash scripts/qa/d-svc.sh stop-all
# deploy.sh DRY_RUN=1 da RESTART_CMD="bash scripts/qa/d-svc.sh restart" sifatida ishlatiladi.
# Nosozlik sinovi: D_FAIL_UNIT=<unit> — shu xizmat «ishga tushmaydi» (systemd crash-loop kabi, buyruq 0 qaytaradi).
set -euo pipefail
# shellcheck source=scripts/qa/d-env.sh
. "$(dirname "$0")/d-env.sh"

cmd="${1:?start|stop|restart|status|stop-all}"
unit="${2:-}"
mkdir -p "$D_RUN"

env_file_of() {
  case "$1" in
    insof-control) echo "$D_APP/control.env" ;;
    insof-erp@*) echo "$D_APP/tenants/${1#insof-erp@}.env" ;;
    *) d_die "noma'lum xizmat: $1" ;;
  esac
}
port_of() {
  case "$1" in
    insof-control) echo "$D_CTL_PORT" ;;
    *) grep -E '^PORT=' "$(env_file_of "$1")" | tail -n1 | cut -d= -f2 ;;
  esac
}

stop_unit() {
  local u="$1" pf="$D_RUN/$1.pid" port pids
  port="$(port_of "$u")"
  if [ -f "$pf" ]; then kill "$(cat "$pf")" 2>/dev/null || true; rm -f "$pf"; fi
  # Port hali band bo'lsa (next start bola jarayoni) — faqat shu portdagi tinglovchi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] || return 0
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.5
  done
  d_die "$u: port $port bo'shamadi"
}

start_unit() {
  local u="$1" envf port
  envf="$(env_file_of "$u")"; port="$(port_of "$u")"
  [ -f "$envf" ] || d_die "$envf yo'q"
  [ -d "$D_APP/current" ] || d_die "$D_APP/current yo'q (avval deploy)"
  # D_FAIL_RELEASE berilsa — faqat shu relizda yiqiladi (buzuq yangi reliz; eskisi ishlaydi)
  local rel; rel="$(basename "$(readlink "$D_APP/current")")"
  if [ "${D_FAIL_UNIT:-}" = "$u" ] && [[ "$rel" == "${D_FAIL_RELEASE:-}"* ]]; then
    echo "  [d-svc] $u — D_FAIL_UNIT: ataylab ishga tushirilmadi (nosozlik sinovi, reliz ${rel:0:7})"
    return 0
  fi
  (
    cd "$D_APP/current"
    set -a
    # shellcheck disable=SC1090
    . "$envf"
    set +a
    exec node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$port"
  ) >>"$D_RUN/$u.log" 2>&1 &
  echo $! > "$D_RUN/$u.pid"
  echo "  [d-svc] $u → :$port (pid $!, reliz $(basename "$(readlink "$D_APP/current")" | cut -c1-7))"
}

case "$cmd" in
  start) start_unit "$unit" ;;
  stop) stop_unit "$unit" ;;
  restart) stop_unit "$unit"; start_unit "$unit" ;;
  status)
    if curl -fsS -m 3 "http://127.0.0.1:$(port_of "$unit")/api/health"; then echo; else echo "DOWN"; exit 1; fi ;;
  stop-all)
    for pf in "$D_RUN"/*.pid; do
      [ -f "$pf" ] || continue
      u="$(basename "$pf" .pid)"; stop_unit "$u" || true
    done
    # pid fayli yo'qolgan bo'lsa ham — bizning portlar
    for port in "$D_CTL_PORT" "$D_FIRST_PORT" $((D_FIRST_PORT + 1)) $((D_FIRST_PORT + 2)); do
      pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
      # shellcheck disable=SC2086
      [ -z "$pids" ] || kill $pids 2>/dev/null || true
    done ;;
  *) d_die "noma'lum buyruq: $cmd" ;;
esac
