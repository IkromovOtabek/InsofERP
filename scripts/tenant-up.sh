#!/usr/bin/env bash
# Panelda yaratilgan korxonani serverda ishga tushirish (bir marta):
#   sudo bash scripts/tenant-up.sh <slug> [domen]
# Talab: avval kamida bir marta `bash scripts/deploy.sh` ishlagan bo'lsin (current/ reliz).
# Nima qiladi: .env (bo'lmasa yaratadi) → fayl papkasi → systemd insof-erp@<slug> → /api/health → nginx + SSL.
# Qayta ishga tushirilsa zarari yo'q (idempotent): mavjud .env va sertifikat saqlanadi.
set -euo pipefail

SLUG=${1:?Ishlatish: sudo bash scripts/tenant-up.sh <slug> [domen]}
DOMAIN=${2:-}
APP=${APP_DIR:-/var/www/insof-erp}
DATA_ROOT=${TENANT_DATA_ROOT:-/var/lib/insof}
RUN_AS=${RUN_AS:-deploy}
ENVF="$APP/tenants/$SLUG.env"
step() { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }

[ "$(id -u)" = "0" ] || { echo "sudo bilan ishga tushiring" >&2; exit 1; }
[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,29}$ ]] || { echo "slug noto'g'ri: $SLUG" >&2; exit 1; }
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; then echo "domen noto'g'ri: $DOMAIN" >&2; exit 1; fi

step ".env"
if [ ! -f "$ENVF" ]; then
  # Kod current/ relizda (scripts/deploy.sh); control.env repo ildizida
  CODE="$APP/current"; [ -d "$CODE/node_modules" ] || CODE="$APP"
  sudo -u "$RUN_AS" env CONTROL_ENV_FILE="$APP/control.env" bash -c "cd '$CODE' && npm run -s tenant -- env '$SLUG'"
fi
chown "$RUN_AS:$RUN_AS" "$ENVF"; chmod 600 "$ENVF"
PORT=$(grep -E '^PORT=' "$ENVF" | tail -n1 | cut -d= -f2 | tr -d '"'"'"' ')
UPLOADS=$(grep -E '^UPLOADS_DIR=' "$ENVF" | tail -n1 | cut -d= -f2- | tr -d '"'"'"'')
[ -n "$PORT" ] || { echo "$ENVF da PORT yo'q" >&2; exit 1; }
[ -n "$UPLOADS" ] || { echo "$ENVF da UPLOADS_DIR yo'q" >&2; exit 1; }
grep -qE '^CONTROL_SSO_KEY=.{32,}' "$ENVF" || grep -qE '^CONTROL_SECRET=.{32,}' "$ENVF" \
  || echo "⚠ CONTROL_SSO_KEY bo'sh — IT kirishi (SSO) ishlamaydi: npm run -s tenant -- sso-key $SLUG"
if grep -qE '^CONTROL_SECRET=' "$ENVF"; then
  echo "⚠ $ENVF da global CONTROL_SECRET bor — CONTROL_SSO_KEY ga almashtiring (PLATFORMA.md → «SSO kaliti»)"
fi

step "Fayllar papkasi: $UPLOADS"
case "$UPLOADS" in
  /*) ;;
  *) echo "UPLOADS_DIR mutlaq yo'l bo'lishi kerak: $UPLOADS" >&2; exit 1 ;;
esac
UPLOADS="$(realpath -m "$UPLOADS")"
if [ "$UPLOADS" = "/" ] || [ "$UPLOADS" = "$APP" ] || [ "$UPLOADS" = "$DATA_ROOT" ]; then
  echo "UPLOADS_DIR xavfli: $UPLOADS" >&2; exit 1
fi
install -d -m 755 "$DATA_ROOT"
mkdir -p "$UPLOADS"
# Faqat fayllar papkasining o'zi (rekursiv). Ota papka (masalan /var/www/insof-erp) egaligi O'ZGARMAYDI.
chown -R "$RUN_AS:$RUN_AS" "$UPLOADS"
chmod 750 "$UPLOADS"
# Yangi korxona: /var/lib/insof/<slug> — shu bitta papka (rekursivsiz) ham deploy'niki
SLUG_DIR="$(dirname "$UPLOADS")"
if [ "$SLUG_DIR" = "$(realpath -m "$DATA_ROOT")/$SLUG" ]; then
  chown "$RUN_AS:$RUN_AS" "$SLUG_DIR"; chmod 750 "$SLUG_DIR"
fi

step "systemd: insof-erp@$SLUG (port $PORT)"
install -m 644 "$APP/docs/deploy/insof-erp@.service" /etc/systemd/system/insof-erp@.service
systemctl daemon-reload
systemctl enable --now "insof-erp@$SLUG"
systemctl restart "insof-erp@$SLUG"
for i in $(seq 1 30); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/health" && { echo "✓ javob berdi (127.0.0.1:$PORT/api/health)"; break; }
  sleep 1
  [ "$i" = 30 ] && { echo "✗ 30 s ichida javob yo'q: journalctl -u insof-erp@$SLUG -n 80" >&2; exit 1; }
done

if [ -n "$DOMAIN" ]; then
  step "nginx: $DOMAIN"
  # limit_req zonalari (http darajasi) — bir marta
  [ -f /etc/nginx/conf.d/insof-limits.conf ] || install -m 644 "$APP/docs/deploy/nginx-limits.conf" /etc/nginx/conf.d/insof-limits.conf
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
echo "Telegram bot bo'lsa: cd $APP/current && ENV_FILE=$ENVF npm run bot:webhook -- https://${DOMAIN:-<domen>}"
