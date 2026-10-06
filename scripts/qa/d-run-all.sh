#!/usr/bin/env bash
# QA (agent D): ko'p korxonali platformaning to'liq lokal sinovi — boshidan oxirigacha, oxirida tozalaydi.
#   D_ROOT=/tmp/insof-qa-d bash scripts/qa/d-run-all.sh
#   D_KEEP=1  — oxirida tozalamaslik (jarayonlar ishlab qoladi: panel :3204, alfa :3205, beta :3206)
#   D_FAIL_REF=<commit> — «buzuq reliz» sinovi uchun boshqa commit (standart HEAD~1; ikkinchi build qilinadi)
# Talab: lokal Postgres (joriy foydalanuvchi, CREATEDB), node_modules (D_NODE_MODULES), portlar 3204–3206 bo'sh.
set -uo pipefail
# shellcheck source=scripts/qa/d-env.sh
. "$(dirname "$0")/d-env.sh"
cd "$D_REPO" || exit 1
Q="$D_REPO/scripts/qa"
FAIL_REF="${D_FAIL_REF:-HEAD~1}"
SUMMARY=()
run() { # run <nom> <buyruq...>
  local name="$1"; shift
  printf '\n\033[1;35m════ %s ════\033[0m\n' "$name"
  if "$@"; then SUMMARY+=("PASS  $name"); else SUMMARY+=("FAIL  $name"); fi
}

/bin/bash "$Q/d-cleanup.sh" >/dev/null 2>&1 || true
run "setup (control baza, admin, alfa — lib)" /bin/bash "$Q/d-setup.sh"
run "deploy DRY_RUN: birinchi reliz" /bin/bash "$Q/d-deploy-test.sh" first
run "HTTP: panel, SSO, izolyatsiya, to'xtatish" env D_ROOT="$D_ROOT" npx tsx "$Q/d-platform.ts"
run "zaxira + tiklash" /bin/bash "$Q/d-backup-test.sh"
run "health-watch" /bin/bash "$Q/d-health-test.sh"
run "insof-agent (parserlar + lokal integratsiya, baza insof_test_ctl_agent)" npx tsx "$Q/d-agent.mts"
run "deploy: buzuq reliz → avtomatik qaytarish ($FAIL_REF)" /bin/bash "$Q/d-deploy-test.sh" fail "$FAIL_REF"
run "deploy: ROLLBACK=1" /bin/bash "$Q/d-deploy-test.sh" rollback
run "deploy: HEAD qayta (build qayta ishlatiladi)" /bin/bash "$Q/d-deploy-test.sh" again
run "deploy: yo'q baza migratsiyasi" /bin/bash "$Q/d-deploy-test.sh" migfail
run "deploy: himoyalar" /bin/bash "$Q/d-deploy-test.sh" guard
run "bash -n (barcha skriptlar)" /bin/bash -c 'for f in scripts/*.sh scripts/qa/*.sh; do /bin/bash -n "$f" || exit 1; done'
if [ "$(uname)" = "Darwin" ] || ! command -v systemctl >/dev/null; then
  out="$(/bin/bash scripts/tenant-up.sh alfa 2>&1)"; code=$?
  run "tenant-up.sh: root'siz aniq xato" test "$code" != 0 -a -n "$(printf '%s' "$out" | grep 'sudo bilan')"
fi

if [ "${D_KEEP:-0}" != "1" ]; then /bin/bash "$Q/d-cleanup.sh"; fi
printf '\n\033[1;35m════ NATIJA ════\033[0m\n'
printf '%s\n' "${SUMMARY[@]}"
case " ${SUMMARY[*]} " in *FAIL*) exit 1 ;; esac
