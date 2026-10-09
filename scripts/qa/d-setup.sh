#!/usr/bin/env bash
# QA (agent D): lokal platforma muhiti — papkalar, control.env/build.env, control baza (insof_test_ctl) +
# migratsiya (npm run control:migrate), superadminlar (npm run control:admin), «alfa» korxonasi lib orqali.
#   D_ROOT=/tmp/insof-qa-d bash scripts/qa/d-setup.sh
set -euo pipefail
# shellcheck source=scripts/qa/d-env.sh
. "$(dirname "$0")/d-env.sh"
cd "$D_REPO"

[ ! -e "$D_APP" ] || d_die "$D_APP allaqachon bor — avval: bash scripts/qa/d-cleanup.sh"
existing="$(d_test_dbs)"
[ -z "$existing" ] || d_die "test bazalari qolgan: $existing — avval d-cleanup.sh"

mkdir -p "$D_APP/tenants" "$D_DATA" "$D_RUN" "$D_ROOT/backups" "$D_ROOT/offsite"
chmod 700 "$D_APP/tenants"
if [ -d "$D_ROOT/cache/releases" ]; then
  mv "$D_ROOT/cache/releases" "$D_APP/releases"; rmdir "$D_ROOT/cache" 2>/dev/null || true
  d_log "keshdagi relizlar qayta ishlatiladi (d-cleanup.sh --keep-build)"
fi

rnd() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('base64'))"; }

d_log "control.env / build.env → $D_APP"
cat > "$D_APP/control.env" <<EOF
# QA sinov paneli (agent D) — haqiqiy kalit yo'q
NODE_ENV=production
TZ=Asia/Tashkent
INSOF_MODE=control
INSOF_ENV=test
OSRM_URL=http://127.0.0.1:9
AUTH_SECRET=$(rnd 48)
CONTROL_SECRET=$(rnd 48)
CONTROL_DATABASE_URL=$D_PG/$D_CTL_DB?connection_limit=3
# Umumiy lokal Postgres (max_connections 100, boshqa sinovlar ham ishlaydi) — har jarayonga kichik pul
TENANT_DATABASE_URL=$D_PG/{db}?connection_limit=3
DATABASE_URL=$D_PG/$D_CTL_DB?connection_limit=3
TENANTS_DIR=$D_APP/tenants
TENANT_DATA_ROOT=$D_DATA
TENANT_FIRST_PORT=$D_FIRST_PORT
TENANT_BASE_DOMAIN=insof.test
TEST_TENANT_DB_PREFIX=$TEST_TENANT_DB_PREFIX
EOF
chmod 600 "$D_APP/control.env"
cat > "$D_APP/build.env" <<EOF
NEXT_PUBLIC_YANDEX_MAPS_KEY=
DATABASE_URL=$D_PG/${TEST_TENANT_DB_PREFIX}alfa
APP_URL=http://127.0.0.1:$D_FIRST_PORT
NEXT_TELEMETRY_DISABLED=1
EOF
chmod 600 "$D_APP/build.env"
cat > "$D_ROOT/backup.env" <<EOF
APP_DIR=$D_APP
OUT_DIR=$D_ROOT/backups
KEEP_DAYS=14
BACKUP_UPLOADS=1
OFFSITE=rclone
RCLONE_REMOTE=
ALERT_TG_BOT_TOKEN=
ALERT_TG_CHAT_ID=
EOF

d_log "control baza: $D_CTL_DB"
psql "$D_PG/postgres" -qAtX -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$D_CTL_DB\""
CONTROL_DATABASE_URL="$D_PG/$D_CTL_DB" npm run -s control:migrate >/dev/null
d_log "superadminlar: qa.admin, qa.lock (blok sinovi uchun)"
CONTROL_ENV_FILE="$D_APP/control.env" CONTROL_ADMIN_PASSWORD="QaAdmin2026x" npx tsx scripts/control-admin.ts qa.admin "QA Admin"
CONTROL_ENV_FILE="$D_APP/control.env" CONTROL_ADMIN_PASSWORD="QaLock2026x" npx tsx scripts/control-admin.ts qa.lock "QA Lock"

d_log "alfa korxonasi — lib (provisionTenant)"
CONTROL_ENV_FILE="$D_APP/control.env" npx tsx scripts/qa/d-provision.ts alfa alfa.insof.test alfa.direktor AlfaDir2026x
d_log "tayyor. Keyingi: deploy (DRY_RUN) → d-deploy-test.sh"
