# Server — joriy holat va kundalik buyruqlar

Bu fayl serverda **hozir nima qanday ishlayotganini** va kundalik ishlar uchun kerakli buyruqlarni bir joyda saqlaydi.
To'liq o'rnatish yo'riqnomasi va arxitektura — [PLATFORMA.md](PLATFORMA.md), xavfsizlik — [../server-xavfsizlik.md](../server-xavfsizlik.md).

Holat sanasi: **2026-10-08** (platformaga o'tish va nginx yangilanishidan keyin).

> **Terminalga faqat kod bloklarini joylang.** Izoh matnini buyruqlar bilan birga joylasangiz, `o'sha` kabi so'zlardagi
> apostrof shell'da ochiq qo'shtirnoq bo'lib qoladi va terminal `>` da kutib turadi. Shunda **Ctrl+C** bosing — kutilayotgan
> qatorlar bajarilmaydi.

---

## 1. Umumiy tuzilma

```
                  admin.insof-erp.uz ──► insof-control      :3100  (IT panel, /superadmin)
                        insof-erp.uz ──► insof-erp@insof    :3000  (Insof beton ERP + ommaviy sayt)
                    www.insof-erp.uz ──► 301 → https://insof-erp.uz
                    api.insof-erp.uz ──► insof-eco                 (Insof ECO mobil ilova API)
   boshqa har qanday domen / IP orqali ──► 444 (ulanish javobsiz uziladi)
```

Kod bitta (bitta build), har korxona alohida jarayon, alohida baza va alohida `.env` bilan ishlaydi. Ma'lumot aralashmaydi.

### `insof-erp@insof` nomi nima?

`insof-erp@.service` — systemd **shablon** xizmati. `@` dan keyingi so'z — korxonaning qisqa nomi (slug), u IT panelda
ro'yxatga olinganda berilgan (`--slug insof`). Yangi korxona uchun yangi xizmat fayli yozilmaydi — shu shablondan yana bir
nusxa ishga tushiriladi:

| Xizmat | Korxona | Sozlamalar | Baza | Port |
|---|---|---|---|---|
| `insof-erp@insof` | Insof beton | `tenants/insof.env` | `insof_erp` | 3000 |
| `insof-erp@<slug>` | keyingi korxonalar | `tenants/<slug>.env` | `insof_t_<slug>` | 3101, 3102, … |

---

## 2. Xizmatlar (systemd)

| Xizmat | Vazifasi | Holati |
|---|---|---|
| `insof-erp@insof` | Insof ERP va sayt | ✅ yoqilgan |
| `insof-control` | IT panel | ✅ yoqilgan |
| `insof-eco` | ECO mobil API | ✅ yoqilgan |
| `insof-agent` | IT panel agenti (monitoring, deploy, loglar) | PLATFORMA.md bo'yicha |
| `insof-erp` | **eski** yagona xizmat | ⛔ to'xtatilgan va o'chirilgan (`disabled`) — faqat qaytarish uchun turibdi |

```bash
systemctl list-units 'insof*'
systemctl status insof-erp@insof
sudo systemctl restart insof-erp@insof
journalctl -u insof-erp@insof -n 100 --no-pager
journalctl -u insof-erp@insof -f
curl -s 127.0.0.1:3000/api/health; echo
```

Boshqa xizmatlar uchun ham xuddi shunday — nomini almashtiring (`insof-control`, `insof-eco`, `insof-agent`).
`/api/health` faqat serverning o'zidan ochiladi; tashqaridan 403 qaytaradi — bu to'g'ri.

---

## 3. Serverdagi fayllar

| Yo'l | Nima |
|---|---|
| `/var/www/insof-erp/` | git repo (manba), `deploy` foydalanuvchisiniki |
| `/var/www/insof-erp/releases/<sha>/` | har reliz alohida build (oxirgi 3 tasi saqlanadi) |
| `/var/www/insof-erp/current` | → joriy reliz; xizmatlar shu yerdan ishlaydi |
| `/var/www/insof-erp/tenants/insof.env` | Insof ERP sozlamalari va kalitlari (`-rw-------`) |
| `/var/www/insof-erp/control.env` | IT panel sozlamalari |
| `/var/www/insof-erp/uploads/` | Insof ERP fayllari (shartnomalar, suratlar, APK) |
| `/var/www/insof-erp/.env.pre-platform` | **eski** `.env` — faqat qaytarish uchun saqlangan |
| `/usr/local/sbin/insof-tenant-up` | korxonani ishga tushirish skripti (root egaligida) |
| `/usr/local/share/insof/` | systemd va nginx shablonlari (root egaligida) |
| `/etc/insof/tenant-up.conf` | ruxsat etilgan domenlar siyosati |

Joriy relizni bilish:
```bash
readlink /var/www/insof-erp/current
head -1 /var/www/insof-erp/current/RELEASE
```

`tenants/*.env` va `control.env` ni git'ga qo'shmang, chatga yoki skrinshotga chiqarmang — ichida sirlar bor.

---

## 4. nginx saytlari

`/etc/nginx/sites-enabled/` da yoqilganlar:

| Sayt fayli | Domen | Nima qiladi | Sertifikat |
|---|---|---|---|
| `000-default-deny` | boshqa hammasi, IP | `return 444` — javobsiz uzadi | o'z-o'zidan imzolangan `/etc/nginx/default-deny.crt` |
| `insof-insof` | `insof-erp.uz` | → `127.0.0.1:3000`, tezlik cheklovi, haqiqiy IP | `insof-erp.uz-0001` |
| `insof-www` | `www.insof-erp.uz` | 301 → `https://insof-erp.uz` (yo'l saqlanadi) | `www.insof-erp.uz` |
| `insof-control` | `admin.insof-erp.uz` | IT panel | `admin.insof-erp.uz` |
| `insof-eco` | `api.insof-erp.uz` | ECO API | `api.insof-erp.uz` |

Tezlik cheklovi zonalari: `/etc/nginx/conf.d/insof-limits.conf` (`insof_auth`, `insof_pub`, `insof_ai`).

Serverdagi nginx versiyasi eski — `ssl_reject_handshake` direktivasini bilmaydi. Shuning uchun `000-default-deny` o'z-o'zidan
imzolangan sertifikat bilan ishlaydi.

**nginx'ni o'zgartirgandan keyin har doim:**
```bash
sudo nginx -t && sudo systemctl reload nginx
```
`nginx -t` xato bersa, reload qilinmaydi va eski sozlama ishlashda davom etadi — lekin xato faylni `sites-enabled` da
qoldirmang: keyingi reload (masalan, certbot'ning avtomatik yangilashi) yiqiladi.

**Zaxira sifatida qolgan (yoqilmagan, hech narsaga ta'sir qilmaydi):**
- `/etc/nginx/sites-available/insof-erp` — eski sayt (`insof-erp.uz` + `www`)
- `/etc/nginx/insof-erp.nginx.bak` — uning nusxasi
- `/etc/nginx/sites-available/files.insof-erp.uz` — o'chirilgan sayt fayli

---

## 4a. SSH va fail2ban

Serverga **faqat kalit bilan** kiriladi: parol bilan kirish va `root` kirishi o'chirilgan.

| Sozlama | Qiymat | Fayl |
|---|---|---|
| `PermitRootLogin` | `no` | `/etc/ssh/sshd_config.d/00-insof-hardening.conf` |
| `PasswordAuthentication` | `no` | o'sha fayl |
| `KbdInteractiveAuthentication` | `no` | o'sha fayl |
| Ruxsat etilgan kalit | `otabek-mac` (ed25519) | `/home/deploy/.ssh/authorized_keys` |

Mac'dan kirish (`~/.ssh/config` da `Host insof` yozilgan):
```bash
ssh insof
```
Kalitning maxfiy qismi — Mac'dagi `~/.ssh/insof_ed25519`. Zaxira nusxasini xavfsiz joyda (parol menejeri) saqlang.
`sudo` uchun `deploy` paroli avvalgidek so'raladi.

**Yangi kompyuter yoki xodim kalitini qo'shish** (eski kalit bilan kirib):
```bash
nano ~/.ssh/authorized_keys
```
Oxiriga yangi `.pub` faylning bitta qatorini qo'shing. Keyin yangi kompyuterdan kirib tekshiring.

**Kalit yo'qolsa / kira olmasangiz:** eskiz.uz panelidagi VNC/konsol orqali kirib, `authorized_keys` ga yangi kalit qo'shing.
Favqulodda parol bilan kirishni vaqtincha qaytarish (konsoldan):
```bash
sudo rm /etc/ssh/sshd_config.d/00-insof-hardening.conf && sudo systemctl reload ssh
```

Tekshirish:
```bash
sudo sshd -T | grep -Ei "^(permitrootlogin|passwordauthentication) "
```

**fail2ban** — SSH'da 10 daqiqada 5 marta xato urinish qilgan IP 1 soatga bloklanadi. Sozlama
`/etc/fail2ban/jail.local` (`backend = systemd` — serverda `/var/log/auth.log` yo'q, loglar journald'da).
Oq ro'yxat (`ignoreip`) da `144.124.192.99` bor — ofis IP o'zgarsa, yangilang.
```bash
sudo fail2ban-client status sshd
sudo fail2ban-client set sshd unbanip <IP>
```

---

## 5. SSL sertifikatlar

```bash
sudo certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry'
sudo certbot renew --dry-run
```

Yangilash avtomatik (certbot taymeri). Ishlatilayotganlar: `insof-erp.uz-0001`, `www.insof-erp.uz`, `admin.insof-erp.uz`,
`api.insof-erp.uz`.

Endi ishlatilmaydigan (o'chirsa bo'ladi):
```bash
sudo certbot delete --cert-name insof-erp.uz
sudo certbot delete --cert-name files.insof-erp.uz
```

---

## 6. Deploy (yangi kodni serverga chiqarish)

Lokalda: o'zgarishlar commit qilinib, `main` ga push qilingan bo'lishi kerak. Serverda (`deploy` foydalanuvchisi):

```bash
cd /var/www/insof-erp && git pull --ff-only && SKIP_ECO=1 bash scripts/deploy.sh
```

| O'zgaruvchi | Ma'nosi |
|---|---|
| `SKIP_ECO=1` | ECO API'ni yangilamaslik (faqat ERP + IT panel) |
| `ROLLBACK=1` | oldingi relizga qaytish, build'siz |
| `DEPLOY_REF=<sha>` | aniq commitni chiqarish |
| `KEEP_RELEASES=3` | nechta eski reliz saqlansin |

Deploy avval yangi relizni alohida build qiladi, migratsiyalarni bajaradi, keyin `current` ni almashtirib xizmatlarni
bittadan qayta ishga tushiradi. `/api/health` o'tmasa — o'zi eski relizga qaytadi. Build xato bersa, ishlayotgan
xizmatlarga umuman tegilmaydi (`✗ Build xato — ishlayotgan xizmatlarga tegilmadi`).

**Migratsiyalar orqaga qaytmaydi** — kod qaytsa ham baza yangi sxemada qoladi.

Oldingi relizga qaytish:
```bash
cd /var/www/insof-erp && ROLLBACK=1 bash scripts/deploy.sh
```

Deploy IT paneldan ham qilinadi: **Relizlar** sahifasi (`TASDIQLAYMAN` yoziladi).

---

## 7. Ma'lum muammolar

### Build `next/font` xatosi bilan yiqiladi
```
An error occurred in `next/font`.
TypeError: Cannot read properties of null (reading '1')
```
oldidan ko'p `Retrying 1/3...` va `Client network socket disconnected before secure TLS connection was established`.

**Sabab:** build paytida Next.js shriftlarni Google Fonts'dan yuklab oladi, serverdan Google'gacha aloqa uzilib turadi.
Kod xatosi emas. **Yechim:** deploy'ni qayta ishga tushiring. Doimiy yechim — shriftlarni loyihaga joylash
(`next/font/local`); hali qilinmagan.

### `www` ishlamay qolsa
`insof-www` sayti yoqilganini tekshiring: `ls -l /etc/nginx/sites-enabled/`. `insof-tenant-up` faqat bitta domen bilan
ishlaydi va `insof-www` ga tegmaydi.

### Bosh sahifada «Joylashuv» xaritasi chiqmaydi
Bazada zavod koordinatasi yo'q. ERP → Sozlamalar → Zavod rekvizitlari → **«Zavod joyi»** da nuqta qo'yiladi.

### iPhone tugmasi «Tez orada» deb turadi
`tenants/insof.env` ga TestFlight yoki App Store havolasini qo'shing va xizmatni qayta ishga tushiring (deploy shart emas):
```bash
nano /var/www/insof-erp/tenants/insof.env
sudo systemctl restart insof-erp@insof
```
Qo'shiladigan qator: `IOS_APP_URL="https://testflight.apple.com/join/XXXXXXXX"`. Faqat `testflight.apple.com` yoki
`apps.apple.com` havolasi qabul qilinadi.

---

## 8. Eski holatga qaytarish (favqulodda)

### ERP'ni eski yagona xizmatga qaytarish (~10 s uzilish)
```bash
cd /var/www/insof-erp
sudo systemctl disable --now insof-erp@insof
mv .env.pre-platform .env
sudo systemctl enable --now insof-erp
```

### nginx'ni eski saytga qaytarish
```bash
sudo rm -f /etc/nginx/sites-enabled/insof-insof /etc/nginx/sites-enabled/insof-www
sudo ln -s /etc/nginx/sites-available/insof-erp /etc/nginx/sites-enabled/insof-erp
sudo nginx -t && sudo systemctl reload nginx
```
Eski sayt `insof-erp.uz` sertifikatidan foydalanadi — uni o'chirgan bo'lsangiz, avval
`sudo certbot --nginx -d insof-erp.uz -d www.insof-erp.uz` bilan qayta oling.

### Notanish so'rovlarni yopishni bekor qilish
```bash
sudo rm /etc/nginx/sites-enabled/000-default-deny
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. Tashqaridan tekshirish (Mac'dan)

```bash
for u in https://insof-erp.uz/ https://insof-erp.uz/login https://insof-erp.uz/api/health https://www.insof-erp.uz/ https://admin.insof-erp.uz/superadmin/login; do printf '%-45s ' "$u"; curl -s -o /dev/null -m 15 -w '%{http_code} -> %{redirect_url}\n' "$u"; done
```

Kutilgan natija (2026-10-08 dagi holat):

| So'rov | Natija |
|---|---|
| `https://insof-erp.uz/`, `/login` | 200 |
| `https://insof-erp.uz/api/health` | 403 |
| `https://www.insof-erp.uz/` | 301 → `https://insof-erp.uz/` |
| `https://admin.insof-erp.uz/superadmin/login` | 200 |
| IP orqali yoki notanish domen | ulanish uziladi (444) |

---

## 10. O'zgarishlar jurnali

**2026-10-08**
- Insof ERP eski `insof-erp` xizmatidan `insof-erp@insof` ga o'tkazildi; `.env` → `.env.pre-platform`.
- nginx: `insof-erp.uz` yangi shablonga o'tdi (`insof-insof`, yangi sertifikat `insof-erp.uz-0001`).
- `www.insof-erp.uz` tiklandi — `insof-www` sayti, asosiy domenga 301 (6-oktabrdan beri ishlamay turgan edi).
- `files.insof-erp.uz` olib tashlandi (9010-portdagi xizmat allaqachon ishlamas edi).
- `000-default-deny` qo'shildi — notanish domen va IP orqali kelgan so'rovlar 444 bilan uziladi.
- SSH: kalit bilan kirish (`otabek-mac`), parol va `root` kirishi o'chirildi.
- fail2ban o'rnatildi (sshd, `backend = systemd`).
- Zaxira tiklash sinovi qo'lda o'tkazildi — muvaffaqiyatli (control 11 jadval, insof 73 jadval).

**Ochiq qolgan (2026-10-08):**
- ECO API `*:3010` da tinglaydi — tuzatish `InsofECO/apps/api/src/main.ts` da (prod'da `127.0.0.1`), ECO bilan deploy kerak.
- npm audit: 7 ta HIGH (`next`, `postcss`, `source-map-js`, `deepmerge-ts`, `sharp` — sharp ataylab qotirilgan).
- Server qayta yuklashni kutmoqda (yadro 191 → 198): xizmatlar `enabled` ekanini tekshirib, `sudo reboot`.
