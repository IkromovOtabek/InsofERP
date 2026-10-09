#!/usr/bin/env bash
# QA (agent D): scripts/deploy.sh ni DRY_RUN=1 bilan lokal sinash (sinov APP_DIR, systemd o'rniga d-svc.sh).
#   bash scripts/qa/d-deploy-test.sh first            HEAD → build, migratsiya, symlink, xizmatlar, health
#   bash scripts/qa/d-deploy-test.sh fail <ref>       boshqa reliz + ataylab yiqilgan xizmat → avtomatik qaytarish
#   bash scripts/qa/d-deploy-test.sh rollback         ROLLBACK=1 → oldingi relizga
#   bash scripts/qa/d-deploy-test.sh again            HEAD qayta (build qayta ishlatiladi)
#   bash scripts/qa/d-deploy-test.sh guard            himoyalar: DRY_RUN prod papkasida, NODE_MODULES_FROM prodda — rad
set -uo pipefail
# shellcheck source=scripts/qa/d-env.sh
. "$(dirname "$0")/d-env.sh"
cd "$D_REPO" || exit 1

phase="${1:?first|fail|rollback|again|guard}"
SVC="/bin/bash $D_REPO/scripts/qa/d-svc.sh restart"
run_deploy() { # qo'shimcha env'lar argument sifatida: KALIT=qiymat ...
  env DRY_RUN=1 APP_DIR="$D_APP" REPO_DIR="$D_REPO" NODE_MODULES_FROM="$D_NODE_MODULES" \
    CONTROL_PORT="$D_CTL_PORT" HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}" KEEP_RELEASES=3 RESTART_CMD="$SVC" \
    "$@" /bin/bash scripts/deploy.sh
}
cur() { basename "$(readlink "$D_APP/current" 2>/dev/null)" 2>/dev/null | cut -c1-12; }
pass() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
FAILS=0
all_healthy() {
  local f p ok=0
  curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$D_CTL_PORT/api/health" || ok=1
  for f in "$D_APP"/tenants/*.env; do
    p="$(grep -E '^PORT=' "$f" | cut -d= -f2)"
    curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$p/api/health" || ok=1
  done
  return $ok
}

case "$phase" in
  first)
    run_deploy; code=$?
    [ "$code" = 0 ] && pass "deploy (birinchi) exit 0" || fail "deploy exit $code"
    [ "$(cur)" = "$(git rev-parse HEAD | cut -c1-12)" ] && pass "current → HEAD" || fail "current=$(cur)"
    [ -f "$D_APP/current/RELEASE" ] && pass "RELEASE fayli" || fail "RELEASE yo'q"
    all_healthy && pass "panel + korxonalar /api/health 200" || fail "health"
    v="$(curl -fsS "http://127.0.0.1:$D_CTL_PORT/api/health")"; echo "  $v"
    case "$v" in *"$(git rev-parse HEAD | cut -c1-12)"*) pass "health version = sha" ;; *) fail "health version" ;; esac
    ;;
  fail)
    ref="${2:?ref}"; before="$(cur)"
    victim="insof-erp@$(basename "$(ls "$D_APP"/tenants/*.env | tail -n1)" .env)"
    # DEPLOY_REF_BASE=HEAD: lokal repo origin/main dan oldinda bo'lishi mumkin (prodda tekshiruv origin/main bo'yicha)
    HEALTH_TIMEOUT=8 run_deploy DEPLOY_REF="$ref" DEPLOY_REF_BASE=HEAD D_FAIL_UNIT="$victim" D_FAIL_RELEASE="$(git rev-parse "$ref^{commit}")"; code=$?
    [ "$code" != 0 ] && pass "yiqilgan xizmat ($victim) → deploy exit $code" || fail "deploy xato bermadi"
    [ "$(cur)" = "$before" ] && pass "avtomatik qaytarish: current = $before" || fail "current=$(cur), kutilgan $before"
    sleep 2; all_healthy && pass "qaytarilgandan keyin hammasi 200" || fail "qaytarishdan keyin health"
    [ -d "$D_APP/releases/$(git rev-parse "$ref^{commit}")" ] && pass "yangi reliz papkasi saqlandi (keyingi ROLLBACK/qayta deploy uchun)" || fail "reliz papkasi yo'q"
    ;;
  rollback)
    before="$(cur)"
    run_deploy ROLLBACK=1; code=$?
    [ "$code" = 0 ] && pass "ROLLBACK=1 exit 0" || fail "ROLLBACK exit $code"
    [ "$(cur)" != "$before" ] && pass "current $before → $(cur)" || fail "current o'zgarmadi"
    all_healthy && pass "oldingi relizda hammasi 200" || fail "health"
    ;;
  again)
    run_deploy > "$D_RUN/deploy-again.log" 2>&1; code=$?
    [ "$code" = 0 ] && pass "qayta deploy exit 0" || { fail "exit $code"; tail -20 "$D_RUN/deploy-again.log"; }
    grep -q "allaqachon build qilingan" "$D_RUN/deploy-again.log" && pass "build qayta ishlatildi" || fail "qayta build qilindi"
    [ "$(cur)" = "$(git rev-parse HEAD | cut -c1-12)" ] && pass "current → HEAD" || fail "current=$(cur)"
    all_healthy && pass "hammasi 200" || fail "health"
    ;;
  migfail)
    # Bitta korxona bazasi migratsiya qilinmasa — symlink almashmaydi, xizmatlarga tegilmaydi
    before="$(cur)"
    printf 'PORT=3299\nDATABASE_URL=%s/%smissing\n' "$D_PG" "$TEST_TENANT_DB_PREFIX" > "$D_APP/tenants/zbroken.env"
    out="$(run_deploy 2>&1)"; code=$?
    rm -f "$D_APP/tenants/zbroken.env"
    [ "$code" != 0 ] && [[ "$out" == *"zbroken bazasi migratsiyasi xato"* ]] && pass "migratsiya xatosi → exit $code, aniq sabab" || fail "migfail: exit $code"
    [ "$(cur)" = "$before" ] && pass "current o'zgarmadi ($before)" || fail "current=$(cur)"
    [[ "$out" != *"[d-svc]"* ]] && pass "xizmatlar qayta ishga tushirilmadi" || fail "xizmatlarga tegildi"
    [ -z "$(psql "$D_PG/postgres" -Atc "SELECT 1 FROM pg_database WHERE datname = '${TEST_TENANT_DB_PREFIX}missing'")" ] \
      && pass "yo'q baza jim yaratilmadi (prisma migrate deploy o'zi yaratardi)" || fail "${TEST_TENANT_DB_PREFIX}missing yaratilib qoldi"
    all_healthy && pass "hammasi 200" || fail "health"
    ;;
  guard)
    out="$(env DRY_RUN=1 APP_DIR=/var/www/insof-erp /bin/bash scripts/deploy.sh 2>&1)"; code=$?
    [ "$code" != 0 ] && [[ "$out" == *"faqat sinov APP_DIR"* ]] && pass "DRY_RUN prod papkasida rad etildi" || fail "DRY_RUN guard: $out"
    out="$(env APP_DIR="$D_APP" NODE_MODULES_FROM=/tmp /bin/bash scripts/deploy.sh 2>&1)"; code=$?
    [ "$code" != 0 ] && [[ "$out" == *"faqat DRY_RUN=1"* ]] && pass "NODE_MODULES_FROM DRY_RUN'siz rad etildi" || fail "NODE_MODULES_FROM guard: $out"
    ;;
  *) d_die "noma'lum bosqich: $phase" ;;
esac
[ "$FAILS" = 0 ] || exit 1
