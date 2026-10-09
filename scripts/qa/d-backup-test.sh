#!/usr/bin/env bash
# QA (agent D): server-backup.sh va restore-test.sh ni lokal test bazalari bilan sinash.
# Yo'llar $D_ROOT ga yo'naltirilgan (backup.env, OUT_DIR, OFFSITE_DIR); Telegram sozlanmagan — ogohlantirish faqat logda.
#   bash scripts/qa/d-backup-test.sh
set -uo pipefail
# shellcheck source=scripts/qa/d-env.sh
. "$(dirname "$0")/d-env.sh"
cd "$D_REPO" || exit 1

FAILS=0
pass() { printf '\033[1;32mPASS\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mFAIL\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }
OUT="$D_ROOT/backups"
LOGS="$D_RUN/backup-tests"; mkdir -p "$LOGS"
backup() { # backup <nom> [KALIT=qiymat ...] → exit kodi; log $LOGS/<nom>.log
  local name="$1"; shift
  env BACKUP_ENV="$D_ROOT/backup.env" "$@" /bin/bash scripts/server-backup.sh > "$LOGS/$name.log" 2>&1
}
latest() { find "$OUT" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????*' ! -name '*.partial' | sort | tail -n1; }
restore() { # restore <nom> <slug|""> [KALIT=qiymat ...]
  local name="$1" slug="$2"; shift 2
  env BACKUP_ENV="$D_ROOT/backup.env" RESTORE_DB_URL_TEMPLATE="$D_PG/{db}" RESTORE_DB_PREFIX="$D_RESTORE_PREFIX" "$@" \
    /bin/bash scripts/restore-test.sh ${slug:+"$slug"} > "$LOGS/$name.log" 2>&1
}
leftover() { psql "$D_PG/postgres" -Atc "SELECT count(*) FROM pg_database WHERE starts_with(datname, '${D_RESTORE_PREFIX}_')"; }

# Fayllar papkasida bitta fayl bo'lsin (tar arxivi bo'sh bo'lmasin)
mkdir -p "$D_DATA/alfa/uploads/contracts"; echo "qa shartnoma" > "$D_DATA/alfa/uploads/contracts/qa.txt"

echo "── server-backup.sh ──"
# 1. OFFSITE=rclone, rclone yo'q → mahalliy nusxa olinadi, lekin exit 1 + ogohlantirish
if command -v rclone >/dev/null; then echo "  (rclone o'rnatilgan — «yo'q» sinovi PATH'siz)"; fi
# Postgres vositalari alohida papkaga symlink — Homebrew'da rclone ham pg_dump bilan bir papkada bo'ladi
PGBIN="$LOGS/pgbin"; mkdir -p "$PGBIN"
for t in pg_dump pg_restore psql createdb dropdb; do command -v "$t" >/dev/null && ln -sf "$(command -v "$t")" "$PGBIN/$t"; done
backup rclone-missing PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PGBIN"; code=$?
[ "$code" != 0 ] && pass "rclone yo'q → exit $code (jim muvaffaqiyat emas)" || fail "rclone yo'q, lekin exit 0"
grep -q "rclone o'rnatilmagan" "$LOGS/rclone-missing.log" && pass "logda aniq sabab: rclone o'rnatilmagan" || fail "sabab logda yo'q"
grep -q "(ALERT)" "$LOGS/rclone-missing.log" && pass "ogohlantirish urinishi logda (Telegram sozlanmagan — no-op)" || fail "ALERT yozuvi yo'q"
L="$(latest)"
for f in control.dump alfa.dump beta.dump alfa-uploads.tar.gz SHA256SUMS; do
  [ -s "$L/$f" ] || { fail "mahalliy nusxada $f yo'q ($L)"; continue; }
done
[ -s "$L/alfa.dump" ] && [ -s "$L/beta.dump" ] && [ -s "$L/control.dump" ] && pass "mahalliy nusxa: control + alfa + beta dump, uploads, SHA256SUMS ($(basename "$L"))"
[ "$(stat -f %Lp "$L/alfa.dump" 2>/dev/null || stat -c %a "$L/alfa.dump")" = "600" ] && pass "dump fayl huquqi 600 (umask 077)" || fail "dump huquqi"

# 2. restic yo'q
backup restic-missing OFFSITE=restic RESTIC_REPOSITORY="$D_ROOT/restic" RESTIC_PASSWORD_FILE=/dev/null PATH="/usr/bin:/bin:/usr/sbin:/sbin:$(dirname "$(command -v pg_dump)")"; code=$?
[ "$code" != 0 ] && grep -q "restic o'rnatilmagan" "$LOGS/restic-missing.log" && pass "restic yo'q → exit $code + sabab" || fail "restic yo'q holati (exit $code)"

# 3. noma'lum OFFSITE
backup bogus OFFSITE=s3magic; code=$?
[ "$code" != 0 ] && grep -q "OFFSITE noma'lum" "$LOGS/bogus.log" && pass "noma'lum OFFSITE → exit $code" || fail "noma'lum OFFSITE (exit $code)"

# 4. OFFSITE=local — mahalliy «masofa» (boshqa disk) + nazorat yig'indisi
backup local OFFSITE=local OFFSITE_DIR="$D_ROOT/offsite"; code=$?
[ "$code" = 0 ] && pass "OFFSITE=local → exit 0" || { fail "OFFSITE=local exit $code"; tail -5 "$LOGS/local.log"; }
O="$(find "$D_ROOT/offsite" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' | sort | tail -n1)"
[ -n "$O" ] && [ -s "$O/alfa.dump" ] && cmp -s "$O/alfa.dump" "$(latest)/alfa.dump" && pass "offsite nusxa mahalliy bilan bir xil ($(basename "$O"))" || fail "offsite nusxa"
backup local-nodir OFFSITE=local; code=$?
[ "$code" != 0 ] && grep -q "OFFSITE_DIR berilmagan" "$LOGS/local-nodir.log" && pass "OFFSITE=local, OFFSITE_DIR'siz → exit $code" || fail "OFFSITE_DIR'siz (exit $code)"

# 5. rclone bor bo'lsa — lokal papka «masofa» sifatida
if command -v rclone >/dev/null; then
  backup rclone-local OFFSITE=rclone RCLONE_REMOTE="$D_ROOT/rclone-remote"; code=$?
  [ "$code" = 0 ] && pass "rclone (lokal papka masofa) → exit 0" || fail "rclone lokal exit $code"
else
  echo "  SKIP rclone lokal masofa — rclone o'rnatilmagan (OFFSITE=local sinovi o'rnini bosadi)"
fi

# 6. Bitta korxona bazasi yo'q → boshqalar olinadi, exit 1
cat > "$D_APP/tenants/broken.env" <<EOF
PORT=3299
DATABASE_URL=$D_PG/${TEST_TENANT_DB_PREFIX}missing
UPLOADS_DIR=$D_DATA/broken/uploads
EOF
backup broken OFFSITE=local OFFSITE_DIR="$D_ROOT/offsite"; code=$?
rm -f "$D_APP/tenants/broken.env"
L="$(latest)"
[ "$code" != 0 ] && grep -q "broken: pg_dump xato" "$LOGS/broken.log" && [ -s "$L/alfa.dump" ] && [ ! -e "$L/broken.dump" ] \
  && pass "yo'q baza: exit $code, qolganlari olindi, ogohlantirishda sabab" || fail "yo'q baza holati (exit $code)"
grep -q "broken: pg_dump xato" <(grep "(ALERT)" "$LOGS/broken.log") && pass "ALERT matnida xato ro'yxati" || fail "ALERT matnida xato yo'q"

# 7. Qulf: boshqa jarayon ishlayapti → chiqadi; eski (o'lik) qulf → davom etadi
if ! command -v flock >/dev/null; then
  mkdir -p "$OUT/.lock.d"; sleep 300 & holder=$!; echo "$holder" > "$OUT/.lock.d/pid"
  backup locked OFFSITE=none; code=$?
  kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null
  [ "$code" != 0 ] && grep -q "Boshqa zaxira jarayoni" "$LOGS/locked.log" && pass "qulf: parallel ishga tushish rad" || fail "qulf (exit $code)"
  mkdir -p "$OUT/.lock.d"; echo 999999 > "$OUT/.lock.d/pid"
  backup stale OFFSITE=none; code=$?
  [ "$code" = 0 ] && grep -q "eski qulf" "$LOGS/stale.log" && pass "o'lik jarayon qulfi olib tashlandi, nusxa olindi" || fail "eski qulf (exit $code)"
  [ ! -e "$OUT/.lock.d" ] && pass "qulf tugagach o'chirildi" || fail "qulf qoldi"
else
  echo "  SKIP mkdir-qulf sinovi (flock bor)"
fi
n="$(find "$OUT" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????*' ! -name '*.partial' | wc -l | tr -d ' ')"
[ "$(find "$OUT" -mindepth 2 -maxdepth 2 -type d -name '20??-??-??_*' | wc -l | tr -d ' ')" = 0 ] && pass "bir daqiqadagi nusxalar ichma-ich emas ($n ta alohida papka)" || fail "ichma-ich nusxa papkasi"

echo "── restore-test.sh ──"
restore restore-all ""; code=$?
[ "$code" = 0 ] && pass "oxirgi nusxa tiklandi va tekshirildi" || { fail "restore exit $code"; tail -15 "$LOGS/restore-all.log"; }
grep -q "User: 2" "$LOGS/restore-all.log" && grep -q "SuperAdmin: 2" "$LOGS/restore-all.log" && pass "qator sonlari logda (User, SuperAdmin)" || fail "qator sonlari"
[ "$(leftover)" = 0 ] && pass "vaqtinchalik bazalar o'chirildi" || fail "${D_RESTORE_PREFIX}_* qoldi"
restore restore-one alfa; code=$?
[ "$code" = 0 ] && grep -q "alfa.dump" "$LOGS/restore-one.log" && ! grep -q "beta.dump" "$LOGS/restore-one.log" && pass "bitta korxona (alfa) tiklash" || fail "restore alfa exit $code"

# Buzilgan nusxa: SHA256SUMS mos emas → exit 1
L="$(latest)"; BAD="$OUT/2099-01-01_0000"
cp -R "$L" "$BAD"; printf 'buzildi' >> "$BAD/alfa.dump"
restore restore-corrupt ""; code=$?
[ "$code" != 0 ] && grep -q "SHA256SUMS mos emas" "$LOGS/restore-corrupt.log" && pass "buzilgan nusxa aniqlandi (SHA256) → exit $code" || fail "buzilgan nusxa (exit $code)"
grep -q "(ALERT)" "$LOGS/restore-corrupt.log" && pass "tiklash xatosi — ogohlantirish urinishi" || fail "tiklash ALERT yo'q"
# Nazorat yig'indisisiz buzuq dump → pg_restore xato, baza baribir o'chiriladi
head -c 2000 "$L/alfa.dump" > "$D_RUN/truncated.dump"
restore restore-trunc "" DUMP="$D_RUN/truncated.dump"; code=$?
[ "$code" != 0 ] && pass "kesilgan dump → exit $code" || fail "kesilgan dump exit 0"
[ "$(leftover)" = 0 ] && pass "xatoda ham vaqtinchalik baza o'chirildi" || fail "xatodan keyin baza qoldi"
rm -rf "$BAD" "$D_RUN/truncated.dump"

[ "$FAILS" = 0 ] && echo "zaxira sinovlari: hammasi o'tdi" || { echo "zaxira sinovlari: $FAILS FAIL (loglar: $LOGS)"; exit 1; }
