#!/usr/bin/env bash
# Root o'rami: insof xizmatini qayta ishga tushirish — sudoers'dagi `systemctl restart insof-erp@*` wildcard o'rniga.
#   sudo -n /usr/local/sbin/insof-restart <unit>
# unit FAQAT: insof-erp@<slug> | insof-control | insof-eco | insof-agent  →  /usr/bin/systemctl restart -- <unit>
#
# O'RNATISH (har yangilanishda qayta; deploy.sh farqni ogohlantiradi) — docs/deploy/PLATFORMA.md → «Root o'ramlari»:
#   sudo install -o root -g root -m 755 scripts/insof-restart.sh /usr/local/sbin/insof-restart
# Repo'dagi bu fayl sudo bilan CHAQIRILMAYDI (deploy uni o'zgartira oladi) — faqat root egaligidagi nusxa.
# Argumentlar soni, qat'iy regex, `--` (unit nomi parametr sifatida o'qilmaydi), PATH qat'iy, muhitdan sozlama olinmaydi.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C

die() { echo "insof-restart: $*" >&2; exit 2; }
[ "$#" -eq 1 ] || die "ishlatish: insof-restart <insof-erp@slug|insof-control|insof-eco|insof-agent>"
UNIT="$1"
if ! [[ "$UNIT" =~ ^insof-erp@[a-z0-9][a-z0-9-]{1,29}$ || "$UNIT" =~ ^(insof-control|insof-eco|insof-agent)$ ]]; then
  die "ruxsat etilmagan unit: $UNIT"
fi
[ "$(id -u)" = "0" ] || { echo "insof-restart: root kerak (sudo -n /usr/local/sbin/insof-restart $UNIT)" >&2; exit 1; }
exec /usr/bin/systemctl restart -- "$UNIT"
