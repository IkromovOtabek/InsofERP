# shellcheck shell=bash disable=SC2034
# QA (agent D) — ko'p korxonali platformani LOKAL sinash muhiti. Boshqa d-*.sh skriptlar `source` qiladi.
#
# Hammasi bitta vaqtinchalik papkada (D_ROOT) — serverdagi /var/www/insof-erp, /var/lib/insof, /var/backups/insof o'rnida:
#   $D_ROOT/app/            APP_DIR: control.env, build.env, tenants/*.env, releases/, current → releases/<sha>
#   $D_ROOT/data/<slug>/    TENANT_DATA_ROOT (korxona fayllari)
#   $D_ROOT/backups/        server-backup.sh OUT_DIR;  $D_ROOT/offsite/ — OFFSITE=local nishoni
#   $D_ROOT/run/            jarayonlar pid va loglari, health-watch holati
# Bazalar faqat lokal va `insof_test_` prefiksli: insof_test_ctl, insof_test_t_<slug>, insof_test_restore_* (D_DB_PREFIX bilan almashadi).
# Portlar: panel 3204, korxonalar 3205+ (TENANT_FIRST_PORT). Boshqa portlar: D_CTL_PORT=3214 D_FIRST_PORT=3215.

D_REPO="${D_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
D_ROOT="${D_ROOT:-${TMPDIR:-/tmp}/insof-qa-d}"
export D_ROOT
D_APP="$D_ROOT/app"
D_DATA="$D_ROOT/data"
D_RUN="$D_ROOT/run"
D_PGUSER="${D_PGUSER:-$(id -un)}"
D_PG="postgresql://$D_PGUSER@127.0.0.1:5432"
d_log() { printf '\033[1;36m[d-qa]\033[0m %s\n' "$*"; }
d_die() { printf '\033[1;31m[d-qa] ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Baza nomlari prefiksi — bir mashinada parallel yugurishlar (boshqa worktree / agent) bir-birining bazasini
# o'chirib yubormasin: D_DB_PREFIX=insof_test_x_ → insof_test_x_ctl, insof_test_x_t_<slug>, insof_test_x_restore_*,
# insof_test_x_ctl_agent … (standart insof_test_ — eski nomlar). run-all.sh d to'plamiga "${QA_DB_PREFIX}d_" beradi.
D_DB_PREFIX="${D_DB_PREFIX:-insof_test_}"
[[ "$D_DB_PREFIX" =~ ^insof_test_([a-z0-9]+_)*$ ]] || d_die "D_DB_PREFIX insof_test_…_ shaklida bo'lsin: $D_DB_PREFIX"
case "$D_DB_PREFIX" in insof_test_golden*) d_die "D_DB_PREFIX golden bazani qamrab oladi" ;; esac
export D_DB_PREFIX
D_CTL_DB="${D_DB_PREFIX}ctl"
# Korxona bazalari (provision.ts test rejimida shu prefiksni oladi — control.env da ham yoziladi)
export TEST_TENANT_DB_PREFIX="${D_DB_PREFIX}t_"
D_RESTORE_PREFIX="${D_DB_PREFIX}restore"
D_CTL_PORT="${D_CTL_PORT:-3204}"
D_FIRST_PORT="${D_FIRST_PORT:-3205}"
export D_CTL_PORT D_FIRST_PORT
D_NODE_MODULES="${D_NODE_MODULES:-$D_REPO/node_modules}"

# Faqat shu nomlarga tegamiz (tozalash ham shu ro'yxat bo'yicha)
d_test_dbs() {
  psql "$D_PG/postgres" -Atc "SELECT datname FROM pg_database WHERE datname = '$D_CTL_DB' OR starts_with(datname, '${TEST_TENANT_DB_PREFIX}') OR starts_with(datname, '${D_RESTORE_PREFIX}_') ORDER BY 1"
}

# Xavfsizlik: D_ROOT tizim papkasi bo'lmasin
case "$D_ROOT" in
  /|/var|/var/www*|/var/lib*|/var/backups*|/etc|/etc/*|/usr|/usr/*|"$HOME"|/Users) d_die "D_ROOT xavfli: $D_ROOT" ;;
esac
