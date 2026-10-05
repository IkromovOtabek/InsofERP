#!/usr/bin/env bash
# QA (agent D): health-watch.sh — lokal portlar (panel 3204, alfa 3205, beta 3206), bitta korxona to'xtatiladi.
#   bash scripts/qa/d-health-test.sh
set -uo pipefail
# shellcheck source=scripts/qa/d-env.sh
. "$(dirname "$0")/d-env.sh"
cd "$D_REPO" || exit 1

FAILS=0
pass() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
ST="$D_RUN/health-state"; rm -rf "$ST"
watch() {
  env BACKUP_ENV="$D_ROOT/backup.env" APP_DIR="$D_APP" STATE_DIR="$ST" CONTROL_PORT="$D_CTL_PORT" CHECK_ALL=1 "$@" \
    /bin/bash scripts/health-watch.sh
}
SVC="/bin/bash $D_REPO/scripts/qa/d-svc.sh"

out="$(env BACKUP_ENV="$D_ROOT/backup.env" APP_DIR="$D_APP" STATE_DIR="$ST" /bin/bash scripts/health-watch.sh 2>&1)"; code=$?
if command -v systemctl >/dev/null; then echo "  SKIP systemctl'siz sinov (systemctl bor)"
else [ "$code" != 0 ] && [[ "$out" == *"systemctl topilmadi"* ]] && pass "systemctl yo'q → aniq xato, exit $code (jim o'tmaydi)" || fail "systemctl'siz: exit $code $out"; fi

out="$(watch 2>&1)"; code=$?
[ "$code" = 0 ] && [ -z "$out" ] && pass "hammasi ishlayapti → jim, exit 0" || fail "1-tekshiruv: exit $code «$out»"
[ -f "$ST/insof-control.state" ] && [ -f "$ST/insof-erp@alfa.state" ] && [ -f "$ST/insof-erp@beta.state" ] && pass "panel + alfa + beta kuzatildi" || fail "holat fayllari: $(ls "$ST")"

$SVC stop insof-erp@beta >/dev/null
out="$(watch 2>&1)"
[[ "$out" == *"insof-erp@beta: jarayon javob bermayapti (1-marta)"* ]] && [[ "$out" != *"[XATO]"* ]] && pass "1-yiqilish: faqat log, ogohlantirish yo'q (FAIL_THRESHOLD=2)" || fail "1-yiqilish: «$out»"
out="$(watch 2>&1)"
[[ "$out" == *"[XATO] insof-erp@beta"* ]] && [[ "$out" == *"Telegram sozlanmagan"* ]] && pass "2-yiqilish: ogohlantirish (Telegram sozlanmagan — logda)" || fail "2-yiqilish: «$out»"
[[ "$out" != *"alfa"* ]] && pass "alfa ta'sirlanmadi" || fail "alfa ham yiqildi?"
out="$(watch 2>&1)"
[[ "$out" != *"[XATO]"* ]] && pass "3-tekshiruv: takroriy ogohlantirish yo'q (REALERT_MIN)" || fail "takror: «$out»"
out="$(watch REALERT_MIN=0 2>&1)"
[[ "$out" == *"[XATO] insof-erp@beta"* ]] && pass "REALERT_MIN o'tgach — eslatma" || fail "eslatma: «$out»"

$SVC start insof-erp@beta >/dev/null
for _ in $(seq 1 60); do curl -fsS -m 2 -o /dev/null "http://127.0.0.1:$((D_FIRST_PORT + 1))/api/health" && break; sleep 1; done
out="$(watch 2>&1)"
[[ "$out" == *"[TIKLANDI] insof-erp@beta"* ]] && pass "tiklanish xabari" || fail "tiklanish: «$out»"
out="$(watch 2>&1)"
[ -z "$out" ] && pass "tiklangandan keyin jim" || fail "keyin: «$out»"

[ "$FAILS" = 0 ] && echo "health-watch: hammasi o'tdi" || { echo "health-watch: $FAILS FAIL"; exit 1; }
