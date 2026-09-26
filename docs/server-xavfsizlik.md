# Insof ERP — server va loyiha xavfsizligi (runbook)

Sana: 2026-09-25. Server: `189.74.98.242` (Ubuntu 22, `deploy` foydalanuvchisi).
ERP `/var/www/insof-erp` :3000, ECO `/var/www/insof-eco` :3010, Postgres/Redis/MinIO Docker'da.

Bu fayl uch qismdan iborat: **(1)** bugungi audit natijasi, **(2)** serverni tekshirish buyruqlari,
**(3)** himoyalash qadamlari va oylik tartib. Buyruqlar `deploy` ostida `sudo` bilan ishlaydi.

---

## 1. Audit natijasi (2026-09-25)

### 1.1 Tashqaridan ko'rinish (Mac'dan tekshirildi)

| Port | Holat | Baho |
|---|---|---|
| 22 (SSH) | ochiq | normal, lekin faqat kalit bilan bo'lishi kerak |
| 80 → 443 | 301 yo'naltiradi | to'g'ri |
| 443 (nginx) | HSTS, CSP, nosniff, frame, referrer, permissions sarlavhalari bor | to'g'ri |
| **3000 (ERP next)** | **internetdan ochiq, oddiy HTTP** | **KRITIK** |
| **3010 (ECO API)** | **internetdan ochiq, oddiy HTTP** | **KRITIK** |
| 5432 / 5438 / 6382 / 9010 | yopiq | to'g'ri |

Nima uchun 3000/3010 kritik:
- `http://189.74.98.242:3000` orqali ERP shifrlanmagan kanalda ochiladi. Mobil ilova tokeni (Bearer)
  shu yo'l bilan yuborilsa, Wi-Fi'da o'qib olinadi.
- nginx'dagi barcha himoya (TLS, tezlik cheklovi, `client_max_body_size`) chetlab o'tiladi.
- `X-Forwarded-For` sarlavhasini hujumchi o'zi yozadi, login qulfi (IP bo'yicha 30 xato) ishlamaydi.
- Sabab: `next start` `0.0.0.0` ga bog'lanadi va `ufw` yoqilmagan (yoki 3000 ochiq qoldirilgan).

Yana: `Server: nginx/1.18.0 (Ubuntu)` — versiya oshkor (past, `server_tokens off`).

### 1.2 Loyiha kodi — nima yaxshi (o'zgartirish kerak emas)

- `AUTH_SECRET` prodda majburiy (32+ belgi), JWT faqat HS256, `sessionVersion` bilan sessiya kuydirish.
- Cookie `httpOnly` + `secure` + `sameSite=lax`; bcrypt cost 10; parol siyosati; standart parollar taqiqlangan.
- Login qulfi: hisob bo'yicha 5 xato → 15 daq, IP bo'yicha 30; xato javob 500 ms kechiktiriladi.
- Barcha 27 ta server action fayli `getSession`/rol tekshiruvi qiladi; API marshrutlar ham (AI, skaner, geo, APK).
- Webhook'lar: Telegram maxfiy token, ECO HMAC-SHA256 + `timingSafeEqual` + 5 daqiqalik vaqt oynasi.
- Yuklangan fayllar `public/` da emas, nom regex bilan tekshiriladi (yo'l bo'ylab yurish yopiq), MIME va hajm cheklangan.
- AI javobi ekranga chiqishdan oldin escape qilinadi (XSS yopiq); `$queryRawUnsafe`, `eval`, `child_process` yo'q.
- Parol tiklash: kod xesh holida, 5 daqiqa, 5 urinish, soatiga 3 ta, raqam bor/yo'qligi oshkor bo'lmaydi.
- Sayt lead formasi: honeypot + 2 daqiqalik throttle. Audit jurnali bor. `.env` git'da yo'q.

### 1.3 Loyiha kodi — topilgan kamchiliklar

| # | Daraja | Topilma | Yechim |
|---|---|---|---|
| 1 | O'rta | `ipFromHeaders` `X-Forwarded-For` ning **birinchi** elementini oladi. nginx `$proxy_add_x_forwarded_for` bilan mijoz yuborgan qiymatni saqlab qoladi, demak IP qulfi soxta IP bilan aylanib o'tiladi. | nginx'da `X-Forwarded-For $remote_addr` (ustiga yozish) — pastda 3.4 da. Kod o'zgarmaydi. |
| 2 | Past | `/verify/<nakladnoy>` ochiq sahifa, raqamlar ketma-ket (`N-0001`). Sanab chiqib mijoz nomi + mashina raqamini yig'ish mumkin. | nginx tezlik cheklovi (3.4) hozircha yetadi; keyin QR'ga tasodifiy qo'shimcha kod. |
| 3 | Past | `/api/mobile/auth/refresh` da tezlik cheklovi yo'q (JWT imzosi tekshiriladi, brute-force amalda yo'q). | nginx `limit_req` (3.4). |
| 4 | Past | `npm audit`: next 15.5 ichidagi postcss (build vaqtida, foydalanuvchi ma'lumoti o'tmaydi). | Next 16 ga o'tishda yopiladi. |
| 5 | Past | Direktor hisobida 2FA yo'q. | Keyingi bosqich: TOTP yoki Telegram tasdiq. |
| 6 | Ma'lumot | Login qulfi xotirada — restart'da tozalanadi. Bitta jarayon uchun maqbul. | O'zgarish kerak emas. |

---

## 2. Serverni tekshirish (diagnostika)

Hammasini bir marta ishga tushirib, javoblarni saqlab qo'ying — bu "boshlang'ich holat".

```bash
ssh deploy@189.74.98.242
```

### 2.1 Kim, qachon kirgan — birinchi navbatda

```bash
# Muvaffaqiyatli kirishlar (oxirgi 20)
last -n 20

# Muvaffaqiyatsiz urinishlar soni va eng faol IP'lar
sudo lastb | wc -l
sudo lastb | awk '{print $3}' | sort | uniq -c | sort -rn | head

# SSH loglaridagi xatolar (oxirgi 24 soat)
sudo journalctl -u ssh --since "24 hours ago" | grep -ciE 'failed|invalid'
sudo journalctl -u ssh --since "24 hours ago" | grep -E 'Accepted' | tail
```

Agar `lastb` minglab bo'lsa — bu normal internet shovqini, lekin fail2ban (3.2) shart.
`Accepted password` qatori ko'rinsa — parol bilan kirish hali ochiq (3.2 da yopiladi).

### 2.2 Qaysi portlar tinglanmoqda

```bash
# 0.0.0.0 yoki [::] — internetga ochiq; 127.0.0.1 — faqat ichki
sudo ss -tlnp
```

Kutilgan natija: 22, 80, 443 → `0.0.0.0`; 3000, 3010, 5432, 5438, 6382, 9010 → **faqat `127.0.0.1`**.
Hozir 3000 va 3010 `0.0.0.0`/`*` da — 3.1 da tuzatiladi.

```bash
# Firewall holati
sudo ufw status verbose

# Docker portlari (hammasi 127.0.0.1: bilan boshlanishi kerak)
docker ps --format 'table {{.Names}}\t{{.Ports}}'
```

### 2.3 SSH sozlamasi

```bash
# Amaldagi (effektiv) qiymatlar — fayl emas, sshd o'zi nima deb tushunayotgani
sudo sshd -T | grep -iE '^(passwordauthentication|permitrootlogin|pubkeyauthentication|maxauthtries|x11forwarding)'
# Qo'shimcha konfiglar (cloud-init ko'pincha parolni qayta yoqib qo'yadi)
ls /etc/ssh/sshd_config.d/ && sudo cat /etc/ssh/sshd_config.d/*.conf
```

Maqsad: `passwordauthentication no`, `permitrootlogin no`, `pubkeyauthentication yes`.

### 2.4 Yangilanishlar va xizmatlar

```bash
# Kutilayotgan yangilanishlar (xavfsizlik bo'lganlari alohida ko'rinadi)
sudo apt update && apt list --upgradable 2>/dev/null | head -30
# Reboot kerakmi (kernel yangilangan bo'lsa)
[ -f /var/run/reboot-required ] && cat /var/run/reboot-required || echo "reboot kerak emas"

# Xizmatlar
systemctl status insof-erp insof-eco nginx --no-pager | grep -E 'Active|Main PID'
systemctl is-enabled insof-erp insof-eco nginx fail2ban unattended-upgrades 2>&1

# Port egasi bilan systemd MainPID mos kelishi (memory: PM2 ziddiyati)
sudo ss -tlnp | grep ':3000'
systemctl show insof-erp -p MainPID --value
```

### 2.5 Disk, xotira, loglar

```bash
df -h / && free -h
sudo du -sh /var/www/insof-erp/uploads /var/backups/insof-erp 2>/dev/null
sudo journalctl --disk-usage
# ERP'ning oxirgi xatolari
journalctl -u insof-erp --since "24 hours ago" -p err --no-pager | tail -30
```

### 2.6 Fayl huquqlari va sirlar

```bash
ls -la /var/www/insof-erp/.env /var/www/insof-eco/.env
# Kutilgan: -rw------- deploy deploy  (600)
stat -c '%U:%G %a %n' /var/www/insof-erp /var/www/insof-erp/uploads
# root egaligidagi node_modules bo'lsa — memory'dagi muammo qaytadi
find /var/www/insof-erp -maxdepth 1 ! -user deploy | head
```

### 2.7 TLS va sertifikat

```bash
sudo certbot certificates
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

### 2.8 Ilova darajasi

```bash
cd /var/www/insof-erp && npm run security:check
# Faol hisoblar va rollar
sudo -u postgres psql insof_erp -c "select login, role, \"isActive\", \"createdAt\"::date from \"User\" order by role;"
```

### 2.9 Mac'dan tashqi tekshiruv (har o'zgarishdan keyin)

```bash
for p in 22 80 443 3000 3010 5432 5438 6382 9010; do nc -z -w 3 189.74.98.242 $p && echo "port $p: OCHIQ" || echo "port $p: yopiq"; done
```

```bash
curl -sI https://insof-erp.uz/login | grep -iE 'server|strict|content-security'
```

---

## 3. Himoyalash — qadamma-qadam

Tartib muhim: avval firewall (eng katta teshik), keyin SSH, keyin qolganlari.
Har qadamdan keyin **ikkinchi terminalda SSH ochiq turgan holda** tekshiring — o'zingizni qulflab qo'ymaslik uchun.

### 3.1 3000 va 3010 ni yopish (BUGUN)

**a) Ilovani faqat localhost'ga bog'lash** — firewall o'chib qolsa ham himoya qoladi (ikki qatlam).

```bash
sudo systemctl edit insof-erp
```

Ochilgan faylga (yuqori, bo'sh qismga) yozing:

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1
```

Bo'sh `ExecStart=` qatori asosiy fayldagi qiymatni tozalaydi, ikkinchisi yangisini beradi.
`next start` faqat `-H` bayrog'ini tushunadi (`HOSTNAME` env o'zgaruvchisini o'qimaydi — tekshirildi). Saqlab chiqing, keyin:

```bash
sudo systemctl daemon-reload && sudo systemctl restart insof-erp && sleep 3 && sudo ss -tlnp | grep ':3000'
```

Natija `127.0.0.1:3000` bo'lishi kerak. ECO uchun NestJS `main.ts` da `app.listen(port, '127.0.0.1')`
— bu ECO repoda tuzatiladi; hozircha firewall yopadi.

**b) Firewall**

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status numbered
```

Faqat 22, 80, 443 qolishi kerak. `3000` yoki `3010` uchun qoida bo'lsa: `sudo ufw delete <raqam>`.

Docker eslatmasi: Docker `ufw` ni chetlab o'tadi, lekin sizda portlar `127.0.0.1:` ga bog'langan —
shuning uchun xavfsiz. `docker-compose.prod.yml` da har doim `127.0.0.1:5438:5432` ko'rinishida qoldiring.

**c) Mac'dan tasdiqlang** (2.9): 3000 va 3010 "yopiq" bo'lishi shart.

### 3.2 SSH: faqat kalit, root yopiq, fail2ban

**Avval** kalit bilan kirish ishlashiga ishonch hosil qiling (aks holda parolni o'chirib qulflanib qolasiz):

```bash
# Mac'da: kalit bormi?
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -C "otabek-mac"
```

```bash
# Mac'da: kalitni serverga qo'shish (bir marta parol so'raydi)
ssh-copy-id deploy@189.74.98.242
```

```bash
# Mac'da: parolsiz kiryaptimi? (parol so'ramasligi kerak)
ssh -o PasswordAuthentication=no deploy@189.74.98.242 'echo KALIT ISHLAYAPTI'
```

Faqat shundan keyin serverda:

```bash
sudo tee /etc/ssh/sshd_config.d/99-hardening.conf >/dev/null <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
X11Forwarding no
AllowUsers deploy
CONF
sudo sshd -t && sudo systemctl reload ssh
sudo sshd -T | grep -iE '^(passwordauthentication|permitrootlogin|allowusers)'
```

`AllowUsers deploy` — boshqa hisob (root ham) SSH orqali umuman kira olmaydi. `deploy` da `sudo`
borligini oldin tekshiring: `sudo -n true && echo OK`.

**fail2ban** — 5 xato → IP 1 soatga bloklanadi:

```bash
sudo apt install -y fail2ban
sudo tee /etc/fail2ban/jail.local >/dev/null <<'CONF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true

[nginx-limit-req]
enabled  = true
logpath  = /var/log/nginx/error.log
maxretry = 10
CONF
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

### 3.3 Avtomatik xavfsizlik yangilanishlari

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # "Yes"
grep -E 'Unattended-Upgrade "1"' /etc/apt/apt.conf.d/20auto-upgrades
```

Bu faqat `-security` manbasidan oladi, ilovani buzmaydi. Kernel yangilansa `/var/run/reboot-required`
paydo bo'ladi — oyda bir `sudo reboot` (tungi vaqtda; xizmatlar `enabled`, o'zi ko'tariladi).

### 3.4 Nginx: versiya yashirish, haqiqiy IP, tezlik cheklovi

```bash
sudo nano /etc/nginx/nginx.conf
```

`http { ... }` blok ichiga qo'shing:

```nginx
server_tokens off;

# Login/parol tiklash/mobil auth uchun: bitta IP dan daqiqasiga 30 so'rov
limit_req_zone $binary_remote_addr zone=auth:10m rate=30r/m;
# Ochiq sahifalar (/verify, sayt formasi) uchun yumshoqroq
limit_req_zone $binary_remote_addr zone=pub:10m rate=120r/m;
limit_req_status 429;
```

Endi sayt fayli:

```bash
sudo nano /etc/nginx/sites-available/insof-erp
```

Mavjud `location / { ... }` ichidagi `X-Forwarded-For` qatorini **almashtiring** va `X-Real-IP` qo'shing
(certbot qo'shgan `listen 443 ssl` qismlariga tegmang):

```nginx
proxy_set_header X-Forwarded-For $remote_addr;   # mijoz yuborgan qiymat TASHLANADI — IP qulfi aldanmaydi
proxy_set_header X-Real-IP       $remote_addr;
```

`location / { ... }` dan **oldin** ikkita yangi blok qo'shing (proxy qatorlari `location /` dagi bilan bir xil):

```nginx
location ^~ /login {
    limit_req zone=auth burst=10 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ^~ /api/mobile/auth/ {
    limit_req zone=auth burst=10 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location ^~ /verify/ {
    limit_req zone=pub burst=20 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Tekshirish (Mac'dan, 429 chiqishi kerak):

```bash
for i in $(seq 1 45); do curl -s -o /dev/null -w '%{http_code} ' https://insof-erp.uz/login; done; echo
```

### 3.5 Postgres va sirlar

```bash
# Tashqaridan tinglamayotganini tasdiqlash
sudo ss -tlnp | grep 5432          # faqat 127.0.0.1 bo'lsin
sudo grep -E '^(host|local)' /etc/postgresql/*/main/pg_hba.conf
```

`.env` huquqlari:

```bash
sudo chown deploy:deploy /var/www/insof-erp/.env && chmod 600 /var/www/insof-erp/.env
sudo chown -R deploy:deploy /var/www/insof-erp/uploads && chmod 750 /var/www/insof-erp/uploads
```

Sirlarni almashtirish kerak bo'lsa (noutbuk yo'qoldi, kimdir `.env` ni ko'rdi):

```bash
cd /var/www/insof-erp
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=\"$(openssl rand -base64 48)\"|" .env
sudo systemctl restart insof-erp    # hamma qayta kiradi — bu maqsad
```

Baza parolini almashtirish: `ALTER ROLE insof PASSWORD '...'` + `.env` dagi `DATABASE_URL` + restart.

### 3.6 systemd qatlami (ilova buzilsa ham zarar chegaralanadi)

`sudo systemctl edit insof-erp` ga 3.1 dagi bilan birga:

```ini
[Service]
ExecStart=
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/www/insof-erp/uploads /var/www/insof-erp/.next
```

`ProtectSystem=full` — `/usr`, `/boot`, `/etc` faqat o'qishga. Ilova `uploads/` va `.next/cache` ga yozadi, shuning uchun
`ReadWritePaths`. Restart'dan keyin `journalctl -u insof-erp -n 30` da `EACCES` bo'lmasa — ishlayapti.

### 3.7 Zaxira nusxa: server tashqarisida ham

Cron'dagi `erp-backup` bazani `/var/backups/insof-erp` ga oladi — lekin **shu serverda**. Disk yonsa ikkalasi ketadi.

Serverda `uploads/` ni ham kunlik arxivga qo'shing (`crontab -e`, `deploy` ostida):

```cron
0 3 * * * APP_DIR=/var/www/insof-erp /usr/local/bin/erp-backup >> /var/log/erp-backup.log 2>&1
15 3 * * * tar -czf /var/backups/insof-erp/uploads_$(date +\%F).tgz -C /var/www/insof-erp uploads && find /var/backups/insof-erp -name 'uploads_*.tgz' -mtime +14 -delete
```

Mac'da har kuni nusxani tortib olish (`crontab -e` Mac'da, kalit bilan kirish 3.2 da tayyor):

```cron
0 8 * * * rsync -az --delete deploy@189.74.98.242:/var/backups/insof-erp/ ~/Backups/insof-erp/
```

Nusxa **tiklanishini** oyda bir sinang (lokal bazaga):

```bash
createdb insof_restore_test && pg_restore -d insof_restore_test --no-owner ~/Backups/insof-erp/$(ls -t ~/Backups/insof-erp | grep dump | head -1) && psql insof_restore_test -c 'select count(*) from "Order";' && dropdb insof_restore_test
```

Tiklanmagan nusxa — nusxa emas.

### 3.8 Ilova darajasida (kod)

- Har deploy'dan oldin: `npm run security:check` (exit 1 bo'lsa deploy to'xtasin).
- Deploy qatori: `git pull && npm ci && npx prisma migrate deploy && npm run build && npm run security:check && sudo systemctl restart insof-erp`.
- Prodda **hech qachon** `npm run db:seed` (admin123 yaratadi).
- Ishdan ketgan xodim: Sozlamalar → hisobni faolsizlantirish (`sessionVersion` oshadi, veb va mobil sessiya darhol o'chadi).
- Keyingi bosqich (kod): `/verify` QR'ga tasodifiy kod; direktor uchun 2FA; Next 16.

---

## 4. Senior yondashuv — nima uchun aynan shunday

1. **Qatlamlar (defense in depth).** 3000-portni ham `-H 127.0.0.1`, ham `ufw` yopadi. Biri o'chib qolsa ikkinchisi ushlab turadi. Xuddi shunday: login qulfi kodda + `limit_req` nginx'da + fail2ban.
2. **Eng kam huquq.** `deploy` foydalanuvchisi, root SSH yopiq, `AllowUsers`, systemd `ProtectSystem`. Ilova buzilsa ham hujumchi `/etc` ga yoza olmaydi.
3. **Hujum yuzasini kichraytirish.** Internetga faqat 22/80/443. Qolgan hamma narsa localhost. Versiya sarlavhalari yashirin.
4. **Sirlar aylanadi.** `AUTH_SECRET`, baza paroli, API kalitlari — almashtirish jarayoni oldindan ma'lum (3.5), shoshilinch holatda o'ylab o'tirmaysiz.
5. **Ko'rinuvchanlik.** `last`, `lastb`, `journalctl`, audit jurnali. Nimani ko'rmasangiz, uni himoya qila olmaysiz.
6. **Tiklanish.** Zaxira server tashqarisida, tiklash sinalgan. Xavfsizlikning oxirgi qatlami — "hamma narsa yo'qolsa ham ertaga ishlaymiz".
7. **Odat.** Bir martalik sozlash yetmaydi — oylik tartib (5-bo'lim).

## 5. Oylik tartib (15 daqiqa)

```bash
# Serverda
sudo apt update && sudo apt upgrade -y && [ -f /var/run/reboot-required ] && echo "REBOOT KERAK"
sudo lastb | wc -l ; last -n 10
sudo fail2ban-client status sshd | grep -E 'Currently|Total'
sudo ufw status | head -12
sudo ss -tlnp | grep -vE '127.0.0.1|::1' | grep -E ':(22|80|443)\b' -v   # bo'sh chiqishi kerak
sudo certbot renew --dry-run | tail -2
df -h / | tail -1
cd /var/www/insof-erp && npm run security:check && npm audit --omit=dev | tail -5
ls -la /var/backups/insof-erp | tail -3
```

Mac'da: 2.9 dagi port tekshiruvi + 3.7 dagi tiklash sinovi.

Belgilar: `lastb` keskin oshsa — hujum, IP'ni `sudo ufw deny from <ip>`; `security:check` qizil bersa — deploy qilmang;
`ss` ro'yxatida yangi `0.0.0.0` port paydo bo'lsa — kim ochganini aniqlang (`sudo ss -tlnp` da `users:`).
