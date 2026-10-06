#!/usr/bin/env bash
# Root o'rami: IPv4 manzilni ufw bilan bloklash / blokdan chiqarish — sudoers'dagi `ufw insert 1 deny from *` wildcard o'rniga.
#   sudo -n /usr/local/sbin/insof-ufw deny <ipv4>      →  /usr/sbin/ufw insert 1 deny from <ipv4>
#   sudo -n /usr/local/sbin/insof-ufw undeny <ipv4>    →  /usr/sbin/ufw delete deny from <ipv4>
#
# O'RNATISH (har yangilanishda qayta; deploy.sh farqni ogohlantiradi) — docs/deploy/PLATFORMA.md → «Root o'ramlari»:
#   sudo install -o root -g root -m 755 scripts/insof-ufw.sh /usr/local/sbin/insof-ufw
#   # ixtiyoriy: hech qachon bloklanmaydigan admin IP'lari (har qatorda bitta IPv4, # izoh), root egaligida:
#   sudo install -d -o root -g root -m 755 /etc/insof && sudo install -o root -g root -m 644 /dev/null /etc/insof/ufw-allow
#
# Himoya (faqat deny): 0.*, 127.*, 255.255.255.255, serverning o'z IPv4 manzillari va /etc/insof/ufw-allow dagilar
# bloklanmaydi (o'zini/serverni qulflab qo'ymaslik). Faqat aniq IPv4 (CIDR, "any", nom — rad). PATH qat'iy, muhitdan
# sozlama olinmaydi; ruxsat ro'yxati root'niki bo'lmasa yoki boshqalar yoza olsa — to'xtaydi.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C

ALLOW=/etc/insof/ufw-allow
die() { echo "insof-ufw: $*" >&2; exit 2; }
[ "$#" -eq 2 ] || die "ishlatish: insof-ufw deny|undeny <ipv4>"
ACT="$1"; IP="$2"
case "$ACT" in deny|undeny) ;; *) die "amal noto'g'ri: $ACT (deny|undeny)" ;; esac
OCT='(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])'
[[ "$IP" =~ ^$OCT\.$OCT\.$OCT\.$OCT$ ]] || die "IPv4 manzil noto'g'ri: $IP"

if [ "$ACT" = "deny" ]; then
  case "$IP" in
    0.*|127.*|255.255.255.255) die "$IP — maxsus/lokal manzil, bloklanmaydi" ;;
  esac
  # Serverning o'z manzillari
  own=""
  if command -v ip >/dev/null 2>&1; then
    own="$(ip -4 -o addr show 2>/dev/null | awk '{print $4}' | cut -d/ -f1 || true)"
  elif hostname -I >/dev/null 2>&1; then
    own="$(hostname -I 2>/dev/null | tr ' ' '\n' || true)"
  fi
  if printf '%s\n' "$own" | grep -qxF -- "$IP"; then die "$IP — serverning o'z manzili, bloklanmaydi"; fi
  # Admin IP ro'yxati (ixtiyoriy) — faqat root egaligida, guruh/boshqalar yoza olmaydi
  if [ -e "$ALLOW" ]; then
    [ ! -L "$ALLOW" ] && [ -f "$ALLOW" ] || die "$ALLOW oddiy fayl emas"
    read -r owner mode < <(stat -c '%u %a' "$ALLOW")
    [ "$owner" = "0" ] && (( (8#$mode & 8#022) == 0 )) || die "$ALLOW egasi root emas yoki guruh/boshqalar yoza oladi (sudo chown root:root $ALLOW; sudo chmod 644 $ALLOW)"
    if sed -e 's/#.*//' -e 's/[[:space:]]//g' "$ALLOW" | grep -qxF -- "$IP"; then die "$IP — $ALLOW ro'yxatida (admin manzili), bloklanmaydi"; fi
  fi
fi

[ "$(id -u)" = "0" ] || { echo "insof-ufw: root kerak (sudo -n /usr/local/sbin/insof-ufw $ACT $IP)" >&2; exit 1; }
if [ "$ACT" = "deny" ]; then
  exec /usr/sbin/ufw insert 1 deny from "$IP"
else
  exec /usr/sbin/ufw delete deny from "$IP"
fi
