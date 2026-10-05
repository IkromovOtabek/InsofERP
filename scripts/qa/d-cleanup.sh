#!/usr/bin/env bash
# QA (agent D): sinov muhitini tozalash — jarayonlarni to'xtatadi, FAQAT insof_test_ctl / insof_test_t_* /
# insof_test_restore_* bazalarini o'chiradi, $D_ROOT ni olib tashlaydi.
#   bash scripts/qa/d-cleanup.sh               to'liq
#   bash scripts/qa/d-cleanup.sh --keep-build  build qilingan relizlar $D_ROOT/cache ga olinadi (keyingi d-setup qayta ishlatadi)
set -uo pipefail
# shellcheck source=scripts/qa/d-env.sh
. "$(dirname "$0")/d-env.sh"

/bin/bash "$(dirname "$0")/d-svc.sh" stop-all || true

for db in $(d_test_dbs); do
  case "$db" in
    insof_test_ctl|insof_test_t_*|insof_test_restore_*) ;;
    *) d_die "kutilmagan baza: $db" ;;
  esac
  psql "$D_PG/postgres" -qAtX -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" && d_log "o'chirildi: $db"
done

if [ "${1:-}" = "--keep-build" ] && [ -d "$D_APP/releases" ]; then
  rm -rf "$D_ROOT/cache"; mkdir -p "$D_ROOT/cache"
  mv "$D_APP/releases" "$D_ROOT/cache/releases"
  d_log "relizlar keshda: $D_ROOT/cache/releases"
  find "$D_ROOT" -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +
else
  rm -rf "$D_ROOT"
fi
d_log "tozalandi"
