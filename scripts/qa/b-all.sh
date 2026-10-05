#!/usr/bin/env bash
# QA (B) — sklad / ishlab chiqarish / logistika / ta'minot / kadr skriptlarini ketma-ket ishga tushiradi.
# Talab: test serveri ishlayapti (QA_BASE, standart http://localhost:3202), baza — insof_test… (QA_DB).
#   QA_DB=postgresql://otabek@localhost:5432/insof_test_b QA_BASE=http://localhost:3202 bash scripts/qa/b-all.sh [server.log]
# Toza bazada ishlating: createdb -T insof_test_golden insof_test_b && npx prisma migrate deploy && npm run db:test-users
set -u
cd "$(dirname "$0")/../.."
export QA_DB="${QA_DB:-postgresql://otabek@localhost:5432/insof_test_b}"
export DATABASE_URL="$QA_DB"
# 1-argument (ixtiyoriy): server log fayli — b-pages undagi yangi xatolarni tekshiradi
if [ $# -ge 1 ]; then export QA_LOG="$1"; fi
fail=0
for t in b-supply.mjs b-receipts.mts b-vat.mts b-production.mts b-logistics.mts b-hr.mts b-mobile.mts b-pages.mjs; do
  echo "=== $t"
  if [[ "$t" == *.mts ]]; then npx tsx "scripts/qa/$t" || fail=1; else node "scripts/qa/$t" || fail=1; fi
done
exit $fail
