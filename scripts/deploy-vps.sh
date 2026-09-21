#!/usr/bin/env bash
# Insof ERP — yangi Ubuntu VPS ga bitta buyruq bilan o'rnatish (root bilan ishga tushiriladi).
#
# Serverda:
#   bash deploy-vps.sh erp.domen.uz siz@pochta.uz
# yoki lokal kompyuterdan bittada:
#   ssh root@<VPS-IP> 'bash -s' < scripts/deploy-vps.sh erp.domen.uz siz@pochta.uz
#
# Domen bermasangiz IP bo'yicha 80-portda ishlaydi (SSL o'rnatilmaydi).
# Sozlamalar (kerak bo'lsa oldiga yozing): REPO=... APP_DIR=... PORT=... SEED=1 bash deploy-vps.sh ...
set -euo pipefail

DOMAIN="${1:-}"                 # erp.domen.uz — bo'sh bo'lsa faqat IP
EMAIL="${2:-}"                  # Let's Encrypt uchun pochta (domen bilan birga berilsa SSL o'rnatiladi)
REPO="${REPO:-https://github.com/IkromovOtabek/InsofERP.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/var/www/insof-erp}"
APP_USER="${APP_USER:-insof}"
PORT="${PORT:-3000}"
DB_NAME="${DB_NAME:-insof_erp}"
DB_USER="${DB_USER:-insof}"
SEED="${SEED:-ask}"             # 1 — namuna ma'lumot bilan to'ldirish, 0 — yo'q, ask — baza bo'sh bo'lsa so'raydi
NODE_MAJOR="${NODE_MAJOR:-22}"

[ "$(id -u)" -eq 0 ] || { echo "✗ root bilan ishga tushiring: sudo bash $0 ..." >&2; exit 1; }
step() { echo; echo "── $* ──"; }

step "1/10 Tizim paketlari"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates gnupg build-essential postgresql postgresql-contrib nginx ufw openssl

step "2/10 Node.js $NODE_MAJOR"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
echo "node $(node -v) · npm $(npm -v)"

step "3/10 PostgreSQL bazasi"
systemctl enable --now postgresql
DB_PASS="$(openssl rand -hex 16)"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  echo "· '$DB_USER' roli bor — paroli o'zgartirilmaydi (mavjud .env dagi parol ishlaydi)"
  DB_EXISTS=1
else
  sudo -u postgres psql -qc "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';"
  DB_EXISTS=0
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
sudo -u postgres psql -qd "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER;"

step "4/10 Ilova foydalanuvchisi va kod"
export GIT_TERMINAL_PROMPT=0   # yopiq repo bo'lsa parol so'rab osilib qolmasin
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR" || {
    echo "✗ Klon qilinmadi. Repo yopiq bo'lsa deploy-token bilan bering:" >&2
    echo "  REPO=https://<token>@github.com/IkromovOtabek/InsofERP.git bash \$0 $*" >&2
    exit 1
  }
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR/uploads"   # shartnoma fayllari — git'ga kirmaydi, saqlanib qoladi

step "5/10 .env"
if [ -f "$APP_DIR/.env" ]; then
  echo "· .env bor — tegilmadi (kalitlarni qo'lda qo'shasiz)"
else
  [ "$DB_EXISTS" -eq 1 ] && { echo "✗ '$DB_USER' roli bor, lekin .env yo'q — .env ni qo'lda yozing (DATABASE_URL paroli bilan)" >&2; exit 1; }
  umask 077
  cat > "$APP_DIR/.env" <<ENV
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public"
AUTH_SECRET="$(openssl rand -hex 32)"
$( [ -n "$DOMAIN" ] && echo "APP_URL=\"https://$DOMAIN\"" )

# AI (ixtiyoriy) — kalit qo'ysangiz nakladnoy skaneri va Insof AI yoqiladi
ANTHROPIC_API_KEY=""
GROQ_API_KEY=""
OPENAI_API_KEY=""
MOHIR_API_KEY=""

# Telegram bot (ixtiyoriy)
TELEGRAM_BOT_TOKEN=""
TELEGRAM_WEBHOOK_SECRET=""

# Insof ECO integratsiyasi (ixtiyoriy)
ECO_API_URL=""
ECO_API_KEY=""
ECO_WEBHOOK_SECRET=""
ENV
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  echo "· .env yaratildi (DATABASE_URL + AUTH_SECRET o'zi qo'yildi)"
fi

step "6/10 npm ci · prisma migrate · build"
# 2 GB dan kam RAM da `next build` xotiradan yiqiladi — 2 GB swap qo'shamiz
RAM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$RAM_MB" -lt 2048 ] && [ ! -f /swapfile ]; then
  echo "· RAM ${RAM_MB} MB — 2 GB swap qo'shilmoqda"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm ci && npx prisma migrate deploy && npm run build"

step "7/10 Boshlang'ich ma'lumot"
USERS="$(sudo -u postgres psql -d "$DB_NAME" -tAc 'SELECT count(*) FROM "User"' 2>/dev/null | tr -d ' ' || true)"
if [ "${USERS:-0}" = "0" ]; then
  DO_SEED=0
  case "$SEED" in
    1) DO_SEED=1 ;;
    ask) read -rp "Baza bo'sh. Namuna ma'lumot (admin/admin123 va sinov zayavkalari) yozilsinmi? [y/N] " a; [[ "$a" =~ ^[Yy]$ ]] && DO_SEED=1 ;;
  esac
  [ "$DO_SEED" -eq 1 ] && sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm run db:seed" && echo "· admin / admin123 — BIRINCHI KIRISHDAN KEYIN PAROLNI ALMASHTIRING"
else
  echo "· bazada $USERS ta foydalanuvchi bor — seed o'tkazib yuborildi"
fi

step "8/10 systemd xizmati"
cat > /etc/systemd/system/insof-erp.service <<UNIT
[Unit]
Description=Insof ERP (Next.js)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
# Xavfsizlik: ilova faqat o'z papkasiga yoza oladi
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now insof-erp
sleep 3
systemctl is-active --quiet insof-erp && echo "· xizmat ishlayapti" || { journalctl -u insof-erp -n 30 --no-pager; exit 1; }

step "9/10 Nginx"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/insof-erp <<NGINX
server {
    listen 80;
    server_name $SERVER_NAME;

    client_max_body_size 20m;   # imzolangan shartnoma fayli 15 MB gacha
    client_body_timeout 120s;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/insof-erp /etc/nginx/sites-enabled/insof-erp
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  apt-get install -y -qq certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || echo "⚠ SSL o'rnatilmadi — domen A-yozuvi shu serverga qaraganini tekshiring, keyin: certbot --nginx -d $DOMAIN"
elif [ -n "$DOMAIN" ]; then
  echo "· SSL o'tkazib yuborildi (pochta berilmagan). Keyin: certbot --nginx -d $DOMAIN"
fi

step "10/10 Kunlik baza nusxasi"
install -m 755 "$APP_DIR/scripts/server-backup.sh" /usr/local/bin/erp-backup
( crontab -l 2>/dev/null | grep -v erp-backup; echo "0 3 * * * APP_DIR=$APP_DIR /usr/local/bin/erp-backup >> /var/log/erp-backup.log 2>&1" ) | crontab -

echo
echo "════════════════════════════════════════════"
if [ -n "$DOMAIN" ]; then URL="https://$DOMAIN"; else URL="http://$(hostname -I | awk '{print $1}')"; fi
echo "✓ Tayyor: $URL"
echo "  Loglar:      journalctl -u insof-erp -f"
echo "  Qayta yuklash: systemctl restart insof-erp"
echo "  Yangilash:   bash $APP_DIR/scripts/update.sh"
echo "  .env:        $APP_DIR/.env  (AI/Telegram kalitlarini shu yerga qo'shing)"
echo "════════════════════════════════════════════"
