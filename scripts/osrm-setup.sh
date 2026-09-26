#!/usr/bin/env bash
#
# O'z OSRM serverimizni ko'tarish — marshrut va masofa uchun.
#
#   bash scripts/osrm-setup.sh
#
# Nega kerak: `OSRM_URL` sozlanmagan bo'lsa kod jamoat demo serveriga murojaat qiladi
# (router.project-osrm.org). U ishlab chiqish uchun mo'ljallangan: sekin, limitli va
# ko'p serverlardan umuman ochilmaydi. Natijada masofa "yo'l bo'yicha" emas, to'g'ri
# chiziq bo'yicha hisoblanadi — haydovchining ekranida "taxminan" deb turadi va
# yetib borish vaqti xato chiqadi.
#
# Bu skript O'zbekiston xaritasini yuklab, tayyorlab, 127.0.0.1:5000 da xizmat ko'taradi.
# Tashqariga ochilmaydi — faqat shu serverdagi ilova foydalanadi.
set -euo pipefail

DIR="${OSRM_DIR:-/var/lib/osrm}"
PBF_URL="${OSRM_PBF_URL:-https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf}"
NAME="uzbekistan-latest"
IMAGE="osrm/osrm-backend:latest"
PORT="${OSRM_PORT:-5000}"

say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

command -v docker >/dev/null || { echo "Docker topilmadi. Avval Docker o'rnating."; exit 1; }

# ── Xotira tekshiruvi ──────────────────────────────────────────────────────────
# Tayyorlash bosqichi xarita hajmidan bir necha barobar ko'p RAM talab qiladi.
# 3.8 GB li serverda O'zbekiston sig'adi, lekin zaxira (swap) bo'lgani ma'qul.
free_mb=$(free -m | awk '/^Mem:/{print $2}')
swap_mb=$(free -m | awk '/^Swap:/{print $2}')
say "Xotira: ${free_mb} MB RAM, ${swap_mb} MB swap"
if [ "$free_mb" -lt 3000 ] && [ "$swap_mb" -lt 2000 ]; then
  echo "  Ogohlantirish: xotira kam. Tayyorlash to'xtab qolsa, 4 GB swap qo'shing:"
  echo "    sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
fi

sudo mkdir -p "$DIR"
sudo chown "$(id -u):$(id -g)" "$DIR"

# ── 1. Xarita ──────────────────────────────────────────────────────────────────
if [ ! -f "$DIR/$NAME.osm.pbf" ]; then
  say "1/4 · Xarita yuklanmoqda (~200 MB)"
  curl -L --fail -o "$DIR/$NAME.osm.pbf" "$PBF_URL"
else
  say "1/4 · Xarita allaqachon bor — o'tkazib yuborildi"
fi

# ── 2-4. Tayyorlash (MLD) ──────────────────────────────────────────────────────
# `osrm-extract` yo'l tarmog'ini ajratadi, `partition` va `customize` esa tez qidirish
# uchun indeks quradi. Uchalasi birga 10-30 daqiqa oladi va bir marta bajariladi.
if [ ! -f "$DIR/$NAME.osrm.mldgr" ]; then
  say "2/4 · osrm-extract (eng uzun bosqich)"
  docker run --rm -t -v "$DIR:/data" "$IMAGE" osrm-extract -p /opt/car.lua "/data/$NAME.osm.pbf"
  say "3/4 · osrm-partition"
  docker run --rm -t -v "$DIR:/data" "$IMAGE" osrm-partition "/data/$NAME.osrm"
  say "4/4 · osrm-customize"
  docker run --rm -t -v "$DIR:/data" "$IMAGE" osrm-customize "/data/$NAME.osrm"
else
  say "2-4/4 · Indeks allaqachon tayyor — o'tkazib yuborildi"
fi

# ── Xizmat ─────────────────────────────────────────────────────────────────────
# Faqat 127.0.0.1 ga bog'lanadi: internetdan ochiq qolmasin.
say "Xizmat ishga tushirilmoqda"
docker rm -f insof-osrm >/dev/null 2>&1 || true
docker run -d --name insof-osrm --restart unless-stopped \
  -p "127.0.0.1:$PORT:5000" -v "$DIR:/data" "$IMAGE" \
  osrm-routed --algorithm mld "/data/$NAME.osrm" >/dev/null

sleep 3
say "Tekshiruv — zavoddan Chilonzorgacha"
if curl -sf -m 10 "http://127.0.0.1:$PORT/route/v1/driving/69.049319,41.089974;69.2039,41.2755?overview=false" \
   | python3 -c "import json,sys; r=json.load(sys.stdin)['routes'][0]; print(f\"  {r['distance']/1000:.1f} km · {r['duration']/60:.0f} daqiqa\")"; then
  # `.env` ga O'ZIMIZ yozamiz. Ilgari bu yerda faqat ko'rsatma chiqardi va o'sha qadam
  # tushib qolgandi: OSRM ko'tarilgan, lekin ERP undan bexabar — masofa hamon jamoat
  # serveridan (ishonchsiz) olinardi va buni faqat ekrandagi "taxminan" yozuvidan bilish mumkin edi.
  ERP_DIR="${ERP_DIR:-/var/www/insof-erp}"
  URL="http://127.0.0.1:$PORT"
  if [ -f "$ERP_DIR/.env" ]; then
    if grep -q "^OSRM_URL=" "$ERP_DIR/.env"; then
      sed -i "s|^OSRM_URL=.*|OSRM_URL=$URL|" "$ERP_DIR/.env"
      say "ERP sozlamasi yangilandi: OSRM_URL=$URL"
    else
      printf '\nOSRM_URL=%s\n' "$URL" >> "$ERP_DIR/.env"
      say "ERP sozlamasiga qo'shildi: OSRM_URL=$URL"
    fi
    echo "  Qoldi: sudo systemctl restart insof-erp"
  else
    say "$ERP_DIR/.env topilmadi — qo'lda qo'shing:"
    echo "  echo \"OSRM_URL=$URL\" >> <erp>/.env && sudo systemctl restart insof-erp"
  fi
else
  echo "  Xizmat javob bermadi. Jurnal: docker logs insof-osrm --tail 40"
  exit 1
fi
