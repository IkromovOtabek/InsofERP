#!/usr/bin/env bash
# Panelda yaratilgan korxonani serverda ishga tushirish (root):
#   sudo insof-tenant-up <slug> [domen]             # root egaligidagi o'rnatilgan nusxa (IT panel ham shuni chaqiradi)
#   sudo bash scripts/tenant-up.sh <slug> [domen]   # qo'lda (admin), xuddi shu mantiq
#
# O'RNATISH (har yangilanishda qayta) — docs/deploy/PLATFORMA.md → «Infratuzilma»:
#   sudo install -o root -g root -m 755 scripts/tenant-up.sh /usr/local/sbin/insof-tenant-up
#   sudo install -d -o root -g root -m 755 /usr/local/share/insof
#   sudo install -o root -g root -m 644 docs/deploy/insof-erp@.service docs/deploy/nginx-tenant.conf docs/deploy/nginx-limits.conf /usr/local/share/insof/
#
# Xavfsizlik (deploy → root eskalatsiyasi yo'q):
#   - root bo'lib ishlaydigan bu fayl va u o'qiydigan shablonlar (systemd unit, nginx) faqat ROOT egaligida, guruh/boshqalar
#     yoza olmaydi — tekshiriladi, aks holda to'xtaydi. Repo (deploy yoza oladi) dan hech narsa root sifatida o'qilmaydi/bajarilmaydi.
#   - deploy egaligidagi joylar (tenants/<slug>.env, fayllar papkasi) bilan faqat deploy huquqida ishlanadi (runuser):
#     root ularga chown/chmod/mkdir qilmaydi (symlink orqali /etc/... ga yo'naltirish hujumi ishlamaydi).
#   - PORT faqat raqam, UPLOADS_DIR faqat /var/lib/insof/<slug>/uploads (yoki eski /var/www/insof-erp/uploads), slug/domen regex.
#   - Domen siyosati (ixtiyoriy, root egaligida): /etc/insof/tenant-up.conf — TENANT_BASE_DOMAIN=..., TENANT_DOMAINS=a.uz,b.uz
#   - PATH qat'iy, muhitdan sozlama olinmaydi (sudo env_reset ham shuni qiladi).
# Nima qiladi: .env (bo'lmasa — deploy huquqida yaratadi) → fayl papkasi → systemd insof-erp@<slug> → /api/health → nginx + SSL.
# Qayta ishga tushirilsa zarari yo'q (idempotent): mavjud .env, sertifikat va certbot sozlagan nginx sayti saqlanadi.
# Oxirgi qator — mashina o'qiydigan natija: RESULT systemd=<holat> health=<kod> nginx=<ok|skip|fail|kept> certbot=<ok|skip|fail|none>
set -euo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
export LC_ALL=C.UTF-8

SLUG=${1:?Ishlatish: sudo insof-tenant-up <slug> [domen]}
DOMAIN=${2:-}
[ "$#" -le 2 ] || { echo "ortiqcha argument: faqat <slug> [domen]" >&2; exit 2; }

# Joylar QAT'IY (muhitdan olinmaydi)
APP=/var/www/insof-erp
DATA_ROOT=/var/lib/insof
RUN_AS=deploy
TPL_DIR=/usr/local/share/insof
POLICY=/etc/insof/tenant-up.conf
ENVF="$APP/tenants/$SLUG.env"

R_SYSTEMD="?"; R_HEALTH="?"; R_NGINX="skip"; R_CERT="none"
result() { echo "RESULT systemd=$R_SYSTEMD health=$R_HEALTH nginx=$R_NGINX certbot=$R_CERT"; }
die() { echo "✗ $*" >&2; result; exit 1; }
step() { printf '\n▶ %s\n' "$*"; }
# setsid: deploy jarayoni root terminaliga ulanmaydi (TIOCSTI orqali buyruq kiritib bo'lmaydi), stdin bo'sh
as_user() { setsid -w runuser -u "$RUN_AS" -- env -i PATH="$PATH" HOME="/home/$RUN_AS" LANG=C.UTF-8 "$@" </dev/null; }

[ "$(id -u)" = "0" ] || { echo "sudo bilan ishga tushiring: sudo insof-tenant-up $SLUG ${DOMAIN}" >&2; exit 1; }
command -v systemctl >/dev/null || die "systemctl topilmadi — bu skript faqat systemd'li Linux serverda ishlaydi"
command -v runuser >/dev/null && command -v setsid >/dev/null || die "runuser/setsid topilmadi (util-linux)"
[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,29}$ ]] || die "slug noto'g'ri: $SLUG"
if [ -n "$DOMAIN" ]; then
  [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$ ]] && [ "${#DOMAIN}" -le 253 ] || die "domen noto'g'ri: $DOMAIN"
fi
id "$RUN_AS" >/dev/null 2>&1 || die "foydalanuvchi '$RUN_AS' yo'q"
[ -d "$APP/current" ] || die "$APP/current yo'q — avval bir marta: SKIP_RESTART=1 bash scripts/deploy.sh (deploy foydalanuvchisi)"

# Bir vaqtda bitta ishga tushirish
exec 8>/run/insof-tenant-up.lock
flock -n 8 || die "boshqa insof-tenant-up ishlayapti"

# ── Root egaligidagi fayl tekshiruvi: egasi root, guruh/boshqalar yoza olmaydi, symlink emas (ota papka ham) ──
root_only() { # root_only <yo'l>
  local f="$1" d uid mode
  [ -e "$f" ] && [ ! -L "$f" ] || die "$f yo'q yoki symlink — o'rnatish: PLATFORMA.md → «Infratuzilma»"
  for d in "$f" "$(dirname "$f")"; do
    read -r uid mode < <(stat -c '%u %a' "$d")
    [ "$uid" = "0" ] || die "$d egasi root emas — root egaligidagi nusxa kerak (sudo install -o root -g root ...)"
    (( (8#$mode & 8#022) == 0 )) || die "$d ni guruh/boshqalar yoza oladi ($mode) — chmod go-w"
  done
}
root_only "$TPL_DIR/insof-erp@.service"
root_only "$TPL_DIR/nginx-tenant.conf"
root_only "$TPL_DIR/nginx-limits.conf"
case "$0" in
  /usr/local/sbin/*) root_only "$0" ;;
esac

# ── Domen siyosati (root egaligidagi fayldan; `source` qilinmaydi) ──
if [ -n "$DOMAIN" ] && [ -e "$POLICY" ]; then
  root_only "$POLICY"
  base="$(grep -E '^TENANT_BASE_DOMAIN=' "$POLICY" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  list="$(grep -E '^TENANT_DOMAINS=' "$POLICY" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true)"
  allowed=0
  if [ -n "$base" ] && { [ "$DOMAIN" = "$base" ] || [[ "$DOMAIN" == *".$base" ]]; }; then allowed=1; fi
  IFS=',' read -r -a arr <<< "$list"
  for x in ${arr[@]+"${arr[@]}"}; do [ "$x" = "$DOMAIN" ] && allowed=1; done
  [ "$allowed" = 1 ] || die "domen $DOMAIN ruxsat etilmagan ($POLICY: TENANT_BASE_DOMAIN=$base, TENANT_DOMAINS=$list)"
fi

step ".env"
if ! as_user test -f "$ENVF"; then
  # Kod current/ relizda (scripts/deploy.sh); control.env repo ildizida. deploy huquqida, root EMAS.
  CODE="$APP/current"; [ -d "$CODE/node_modules" ] || CODE="$APP"
  # npm emas, to'g'ridan-to'g'ri tsx: agent ostida (ProtectHome=read-only) ~/.npm ga yozib bo'lmaydi
  ( cd "$CODE" && as_user CONTROL_ENV_FILE="$APP/control.env" node node_modules/tsx/dist/cli.mjs scripts/tenant.ts env "$SLUG" ) \
    || die ".env yaratilmadi (npm run tenant -- env $SLUG)"
fi
as_user test -f "$ENVF" || die "$ENVF yo'q"
as_user chmod 600 "$ENVF"
ENV_TEXT="$(as_user cat "$ENVF")"
env_val() { printf '%s\n' "$ENV_TEXT" | grep -E "^$1=" | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ' || true; }
PORT="$(env_val PORT)"
UPLOADS="$(env_val UPLOADS_DIR)"
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "$ENVF da PORT noto'g'ri: '$PORT'"
printf '%s\n' "$ENV_TEXT" | grep -qE '^CONTROL_SSO_KEY=.{32,}' || printf '%s\n' "$ENV_TEXT" | grep -qE '^CONTROL_SECRET=.{32,}' \
  || echo "⚠ CONTROL_SSO_KEY bo'sh — IT kirishi (SSO) ishlamaydi: npm run -s tenant -- sso-key $SLUG"
if printf '%s\n' "$ENV_TEXT" | grep -qE '^CONTROL_SECRET='; then
  echo "⚠ $ENVF da global CONTROL_SECRET bor — CONTROL_SSO_KEY ga almashtiring (PLATFORMA.md → «SSO kaliti»)"
fi
unset ENV_TEXT

step "Fayllar papkasi: $UPLOADS"
# Faqat ikki ruxsat etilgan shakl — boshqa yo'l (masalan /etc) bilan root hech narsa qilmaydi
if [ "$UPLOADS" = "$DATA_ROOT/$SLUG/uploads" ]; then
  if [ ! -e "$DATA_ROOT" ]; then install -d -o root -g root -m 755 "$DATA_ROOT"; fi
  [ -d "$DATA_ROOT" ] && [ ! -L "$DATA_ROOT" ] || die "$DATA_ROOT papka emas"
  read -r uid _ < <(stat -c '%u %a' "$DATA_ROOT")
  [ "$uid" = "0" ] || die "$DATA_ROOT egasi root bo'lishi kerak (chown root:root, chmod 755)"
  # /var/lib/insof/<slug> — root papkasi ichida, faqat root yarata oladi; bo'lmasa yaratib deploy'ga beriladi
  if [ ! -e "$DATA_ROOT/$SLUG" ]; then install -d -o "$RUN_AS" -g "$RUN_AS" -m 750 "$DATA_ROOT/$SLUG"; fi
  [ -d "$DATA_ROOT/$SLUG" ] && [ ! -L "$DATA_ROOT/$SLUG" ] || die "$DATA_ROOT/$SLUG papka emas"
elif [ "$UPLOADS" != "$APP/uploads" ]; then
  die "UPLOADS_DIR ruxsat etilmagan: '$UPLOADS' (faqat $DATA_ROOT/$SLUG/uploads yoki $APP/uploads)"
fi
as_user mkdir -p "$UPLOADS" || die "$UPLOADS yaratilmadi (deploy huquqi)"
as_user chmod 750 "$UPLOADS" || echo "⚠ $UPLOADS: chmod 750 bo'lmadi (egasi deploy emas?)"

step "systemd: insof-erp@$SLUG (port $PORT)"
if command -v ss >/dev/null && ss -Hltn "sport = :$PORT" | grep -q . && ! systemctl is-active --quiet "insof-erp@$SLUG"; then
  die "port $PORT band (boshqa jarayon): ss -ltnp 'sport = :$PORT' — tenants/$SLUG.env dagi PORT ni tekshiring"
fi
install -o root -g root -m 644 "$TPL_DIR/insof-erp@.service" /etc/systemd/system/insof-erp@.service
systemctl daemon-reload
systemctl enable "insof-erp@$SLUG"
systemctl restart "insof-erp@$SLUG"
R_HEALTH="none"
for i in $(seq 1 45); do
  code="$(curl -sS -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then R_HEALTH=200; echo "✓ javob berdi (127.0.0.1:$PORT/api/health)"; break; fi
  [ -n "$code" ] && [ "$code" != "000" ] && R_HEALTH="$code"
  sleep 1
done
R_SYSTEMD="$(systemctl is-active "insof-erp@$SLUG" 2>/dev/null || true)"
if [ "$R_HEALTH" != "200" ]; then
  journalctl -u "insof-erp@$SLUG" -n 30 --no-pager -o cat 2>/dev/null | sed -E 's/((SECRET|TOKEN|PASSWORD|KEY)[A-Z_]*=)[^ ]+/\1***/g' || true
  die "45 s ichida /api/health 200 bermadi (holat: $R_SYSTEMD, oxirgi kod: $R_HEALTH)"
fi

if [ -n "$DOMAIN" ]; then
  step "nginx: $DOMAIN"
  [ -f /etc/nginx/conf.d/insof-limits.conf ] || install -o root -g root -m 644 "$TPL_DIR/nginx-limits.conf" /etc/nginx/conf.d/insof-limits.conf
  CONF=/etc/nginx/sites-available/insof-$SLUG
  if [ -f "$CONF" ] && grep -q "server_name $DOMAIN;" "$CONF" && grep -q "127.0.0.1:$PORT;" "$CONF"; then
    # Mavjud sayt (certbot SSL qo'shgan bo'lishi mumkin) — qayta yozilmaydi
    R_NGINX="kept"; echo "sayt mavjud (domen va port mos) — o'zgartirilmadi"
  else
    [ -f "$CONF" ] && cp -p "$CONF" "$CONF.bak"
    sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$TPL_DIR/nginx-tenant.conf" > "$CONF.new"
    chmod 644 "$CONF.new"; mv -f "$CONF.new" "$CONF"
    R_NGINX="ok"
  fi
  ln -sfn "$CONF" "/etc/nginx/sites-enabled/insof-$SLUG"
  if ! nginx -t; then
    # Buzuq sozlama nginx'ni yiqitmasin: oldingi holatga qaytarish
    if [ -f "$CONF.bak" ]; then mv -f "$CONF.bak" "$CONF"; else rm -f "/etc/nginx/sites-enabled/insof-$SLUG" "$CONF"; fi
    R_NGINX="fail"; die "nginx -t xato — sayt qaytarildi"
  fi
  rm -f "$CONF.bak"
  systemctl reload nginx
  if command -v certbot >/dev/null; then
    step "SSL (Let's Encrypt)"
    if certbot --nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos --keep-until-expiring; then R_CERT="ok"
    else R_CERT="fail"; echo "⚠ Sertifikat olinmadi — DNS $DOMAIN → shu server IP ekanini tekshiring va qayta ishga tushiring"; fi
  else
    R_CERT="none"; echo "⚠ certbot o'rnatilmagan — HTTPS yo'q"
  fi
fi

echo -e "\n✓ $SLUG tayyor. Panelda «Tekshirish» bosilganda (yoki agent) holat «Faol» bo'ladi."
echo "Telegram bot bo'lsa: cd $APP/current && ENV_FILE=$ENVF npm run bot:webhook -- https://${DOMAIN:-<domen>}"
result
