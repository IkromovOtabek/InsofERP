#!/usr/bin/env bash
# To'liq regressiya (deploy oldidan): barcha QA to'plamlari ketma-ket, har biri TOZA test bazasida.
#
#   bash scripts/qa/run-all.sh                 hammasi: a b pages c geo dm d
#   QA_ONLY="a c" bash scripts/qa/run-all.sh   faqat tanlanganlar (a, b, pages, c, geo, dm, d)
#   QA_SKIP_BUILD=1 ...                        oldingi build'ni qayta ishlatish (ish papkasi saqlangan bo'lsa)
#   QA_DB_PREFIX=insof_test_x_ ...             test bazalari prefiksi (standart insof_test_r_; parallel ishga tushirish uchun)
#   QA_KEEP=1 ...                              oxirida ish papkasi va bazalarni o'chirmaslik (tahlil uchun)
#
# Nima qiladi:
#   1. Repo nusxasi → $QA_WORK/app (rsync; .env*, .next, .git, uploads, node_modules KIRMAYDI — node_modules symlink).
#      Nusxada .env faqat .env.test.example dan yoziladi (INSOF_ENV=test) — haqiqiy .env ga tegilmaydi.
#   2. prisma generate + next build (bir marta).
#   3. Har to'plam uchun: insof_test_r_<nom> = insof_test_golden nusxasi → migrate deploy → db:test-users →
#      next start (QA_PORT) → testlar → server to'xtatiladi.
#        a     — sotuv/moliya: sales-lifecycle, openings-cash, excel-imports, prepay-gate, transfers, receivables
#        b     — sklad/ishlab chiqarish/logistika/ta'minot/kadr, kirim QQS (b-vat): b-all.sh (+ b-pages)
#        pages — src/app/(app) dagi barcha sahifalar × 14 rol (pages-all.mjs), server log xatolari
#        c     — mobil API va integratsiyalar: c-run-all.sh
#        geo   — mobil geofence "yoqilgan" rejimi (MOBILE_SITE_COORDS_REQUIRED=true), yuz skaneri nonce majburiy (MOBILE_FACE_NONCE_REQUIRED=true)
#                va jonlilik majburiy (MOBILE_FACE_LIVENESS_REQUIRED=true, alohida server)
#        dm    — IT panel monitoring/xavfsizlik UI: SSE oqimi, amallar navbati, hodisalar (d-monitor-ui.mts, control rejim),
#                yordam lug'ati («?» tugmalari: d-help.mts)
#        d     — ko'p korxonali platforma (d-run-all.sh) — git HEAD ning toza klonida (commit qilinmagan o'zgarishlar kirmaydi!);
#                ichida kiberxavfsizlik moduli ham (d-security.mts: fixture'lar, stub AI, vaqtinchalik insof_test_ctl_sec)
#   4. Natija jadvali; biror to'plam yiqilsa exit 1.
#
# Talab: lokal Postgres (joriy foydalanuvchi, CREATEDB), insof_test_golden bazasi, node_modules, portlar
#   QA_PORT (3210) va D uchun 3214–3216 bo'sh. Real serverlarga, insof_erp / insof_test bazalariga tegilmaydi.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${QA_WORK:-${TMPDIR:-/tmp}/insof-qa-run}"
WORK="${WORK%/}"
PORT="${QA_PORT:-3210}"
PG="${QA_PG:-postgresql://$(id -un)@localhost:5432}"
GOLDEN="${QA_GOLDEN:-insof_test_golden}"
ONLY="${QA_ONLY:-a b pages c geo dm d}"
PFX="${QA_DB_PREFIX:-insof_test_r_}"
case "$PFX" in insof_test_*) ;; *) printf '[qa] QA_DB_PREFIX insof_test_ bilan boshlansin\n' >&2; exit 2 ;; esac
[ "$PFX" = "insof_test_" ] && { printf '[qa] QA_DB_PREFIX juda umumiy\n' >&2; exit 2; }
case "$GOLDEN" in "$PFX"*) printf "[qa] QA_DB_PREFIX golden bazani qamrab oladi\n" >&2; exit 2 ;; esac
APP="$WORK/app"
LOGS="$WORK/logs"

die() { printf '\033[1;31m[qa] %s\033[0m\n' "$*" >&2; exit 2; }
log() { printf '\033[1;36m[qa]\033[0m %s\n' "$*"; }
[[ "$PFX" =~ ^insof_test_[a-z0-9_]+$ ]] || die "QA_DB_PREFIX insof_test_… bilan boshlanishi kerak: $PFX"
case "$WORK" in /|/var*|/etc*|/usr*|"$HOME"|/Users|"$REPO"|"$REPO"/*) die "QA_WORK xavfli: $WORK" ;; esac
psql "$PG/postgres" -Atc "select 1 from pg_database where datname='$GOLDEN'" | grep -q 1 || die "$GOLDEN bazasi yo'q"

SERVER_PID=""
stop_server() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; SERVER_PID=""; fi
  local pids; pids="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  # shellcheck disable=SC2086
  [ -z "$pids" ] || kill $pids 2>/dev/null || true
}
cleanup() {
  stop_server
  if [ "${QA_KEEP:-0}" != "1" ]; then
    for db in $(psql "$PG/postgres" -Atc "select datname from pg_database where starts_with(datname, '$PFX')"); do
      psql "$PG/postgres" -qAtc "drop database if exists \"$db\" with (force)"
    done
    [ -d "$WORK/drepo" ] && D_ROOT="$WORK/d" D_DB_PREFIX="${PFX}d_" D_CTL_PORT="${D_CTL_PORT:-3214}" D_FIRST_PORT="${D_FIRST_PORT:-3215}" /bin/bash "$WORK/drepo/scripts/qa/d-cleanup.sh" >/dev/null 2>&1
    # Loglar qoladi (yiqilgan bo'lsa tahlil uchun), ilova nusxasi va klon o'chiriladi
    rm -rf "$APP" "$WORK/drepo" "$WORK/d"
    log "loglar: $LOGS"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ── 1–2. Nusxa va build ──
mkdir -p "$LOGS"
if [ "${QA_SKIP_BUILD:-0}" != "1" ] || [ ! -d "$APP/.next" ]; then
  log "repo nusxasi → $APP"
  mkdir -p "$APP"
  rsync -a --delete --exclude='.env*' --exclude='.next' --exclude='.claude' --exclude='node_modules' \
    --exclude='uploads' --exclude='scratchpad' --exclude='.git' --exclude='tenants' --exclude='releases' "$REPO/" "$APP/"
  cp "$REPO/.env.test.example" "$APP/.env.test.example"
  ln -sfn "$REPO/node_modules" "$APP/node_modules"
  # Test .env: faqat namunadan; baza va port har to'plamda env orqali beriladi
  sed -e "s#^DATABASE_URL=.*#DATABASE_URL=\"$PG/${PFX}build\"#" -e "s#^APP_URL=.*#APP_URL=\"http://localhost:$PORT\"#" \
    "$REPO/.env.test.example" > "$APP/.env"
  ( cd "$APP" && npx prisma generate >"$LOGS/generate.log" 2>&1 && npx prisma generate --schema prisma/control/schema.prisma >>"$LOGS/generate.log" 2>&1 ) \
    || { tail -20 "$LOGS/generate.log"; die "prisma generate xato"; }
  # Build vaqtida ba'zi sahifalar (/login) statik yig'iladi va bazani o'qiydi — alohida build bazasi
  psql "$PG/postgres" -qAtc "drop database if exists ${PFX}build with (force)"
  psql "$PG/postgres" -qAtc "create database ${PFX}build template \"$GOLDEN\"" || die "createdb ${PFX}build"
  ( cd "$APP" && DATABASE_URL="$PG/${PFX}build" npx prisma migrate deploy >>"$LOGS/generate.log" 2>&1 ) || die "build bazasi migratsiyasi xato"
  log "next build (log: $LOGS/build.log)"
  ( cd "$APP" && npx next build >"$LOGS/build.log" 2>&1 ) || { tail -40 "$LOGS/build.log"; die "build xato"; }
fi

# ── 3. To'plamlar ──
RESULTS=()
FAILED=0
fresh_db() { # fresh_db <nom> → DBURL
  DB="${PFX}$1"; DBURL="$PG/$DB"
  psql "$PG/postgres" -qAtc "drop database if exists \"$DB\" with (force)"
  psql "$PG/postgres" -qAtc "create database \"$DB\" template \"$GOLDEN\"" || die "createdb $DB"
  ( cd "$APP" && DATABASE_URL="$DBURL" npx prisma migrate deploy >"$LOGS/$1-migrate.log" 2>&1 \
    && DATABASE_URL="$DBURL" npm run -s db:test-users >>"$LOGS/$1-migrate.log" 2>&1 ) || { tail -20 "$LOGS/$1-migrate.log"; die "$DB tayyorlanmadi"; }
}
start_server() { # start_server <nom> [KALIT=qiymat ...]
  local name="$1"; shift
  stop_server
  SLOG="$LOGS/$name-server.log"; : > "$SLOG"
  ( cd "$APP" && exec env DATABASE_URL="$DBURL" "$@" npx next start -p "$PORT" ) >"$SLOG" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 90); do
    curl -fsS -m 2 -o /dev/null "http://localhost:$PORT/api/health" && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || break
    sleep 1
  done
  tail -30 "$SLOG"; die "server ishga tushmadi ($name)"
}
record() { # record <nom> <exit> <log>
  if [ "$2" = 0 ]; then RESULTS+=("PASS  $1"); else RESULTS+=("FAIL  $1  (log: $3)"); FAILED=1; fi
}
suite() { # suite <nom> <buyruq...> — natija va log
  local name="$1"; shift
  local out="$LOGS/${name//\//-}.log"
  printf '\n\033[1;35m════ %s ════\033[0m\n' "$name"
  ( cd "$APP" && "$@" ) 2>&1 | tee "$out"
  record "$name" "${PIPESTATUS[0]}" "$out"
}
want() { [[ " $ONLY " == *" $1 "* ]]; }

if want a; then
  fresh_db a; start_server a
  export QA_BASE="http://localhost:$PORT" QA_DATABASE_URL="$DBURL"
  suite "a/sales-lifecycle" node scripts/qa/sales-lifecycle.mjs
  suite "a/openings-cash" node scripts/qa/openings-cash.mjs
  suite "a/excel-imports" npx tsx scripts/qa/excel-imports.mts
  suite "a/prepay-gate" env DATABASE_URL="$DBURL" npx tsx scripts/qa/prepay-gate.mts
  suite "a/transfers" env DATABASE_URL="$DBURL" npx tsx scripts/qa/transfers.mts
  suite "a/receivables" env DATABASE_URL="$DBURL" npx tsx scripts/qa/receivables.mts
  stop_server
fi
if want b; then
  fresh_db b; start_server b
  suite "b/all" env QA_DB="$DBURL" QA_BASE="http://localhost:$PORT" bash scripts/qa/b-all.sh "$SLOG"
  stop_server
fi
if want pages; then
  fresh_db pages; start_server pages
  suite "pages/all-roles" env QA_DB="$DBURL" QA_BASE="http://localhost:$PORT" QA_LOG="$SLOG" node scripts/qa/pages-all.mjs
  stop_server
fi
if want c; then
  fresh_db c; start_server c
  suite "c/all" env DATABASE_URL="$DBURL" QA_BASE="http://localhost:$PORT" QA_SERVER_LOG="$SLOG" bash scripts/qa/c-run-all.sh
  stop_server
fi
if want geo; then
  fresh_db geo; start_server geo MOBILE_SITE_COORDS_REQUIRED=true MOBILE_FACE_NONCE_REQUIRED=true
  suite "c/geofence-on" env DATABASE_URL="$DBURL" QA_BASE="http://localhost:$PORT" QA_GEOFENCE=on npx tsx scripts/qa/c-mobile-scope.ts
  suite "c/face-nonce-on" env DATABASE_URL="$DBURL" QA_BASE="http://localhost:$PORT" QA_FACE_NONCE=on npx tsx scripts/qa/c-face.ts
  # Jonlilik majburiy rejimi — alohida server (bitta kadrli face-nonce-on sinovi bu bayroq bilan o'tmaydi)
  start_server geo-live MOBILE_FACE_LIVENESS_REQUIRED=true
  suite "c/face-liveness-on" env DATABASE_URL="$DBURL" QA_BASE="http://localhost:$PORT" QA_FACE_LIVENESS=on npx tsx scripts/qa/c-liveness.ts
  stop_server
fi
if want dm; then
  # IT panel yordam lug'ati (server/baza shart emas): har amal va agent/xavfsizlik kaliti uchun tushuntirish bor
  suite "dm/help" npx tsx scripts/qa/d-help.mts
  # IT panel: monitoring va kiberxavfsizlik UI — alohida test control bazasi (seed), panel INSOF_MODE=control
  CTLURL="$PG/${PFX}ctl_ui"
  psql "$PG/postgres" -qAtc "drop database if exists \"${PFX}ctl_ui\" with (force)"
  psql "$PG/postgres" -qAtc "create database \"${PFX}ctl_ui\"" || die "createdb ${PFX}ctl_ui"
  DM_PASS="Qm-$(openssl rand -hex 8)-A1"
  ( cd "$APP" && CONTROL_DATABASE_URL="$CTLURL" npx prisma migrate deploy --schema prisma/control/schema.prisma >"$LOGS/dm-migrate.log" 2>&1 \
    && CONTROL_ENV_FILE=/nonexistent INSOF_ENV=test CONTROL_DATABASE_URL="$CTLURL" CONTROL_ADMIN_PASSWORD="$DM_PASS" \
       npx tsx scripts/control-admin.ts qa.mon "QA Monitor" >>"$LOGS/dm-migrate.log" 2>&1 ) || { tail -20 "$LOGS/dm-migrate.log"; die "${PFX}ctl_ui tayyorlanmadi"; }
  DBURL="$CTLURL"
  start_server dm INSOF_MODE=control CONTROL_DATABASE_URL="$CTLURL" TENANT_DATABASE_URL="$PG/{db}"
  suite "dm/monitor-ui" env CONTROL_DATABASE_URL="$CTLURL" QA_PANEL="http://127.0.0.1:$PORT" QA_APP="$APP" \
    QA_ADMIN_LOGIN=qa.mon QA_ADMIN_PASSWORD="$DM_PASS" QA_SERVER_LOG="$SLOG" npx tsx scripts/qa/d-monitor-ui.mts
  stop_server
fi
if want d; then
  # D: deploy.sh `git archive` qiladi — shuning uchun repo'ning git klonida (.env yo'q), HEAD sinovdan o'tadi
  rm -rf "$WORK/drepo"; git clone -q "$REPO" "$WORK/drepo" && ln -sfn "$REPO/node_modules" "$WORK/drepo/node_modules"
  ( cd "$WORK/drepo" && npx prisma generate >/dev/null 2>&1 && npx prisma generate --schema prisma/control/schema.prisma >/dev/null 2>&1 )
  printf '\n\033[1;35m════ d/platform ════\033[0m\n'
  rm -rf "$WORK/d"
  ( cd "$WORK/drepo" && env D_ROOT="$WORK/d" D_DB_PREFIX="${PFX}d_" D_CTL_PORT="${D_CTL_PORT:-3214}" D_FIRST_PORT="${D_FIRST_PORT:-3215}" \
      bash scripts/qa/d-run-all.sh ) 2>&1 | tee "$LOGS/d.log"
  record "d/platform" "${PIPESTATUS[0]}" "$LOGS/d.log"
fi

# ── 4. Natija ──
printf '\n\033[1;35m════ NATIJA ════\033[0m\n'
for r in "${RESULTS[@]}"; do
  name="$(echo "$r" | awk '{print $2}')"
  line="$(grep -hE '[0-9]+ OK, [0-9]+ FAIL|: [0-9]+ ok, [0-9]+ fail|Natija: [0-9]+ o.tdi, [0-9]+ yiqildi' "$LOGS/${name//\//-}.log" 2>/dev/null | tr '\n' ' ')"
  printf '%s   %s\n' "$r" "$line"
done
[ "${QA_KEEP:-0}" = "1" ] && log "ish papkasi saqlandi: $WORK (loglar: $LOGS)"
exit $FAILED
