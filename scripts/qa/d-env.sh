# shellcheck shell=bash disable=SC2034
# QA (agent D) — ko'p korxonali platformani LOKAL sinash muhiti. Boshqa d-*.sh skriptlar `source` qiladi.
#
# Hammasi bitta vaqtinchalik papkada (D_ROOT) — serverdagi /var/www/insof-erp, /var/lib/insof, /var/backups/insof o'rnida:
#   $D_ROOT/app/            APP_DIR: control.env, build.env, tenants/*.env, releases/, current → releases/<sha>
#   $D_ROOT/data/<slug>/    TENANT_DATA_ROOT (korxona fayllari)
#   $D_ROOT/backups/        server-backup.sh OUT_DIR;  $D_ROOT/offsite/ — OFFSITE=local nishoni
#   $D_ROOT/run/            jarayonlar pid va loglari, health-watch holati
# Bazalar faqat lokal va `insof_test_` prefiksli: insof_test_ctl, insof_test_t_<slug>, insof_test_restore_*.
# Portlar: panel 3204, korxonalar 3205+ (TENANT_FIRST_PORT).

D_REPO="${D_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
D_ROOT="${D_ROOT:-${TMPDIR:-/tmp}/insof-qa-d}"
export D_ROOT
D_APP="$D_ROOT/app"
D_DATA="$D_ROOT/data"
D_RUN="$D_ROOT/run"
D_PGUSER="${D_PGUSER:-$(id -un)}"
D_PG="postgresql://$D_PGUSER@127.0.0.1:5432"
D_CTL_DB=insof_test_ctl
D_CTL_PORT=3204
D_FIRST_PORT=3205
D_NODE_MODULES="${D_NODE_MODULES:-$D_REPO/node_modules}"

# Faqat shu nomlarga tegamiz (tozalash ham shu ro'yxat bo'yicha)
d_test_dbs() {
  psql "$D_PG/postgres" -Atc "SELECT datname FROM pg_database WHERE datname = '$D_CTL_DB' OR datname LIKE 'insof\\_test\\_t\\_%' OR datname LIKE 'insof\\_test\\_restore\\_%' ORDER BY 1"
}

d_log() { printf '\033[1;36m[d-qa]\033[0m %s\n' "$*"; }
d_die() { printf '\033[1;31m[d-qa] ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Xavfsizlik: D_ROOT tizim papkasi bo'lmasin
case "$D_ROOT" in
  /|/var|/var/www*|/var/lib*|/var/backups*|/etc|/etc/*|/usr|/usr/*|"$HOME"|/Users) d_die "D_ROOT xavfli: $D_ROOT" ;;
esac
