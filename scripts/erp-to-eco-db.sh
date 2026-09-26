#!/usr/bin/env bash
# Insof ERP ma'lumotlarini Insof ECO Postgres bazasiga (`insof`, 5438-port) `erp` sxemasi sifatida ko'chiradi.
# Natija: ikkala tizim bitta bazada — ECO jadvallari `public` sxemasida, ERP jadvallari `erp` sxemasida.
# Ishlatish:  bash scripts/erp-to-eco-db.sh          (tayyor scripts/erp-to-eco-db.sql dan yuklaydi)
#             bash scripts/erp-to-eco-db.sh --fresh  (avval manba bazadan yangi dump oladi)
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${ERP_SRC_URL:-postgresql://otabek@localhost:5432/insof_erp}"
DST="${ECO_DB_URL:-postgresql://insof:insof@localhost:5438/insof}"
DUMP="scripts/erp-to-eco-db.sql"

if [ "${1:-}" = "--fresh" ] || [ ! -f "$DUMP" ]; then
  echo "→ Yangi dump olinmoqda: $SRC"
  pg_dump "$SRC" -n public --no-owner --no-acl -f /tmp/erp-public.sql
  # DDL qatorlarida public → erp; COPY ichidagi ma'lumotlarga tegilmaydi
  python3 - /tmp/erp-public.sql "$DUMP" <<'PY'
import sys
src = open(sys.argv[1]).read().split("\n")
out = ["CREATE SCHEMA IF NOT EXISTS erp;"]
incopy = False
for line in src:
    if incopy:
        out.append(line)
        if line == "\\.":
            incopy = False
        continue
    if line.startswith("COPY ") and line.endswith("FROM stdin;"):
        incopy = True
    if "public." in line or "public;" in line:
        line = line.replace("public.", "erp.").replace(" public;", " erp;")
    if line.startswith("CREATE SCHEMA public") or line.startswith("COMMENT ON SCHEMA public"):
        continue
    out.append(line)
open(sys.argv[2], "w").write("\n".join(out))
PY
fi

if psql "$DST" -Atc "select 1 from pg_namespace where nspname='erp'" | grep -q 1; then
  echo "[XATO] ECO bazasida 'erp' sxemasi allaqachon bor — yuklash to'xtatildi (mavjud ma'lumot buzilmasin)."
  echo "  Qayta yuklash kerak bo'lsa avval erp sxemasini qo'lda o'chiring, keyin skriptni qayta ishga tushiring."
  exit 1
fi

echo "→ ECO bazasiga yuklanmoqda: $DST (sxema: erp)"
psql "$DST" -v ON_ERROR_STOP=1 -q -f "$DUMP"
psql "$DST" -Atc "select 'erp jadvallar: '||count(*) from information_schema.tables where table_schema='erp'
union all select 'zayavkalar: '||count(*) from erp.\"Order\"
union all select 'foydalanuvchilar: '||count(*) from erp.\"User\"
union all select 'migratsiyalar: '||count(*) from erp._prisma_migrations"

NEW_URL="${DST}?schema=erp"
if grep -q '^DATABASE_URL=' .env; then
  sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"$NEW_URL\"|" .env && rm -f .env.bak
else
  echo "DATABASE_URL=\"$NEW_URL\"" >> .env
fi
echo "→ .env yangilandi: DATABASE_URL=$NEW_URL"

npx prisma generate >/dev/null
npx prisma migrate status
echo "[OK] Tayyor. Dev-serverni qayta ishga tushiring:  npm run dev"
