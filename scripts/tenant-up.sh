#!/usr/bin/env bash
# Panelda yaratilgan korxonani serverda ishga tushirish (bir marta):
#   sudo bash scripts/tenant-up.sh <slug> [domen]
# Nima qiladi: .env (bo'lmasa yaratadi) → fayl papkasi → systemd insof-erp@<slug> → tekshiruv → nginx + SSL.
# Qayta ishga tushirilsa zarari yo'q (idempotent): mavjud .env va sertifikat saqlanadi.
set -euo pipefail

SLUG=${1:?Ishlatish: sudo bash scripts/tenant-up.sh <slug> [domen]}
DOMAIN=${2:-}
APP=${APP_DIR:-/var/www/insof-erp}
RUN_AS=${RUN_AS:-deploy}
ENVF="$APP/tenants/$SLUG.env"
step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }

[ "$(id -u)" = "0" ] || { echo "sudo bilan ishga tushiring" >&2; exit 1; }
[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,29}$ ]] || { echo "slug noto'g'ri: $SLUG" >&2; exit 1; }

step ".env"
if [ ! -f "$ENVF" ]; then
  sudo -u "$RUN_AS" bash -c "cd '$APP' && npm run -s tenant -- env '$SLUG'"
fi
chown "$RUN_AS:$RUN_AS" "$ENVF"; chmod 600 "$ENVF"
PORT=$(grep -E '^PORT=' "$ENVF" | cut -d= -f2)
UPLOADS=$(grep -E '^UPLOADS_DIR=' "$ENVF" | cut -d= -f2-)
[ -n "$PORT" ] || { echo "$ENVF da PORT yo'q" >&2; exit 1; }
grep -qE '^CONTROL_SECRET=.{32,}' "$ENVF" || echo "⚠ CONTROL_SECRET bo'sh — IT kirishi (SSO) ishlamaydi"

step "Fayllar papkasi: $UPLOADS"
mkdir -p "$UPLOADS"
chown -R "$RUN_AS:$RUN_AS" "$(dirname "$UPLOADS")"

step "systemd: insof-erp@$SLUG (port $PORT)"
install -m 644 "$APP/docs/deploy/insof-erp@.service" /etc/systemd/system/insof-erp@.service
systemctl daemon-reload
systemctl enable --now "insof-erp@$SLUG"
systemctl restart "insof-erp@$SLUG"
for i in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" && { echo "✓ javob berdi (127.0.0.1:$PORT)"; break; }
  sleep 1
  [ "$i" = 30 ] && { echo "✗ 30 s ichida javob yo'q: journalctl -u insof-erp@$SLUG -n 80" >&2; exit 1; }
done

if [ -n "$DOMAIN" ]; then
  step "nginx: $DOMAIN"
  CONF=/etc/nginx/sites-available/insof-$SLUG
  sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$APP/docs/deploy/nginx-tenant.conf" > "$CONF"
  ln -sf "$CONF" "/etc/nginx/sites-enabled/insof-$SLUG"
  nginx -t && systemctl reload nginx
  if command -v certbot >/dev/null; then
    step "SSL (Let's Encrypt)"
    certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos --keep-until-expiring \
      || echo "⚠ Sertifikat olinmadi — DNS $DOMAIN → shu server IP ekanini tekshiring va qayta ishga tushiring"
  fi
fi

echo -e "\n\033[1;32m✓ $SLUG tayyor.\033[0m Panelda «Tekshirish» bosilganda holat «Faol» bo'ladi."
