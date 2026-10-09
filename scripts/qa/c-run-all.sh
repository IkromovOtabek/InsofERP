#!/bin/bash
# QA (C): mobil API va integratsiyalar — barcha testlar (server 3203 da ishlab turgan bo'lishi kerak: c-rebuild.sh).
#   QA_SERVER_LOG=/tmp/c-server.log bash scripts/qa/c-run-all.sh
# Geofence "yoqilgan" rejimi alohida: server MOBILE_SITE_COORDS_REQUIRED=true bilan, keyin
#   QA_GEOFENCE=on npx tsx scripts/qa/c-mobile-scope.ts
# Yuz skaneri challenge'i majburiy rejimi: server MOBILE_FACE_NONCE_REQUIRED=true bilan, keyin
#   QA_FACE_NONCE=on npx tsx scripts/qa/c-face.ts   (run-all.sh da "geo" to'plami ichida)
cd "$(dirname "$0")/../.."
fail=0
for t in c-no-sms c-mobile-auth c-mobile-roles c-mobile-scope c-mobile-money c-mobile-cash c-integrations c-face c-gps; do
  echo "════════ $t"
  npx tsx "scripts/qa/$t.ts" || fail=1
done
exit $fail
