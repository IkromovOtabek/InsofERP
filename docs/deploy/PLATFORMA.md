# Insof platforma — ko'p korxonali tuzilma

```
                 admin.insof-erp.uz  ──►  insof-control (3100, INSOF_MODE=control)
                                             │  control baza: korxonalar, superadminlar, jurnal, kunlik statistika
                                             │  korxona bazalariga to'g'ridan-to'g'ri (yaratish, direktor, statistika)
                                             │  SSO: har korxona uchun HMAC(CONTROL_SECRET, slug) bilan imzolangan 60 s token
          ┌──────────────────────────────────┼───────────────────────────────┐
  insof-erp.uz → :3000              sharq.insof-erp.uz → :3101          zavod3… → :3102
  insof-erp@insof                   insof-erp@sharq                     insof-erp@zavod3
  baza insof_erp                    baza insof_t_sharq                  baza insof_t_zavod3
  uploads/insof                     /var/lib/insof/sharq/uploads        …
```

Kod bitta (bitta build), har korxona — o'z jarayoni, o'z bazasi, o'z `.env` i
(`tenants/<slug>.env`: AUTH_SECRET, SSO kaliti, ECO/AI/Telegram kalitlari alohida). Ma'lumot hech qachon aralashmaydi.

## Rollar

| Kim | Qayerda | Nima qiladi |
|---|---|---|
| **IT superadmin** | admin domeni, `/superadmin` | korxona yaratadi, direktorga login/parol beradi, to'xtatadi/yoqadi, barcha korxonalar statistikasi va holati (ERP, baza, ECO), istalgan korxonaga «Kirish (IT)» — ichkarida direktor huquqi |
| **Direktor** | korxona domeni | xodimlarga login/parol beradi (Sozlamalar → Foydalanuvchilar, Otdel kadr), ruxsatlar |
| **Xodim** | korxona domeni / mobil | o'z roli va direktor bergan ruxsat bo'yicha |

IT korxona ichida `it.<login>` hisobi bilan ko'rinadi: direktor uni ro'yxatda ko'rmaydi va o'zgartira olmaydi,
lekin har kirishi korxona audit jurnaliga yoziladi. Bu hisobga parol bilan kirib bo'lmaydi.

## Serverdagi fayllar

```
/var/www/insof-erp/                 git repo (manba). deploy foydalanuvchisiniki
├── control.env                     IT panel sozlamasi (600)            ← docs/deploy/control.env.example
├── build.env                       build vaqtidagi kalitlar (600)      ← build.env.example
├── tenants/<slug>.env              har korxona (600)                   ← panel yaratadi (renderEnv)
├── uploads/                        eski "insof" korxonasi fayllari + APK
├── releases/<sha>/                 har reliz: git archive → npm ci → build (oxirgi 3 tasi saqlanadi)
└── current → releases/<sha>        systemd xizmatlari shu yerdan ishlaydi
/var/lib/insof/<slug>/uploads       yangi korxonalar fayllari
/etc/insof/backup.env               zaxira nusxa / ogohlantirish sozlamasi ← docs/deploy/backup.env.example
/var/backups/insof/<sana>/          mahalliy zaxira nusxalar
```

**Muhim:** ildizda `.env` bo'lmasin — Next.js ishchi papkadagi `.env` ni har jarayonga yuklaydi va kalitlar
(Telegram, ECO, AI) boshqa korxonalarga «sizadi». Kod `releases/<sha>` dan ishlagani uchun barcha yo'llar
(`TENANTS_DIR`, `UPLOADS_DIR`, `APK_PATH`) **mutlaq** yozilsin.

## Birinchi o'rnatish (insof) — qadam-baqadam

Mavjud yagona `insof-erp` xizmatini (repo ildizida, `.env` bilan, port 3000) platformaga ko'chirish va IT panelni
yoqish. Bir marta qilinadi, **ishdan tashqari vaqtda** (~1 soat; foydalanuvchilar uchun uzilish faqat 7-qadamda,
10–30 soniya). Har qadam: buyruqlar → **tekshirish** → **qaytarish** (shu qadamda nimadir buzilsa).
Buyruqlar `deploy` foydalanuvchisi ostida, `sudo` faqat ko'rsatilgan joyda. Oldin: `docs/server-xavfsizlik.md` 3.1–3.5.

**Qaytarishning umumiy qoidasi:** 7-qadamgacha eski `insof-erp` xizmati umuman o'zgarmaydi — biror qadam o'xshamasa,
shu yerda to'xtab, yangi narsalarni olib tashlash kifoya. Bazaga yagona o'zgarish — 4-qadamdagi navbatdagi migratsiyalar
(oddiy `deploy.sh` ham shuni qiladi; migratsiyalar «kengaytiruvchi», eski kod yangi sxemada ishlaydi).

### 0. Qo'lda zaxira (o'zgarishlardan OLDIN)

```bash
cd /var/www/insof-erp
pg_dump -Fc "$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed 's/?.*//')" -f ~/insof-oldin-$(date +%F).dump
tar -czf ~/insof-uploads-oldin-$(date +%F).tar.gz -C /var/www/insof-erp uploads
cp -p .env ~/insof-env-oldin-$(date +%F) && chmod 600 ~/insof-env-oldin-*
```
Tekshirish: `ls -lh ~/insof-*` — dump hajmi 0 emas; `pg_restore -l ~/insof-oldin-*.dump | head` xatosiz.
Qaytarish: kerak emas (faqat o'qildi).

### 1. Paketlar va huquqlar

```bash
sudo apt install -y postgresql-client perl rclone        # rclone o'rniga restic ham bo'ladi (backup.env → OFFSITE)
# deploy.sh xizmatlarni `sudo systemctl restart` bilan qayta ishga tushiradi. Parol so'ralmasligi uchun (ixtiyoriy):
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart insof-erp@*, /usr/bin/systemctl restart insof-control, /usr/bin/systemctl restart insof-eco' \
  | sudo tee /etc/sudoers.d/insof-deploy >/dev/null && sudo chmod 440 /etc/sudoers.d/insof-deploy && sudo visudo -c
```
Tekshirish: `psql --version`, `rclone version`, `sudo -l -U deploy | grep insof`.
Qaytarish: `sudo rm /etc/sudoers.d/insof-deploy`.

### 2. Postgres: control baza va CREATEDB

```bash
sudo -u postgres psql -c "CREATE DATABASE insof_control OWNER insof"
sudo -u postgres psql -c "ALTER ROLE insof CREATEDB"     # panel yangi korxona bazasini, restore-test.sh vaqtinchalik bazani o'zi yaratadi
```
Tekshirish: `psql "postgresql://insof:<PAROL>@127.0.0.1:5432/insof_control" -c 'SELECT 1'` → 1.
Qaytarish: `sudo -u postgres psql -c "DROP DATABASE insof_control"`; `... "ALTER ROLE insof NOCREATEDB"`.

### 3. Sozlama fayllari (hammasi `chmod 600`, egasi `deploy`)

**Avtomatik usul (tavsiya):** `cd /var/www/insof-erp && bash scripts/platform-init-env.sh` — `control.env`, `build.env` va
`tenants/insof.env` ni mavjud `.env` dan yaratadi (yangi panel sirlari, baza paroli `.env` dan; mavjud faylni ustidan yozmaydi).
Keyin faqat `/etc/insof/backup.env` (9-qadamgacha) qoladi. Qo'lda usul:

```bash
cd /var/www/insof-erp
cp docs/deploy/control.env.example control.env && chmod 600 control.env && nano control.env
cp build.env.example build.env && chmod 600 build.env && nano build.env
mkdir -p -m 700 tenants && cp -p .env tenants/insof.env && chmod 600 tenants/insof.env && nano tenants/insof.env
sudo install -d -m 750 -o root -g deploy /etc/insof
sudo install -m 640 -o root -g deploy docs/deploy/backup.env.example /etc/insof/backup.env && sudo nano /etc/insof/backup.env
```
`.env` hozircha **ko'chirilmaydi, nusxalanadi** — eski xizmat 7-qadamgacha undan foydalanadi.

| Fayl | Kalitlar (faqat nomlari) |
|---|---|
| `control.env` | `NODE_ENV=production`, `TZ`, `INSOF_MODE=control`, `AUTH_SECRET` (yangi, `openssl rand -base64 48`), `CONTROL_SECRET` (yangi, boshqa qiymat), `CONTROL_DATABASE_URL` (…/insof_control), `TENANT_DATABASE_URL` (…/{db}?connection_limit=5), `DATABASE_URL` (= control), `TENANTS_DIR=/var/www/insof-erp/tenants`, `TENANT_DATA_ROOT=/var/lib/insof`, `TENANT_BASE_DOMAIN` |
| `build.env` | `NEXT_PUBLIC_YANDEX_MAPS_KEY` (`.env` dan ko'chiring), `DATABASE_URL` (insof_erp), `APP_URL=https://insof-erp.uz`, `NEXT_TELEMETRY_DISABLED=1` |
| `tenants/insof.env` | `.env` ning hammasi (`DATABASE_URL`, **eski** `AUTH_SECRET` — ochiq sessiyalar saqlanadi, Telegram/ECO/AI kalitlari) **+** `PORT=3000`, `TENANT_SLUG=insof`, `UPLOADS_DIR=/var/www/insof-erp/uploads`, `APK_PATH=/var/www/insof-erp/uploads/app/insof-eco.apk`, `CONTROL_SSO_KEY` (5-qadamda). **O'chiring:** `CONTROL_SECRET`, `NEXT_PUBLIC_*` (build.env da) |
| `/etc/insof/backup.env` | `APP_DIR`, `OUT_DIR`, `KEEP_DAYS`, `BACKUP_UPLOADS`, `OFFSITE` (rclone/restic/local), `RCLONE_REMOTE` yoki `RESTIC_REPOSITORY`+`RESTIC_PASSWORD_FILE` yoki `OFFSITE_DIR`, `ALERT_TG_BOT_TOKEN`, `ALERT_TG_CHAT_ID` |

Tekshirish: `ls -l control.env build.env tenants/` — hammasi `-rw-------`; `grep -c '^CONTROL_SECRET' tenants/insof.env` → 0;
`grep -E '^(PORT|TENANT_SLUG|UPLOADS_DIR)=' tenants/insof.env` — uchala qator bor.
Qaytarish: `rm -r control.env build.env tenants` (eski `.env` joyida).

### 4. Birinchi reliz (xizmatlarga tegmaydi)

```bash
cd /var/www/insof-erp && SKIP_RESTART=1 bash scripts/deploy.sh
```
`git pull` → `releases/<sha>` ga `npm ci` + build → control baza va `insof_erp` ga `prisma migrate deploy` → `current` symlink.
Bazasi topilmasa yoki ulanib bo'lmasa deploy to'xtaydi (Prisma yo'q bazani jim yaratib yubormasin).
Tekshirish: oxirida `✓ Deploy tugadi`; `readlink current` → `releases/<sha>`; `cat current/RELEASE`;
`psql "<CONTROL_DATABASE_URL, ?siz>" -c '\dt'` → Tenant, SuperAdmin, ControlEvent, TenantStat.
Qaytarish: `rm current && rm -rf releases` (eski xizmat repo ildizidagi `.next` dan ishlashda davom etadi).

### 5. Superadmin, insof'ni ro'yxatga olish, SSO kaliti

```bash
cd /var/www/insof-erp/current
export CONTROL_ENV_FILE=/var/www/insof-erp/control.env
npm run control:admin -- otabek "Otabek Ikromov"                    # parol so'raladi (8+ belgi, harf+raqam)
npm run tenant -- register --slug insof --name "Insof beton" --db insof_erp --port 3000 --domain insof-erp.uz
{ echo; npm run -s tenant -- sso-key insof; } >> /var/www/insof-erp/tenants/insof.env   # CONTROL_SSO_KEY=... qatori
```
Tekshirish: `npm run -s tenant -- list` → `insof ACTIVE :3000 insof_erp insof-erp.uz`;
`grep -c '^CONTROL_SSO_KEY=' /var/www/insof-erp/tenants/insof.env` → 1.
Qaytarish: `psql "<control URL>" -c "DELETE FROM \"Tenant\" WHERE slug='insof'"`; qatorni insof.env dan o'chiring.

### 6. IT panel xizmati va nginx

DNS: `admin.insof-erp.uz` → server IP (certbot'dan oldin).
```bash
cd /var/www/insof-erp
sudo install -m 644 docs/deploy/insof-erp@.service docs/deploy/insof-control.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now insof-control
sudo install -m 644 docs/deploy/nginx-limits.conf /etc/nginx/conf.d/insof-limits.conf
sudo install -m 644 docs/deploy/nginx-control.conf /etc/nginx/sites-available/insof-control
sudo ln -sf /etc/nginx/sites-available/insof-control /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d admin.insof-erp.uz --redirect
```
Tekshirish: `curl -s 127.0.0.1:3100/api/health` → `{"ok":true,"version":"<sha>"}`; brauzerda
`https://admin.insof-erp.uz/superadmin/login` → kirish; ro'yxatda «Insof beton». `journalctl -u insof-control -n 50` xatosiz.
Qaytarish: `sudo systemctl disable --now insof-control`; `sudo rm /etc/nginx/sites-enabled/insof-control && sudo systemctl reload nginx`.

### 7. insof'ni yangi xizmatga o'tkazish (UZILISH 10–30 s)

```bash
cd /var/www/insof-erp
sudo systemctl disable --now insof-erp                    # eski yagona xizmat
mv .env .env.pre-platform                                 # ildizda .env qolmasin (skriptlar uni o'qimasin); qaytarish uchun saqlanadi
sudo bash scripts/tenant-up.sh insof                      # insof-erp@insof: current/ dan, port 3000, /api/health kutadi
```
Tekshirish:
- `systemctl is-active insof-erp@insof` → active; `curl -s 127.0.0.1:3000/api/health` → `ok:true`, `version` = `cat current/RELEASE` boshi;
- `journalctl -u insof-erp@insof -n 80 | grep -iE 'eacces|error'` — bo'sh (ProtectSystem=strict ostida yozish huquqi);
- brauzerda `https://insof-erp.uz/login` → direktor kiradi; eski ochiq sessiyalar saqlangan; shartnoma faylini ochish (uploads);
- panel → Insof → «Tekshirish» → ERP/baza yashil; «Kirish (IT)» → yangi oynada korxona ichida (yorliq «IT superadmin»).

Qaytarish (eski holatga, ~10 s):
```bash
sudo systemctl disable --now insof-erp@insof
mv .env.pre-platform .env
sudo systemctl enable --now insof-erp                     # eski unit va repo ildizidagi eski .next build o'zgarmagan
```

### 8. nginx (insof domeni)

Mavjud `/etc/nginx/sites-available/insof-erp` 3000-portga yo'naltirgani uchun ishlashda davom etadi. Yangi shablonga
(X-Real-IP, limit_req, 16m, `/api/health` yopiq) o'tish: `sudo bash scripts/tenant-up.sh insof insof-erp.uz`
(`insof-insof` sayt faylini yaratadi, certbot 443 qismini qo'shadi) → eski faylni `sites-enabled` dan olib tashlang → `sudo nginx -t && sudo systemctl reload nginx`.
Tekshirish: Mac'dan `curl -sI https://insof-erp.uz/login` → 200; `curl -sI https://insof-erp.uz/api/health` → 403.
Qaytarish: eski sayt faylini `sites-enabled` ga qaytarib, `insof-insof` ni olib tashlang, `reload`.

### 9. Zaxira nusxa, kuzatuv, cron

```bash
sudo install -d -m 750 -o deploy -g deploy /var/backups/insof
for f in backup restore-test health stats; do sudo install -o deploy -g deploy -m 640 /dev/null /var/log/insof-$f.log; done
sudo install -m 644 docs/deploy/logrotate-insof /etc/logrotate.d/insof
rclone config                                              # deploy ostida: masofa (B2/S3/...) → backup.env RCLONE_REMOTE
bash scripts/server-backup.sh && bash scripts/restore-test.sh
crontab -e                                                 # «Zaxira nusxa» bo'limidagi 4 qator
```
Tekshirish: ikkala skript `exit 0` (`echo $?`); `/var/backups/insof/<sana>/` da `control.dump`, `insof.dump`, `insof-uploads.tar.gz`, `SHA256SUMS`;
`rclone ls <RCLONE_REMOTE>` — shu nusxa; Telegram: `sudo systemctl stop insof-control`, 2–3 daqiqada «[XATO]» xabari, `start` — «[TIKLANDI]».
Qaytarish: cron qatorlarini o'chirish. Eski `erp-backup` cron qatorini endi o'chiring.

### 10. Yakuniy

```bash
cd /var/www/insof-erp && bash scripts/deploy.sh             # to'liq: restart + /api/health + avtomatik qaytarish
```
Tekshirish: `✓ Deploy tugadi`; «Go-live ro'yxati» 9-band (demo/test ma'lumot yo'q). Skriptlar endi korxona fayli bilan:
`cd /var/www/insof-erp/current && ENV_FILE=/var/www/insof-erp/tenants/insof.env npm run eco:sync`.

## Yangi korxona

1. Panel → «Yangi korxona»: nomi, qisqa nom (`sharq`), domen, direktor F.I.O./login/parol → baza + jadvallar +
   «Asosiy sklad» + direktor + `tenants/sharq.env` (AUTH_SECRET, CONTROL_SSO_KEY, TELEGRAM_WEBHOOK_SECRET va
   ECO_WEBHOOK_SECRET tasodifiy yaratiladi).
2. DNS: `sharq.insof-erp.uz` → server IP.
3. Serverda: `sudo bash scripts/tenant-up.sh sharq sharq.insof-erp.uz` (systemd, /api/health, nginx, SSL).
4. Panelda «Tekshirish» → holat «Faol». Direktorga manzil va login/parolni bering.
5. Integratsiyalar (ixtiyoriy) — `tenants/sharq.env` ga kalitlarni yozib `sudo systemctl restart insof-erp@sharq`:
   - **Telegram bot** — har korxonaning O'Z boti (@BotFather). `TELEGRAM_BOT_TOKEN` yozilgach webhook:
     ```bash
     cd /var/www/insof-erp/current
     ENV_FILE=/var/www/insof-erp/tenants/sharq.env npm run bot:webhook -- https://sharq.insof-erp.uz
     ENV_FILE=/var/www/insof-erp/tenants/sharq.env npm run bot:webhook        # holatni tekshirish
     ```
     `TELEGRAM_WEBHOOK_SECRET` almashtirilsa — webhook'ni qayta o'rnating.
   - **ECO** — ECO'da `integration:create` bergan `ECO_API_KEY` va `ECO_WEBHOOK_SECRET` (yaratilgan tasodifiy qiymat o'rniga).

## SSO kaliti (IT «Kirish») va orqaga moslik

Panel tokenni korxona uchun hosila kalit bilan imzolaydi: `CONTROL_SSO_KEY = HMAC-SHA256(CONTROL_SECRET, "insof-sso:<slug>")`.
Korxona faqat o'z `.env` idagi `CONTROL_SSO_KEY` bilan tekshiradi — bitta korxona fayli sizib chiqsa ham boshqa korxonaga
yoki panelga token yasab bo'lmaydi. Global `CONTROL_SECRET` faqat `control.env` da turadi.

**Oldin yaratilgan korxonalar** (`.env` ida global `CONTROL_SECRET` bor): SSO ishlashda davom etadi — korxona hosila
kalitni o'zi hisoblaydi. Lekin xavfsizlik uchun har biriga:

```bash
cd /var/www/insof-erp/current
CONTROL_ENV_FILE=/var/www/insof-erp/control.env npm run -s tenant -- sso-key <slug>   # → CONTROL_SSO_KEY=...
# tenants/<slug>.env: CONTROL_SECRET=... qatorini O'CHIRING, chiqqan CONTROL_SSO_KEY=... ni qo'shing
sudo systemctl restart insof-erp@<slug>
```

`CONTROL_SECRET` almashtirilsa — barcha korxonalarning `CONTROL_SSO_KEY` i qayta yoziladi (yuqoridagi buyruq bilan).

## Yangilash va qaytarish

`bash scripts/deploy.sh` (deploy foydalanuvchisi, root EMAS):

1. `git pull` → `releases/<sha>` ga alohida `npm ci` (npm 10, lock fayl bilan) + `npm run build` (`build.env` bilan).
   Ishlayotgan jarayonlarga tegilmaydi; build xato bo'lsa — hech narsa o'zgarmaydi.
2. `prisma migrate deploy` — control baza va **har** `tenants/*.env` bazasi. Avval `psql` bilan baza borligi tekshiriladi
   (Prisma yo'q bazani o'zi yaratib yuboradi — `.env` dagi xato nom jim bo'sh bazaga aylanardi). Xato bo'lsa — almashtirilmaydi.
3. `current` symlink atomar almashadi.
4. Yoqilgan `insof-erp@*` va `insof-control` bittadan qayta ishga tushadi, har biri `127.0.0.1:<port>/api/health` = 200
   bo'lishini kutadi (60 s). Biri o'tmasa — `current` oldingi relizga qaytadi, qayta ishga tushirilganlar qaytariladi, exit 1.
5. Oxirgi 3 reliz saqlanadi (`KEEP_RELEASES`).

Qo'lda qaytarish: `ROLLBACK=1 bash scripts/deploy.sh` (eng yangi boshqa relizga). Aniq commit/tegni chiqarish:
`DEPLOY_REF=<sha|teg> bash scripts/deploy.sh`. **Migratsiyalar qaytmaydi** — sxema o'zgarishlari
«kengaytiruvchi» bo'lsin (ustun qo'shish; eski ustunni o'chirish keyingi relizda), shunda oldingi kod yangi bazada ishlaydi.

Repodagi `docs/deploy/*.service` o'zgarsa deploy ogohlantiradi: `sudo install -m 644 docs/deploy/<unit> /etc/systemd/system/ && sudo systemctl daemon-reload`.

**Sinov rejimi** `DRY_RUN=1` — faqat sinov `APP_DIR` bilan (prod papkasida rad etiladi): systemd, sudo, git pull, ECO'ga
tegmaydi; build, migratsiya, symlink, /api/health va avtomatik qaytarish haqiqatan bajariladi; xizmatlar `RESTART_CMD` bilan.
Namuna va to'liq lokal sinov — «Lokal sinov (QA)».

## Zaxira nusxa

O'rnatish — «Birinchi o'rnatish» 3-qadam (`/etc/insof/backup.env`) va 9-qadam (papka, loglar, logrotate, rclone, birinchi sinov).

`server-backup.sh`: control + har korxona bazasi (`pg_dump -Fc`), har korxona fayllari (tar.gz), SHA256SUMS,
14 kun mahalliy, server tashqarisiga `OFFSITE`: `rclone` | `restic` | `local` (`OFFSITE_DIR` — boshqa disk/mount, nazorat
yig'indisi bilan) | `none`. Vosita o'rnatilmagan yoki sozlanmagan bo'lsa ham mahalliy nusxa olinadi, lekin skript **exit 1**
va ogohlantirish beradi (jim «muvaffaqiyat» yo'q). Biror baza olinmasa — qolganlari olinadi, xabarda ro'yxat.
Telegram sozlanmagan bo'lsa ogohlantirish matni logga `(ALERT)` bilan yoziladi. Bir vaqtda ikki nusxa ishlamaydi (qulf).
`restore-test.sh`: oxirgi nusxaning SHA256SUMS ini tekshiradi, har dump'ni vaqtinchalik bazaga (`insof_restore_*`,
`RESTORE_DB_PREFIX`) tiklaydi, jadval/qator sonlarini tekshiradi, bazani o'chiradi (xato bo'lsa ham); xato — exit 1 + ogohlantirish.

Cron (`crontab -e`, **deploy** ostida):

```cron
30 2 * * *   /var/www/insof-erp/scripts/server-backup.sh >> /var/log/insof-backup.log 2>&1
30 5 * * 0   /var/www/insof-erp/scripts/restore-test.sh  >> /var/log/insof-restore-test.log 2>&1
* * * * *    /var/www/insof-erp/scripts/health-watch.sh  >> /var/log/insof-health.log 2>&1
*/15 * * * * cd /var/www/insof-erp/current && CONTROL_ENV_FILE=/var/www/insof-erp/control.env npm run -s tenant -- stats >> /var/log/insof-stats.log 2>&1
```

Eski `erp-backup` cron qatorini (`/usr/local/bin/erp-backup`, `/var/log/erp-backup.log`) o'chiring.

Tiklash (haqiqiy): `pg_restore --clean --if-exists --no-owner -d "<korxona DATABASE_URL, ?schema siz>" /var/backups/insof/<sana>/<slug>.dump`,
fayllar: `tar -xzf <slug>-uploads.tar.gz -C <UPLOADS_DIR ning ota papkasi>`.

## Kuzatuv

- `scripts/health-watch.sh` (har daqiqa): har yoqilgan korxona va panelning `/api/health` i. Ketma-ket 2 marta
  yiqilsa Telegram'ga xabar, tiklanganda — yana xabar; davom etsa soatda bir eslatma (takrorlanmaydi).
  Qaysi xizmat yoqilganini `systemctl is-enabled` dan oladi; systemd'siz muhitda xato bilan to'xtaydi (`CHECK_ALL=1` —
  barcha `tenants/*.env` + panel).
- `/api/health` — login'siz, 200 `{"ok":true,"version":"<sha>"}` yoki 503; nginx shablonlarida tashqaridan yopiq.
- Panel bosh sahifasi har ochilganda jonli tekshiradi (ERP javobi, baza, ECO `/v1/health`) va kunlik suratni saqlaydi.
- To'xtatilgan korxona: xodimlar veb/mobilda darhol chiqariladi, sabab login sahifasida ko'rinadi; IT kira oladi.

## Monitoring agenti (insof-agent)

Panel serverga tegmaydi (`NoNewPrivileges`, `ProtectSystem=strict`). Serverdagi alohida `insof-agent` xizmati
(`scripts/insof-agent.ts`) metrikalarni yig'adi, tekshiradi va control bazaga yozadi (`HostSnapshot`, `ServiceCheck`,
`Incident`, `AgentHeartbeat`); panel faqat o'qiydi va `AgentAction` navbatiga so'rov qo'yadi. Agent `health-watch.sh`
ning o'rnini bosadi (o'sha cron qatorini o'chiring yoki zaxira sifatida har 5 daqiqaga o'tkazing).

### O'rnatish (bir marta, `deploy` + sudo)

```bash
cd /var/www/insof-erp
bash scripts/deploy.sh                                     # monitoring jadvallari migratsiyasi (control baza) — avval
sudo usermod -aG systemd-journal,adm deploy                # journald (unit xatolari, ssh) va nginx loglari
# sudoers: eski /etc/sudoers.d/insof-deploy ni yangi fayl bilan almashtirish (restart qatorlari ham ichida)
sudo install -m 440 -o root -g root docs/deploy/sudoers-insof-agent /etc/sudoers.d/insof-deploy.new
sudo visudo -cf /etc/sudoers.d/insof-deploy.new && sudo mv /etc/sudoers.d/insof-deploy.new /etc/sudoers.d/insof-deploy
sudo visudo -c && sudo -l -U deploy                        # "parsed OK"; ro'yxatda nginx -t, certbot renew, ufw ...
sudo install -m 644 docs/deploy/insof-agent.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now insof-agent
```
Telegram: `ALERT_TG_BOT_TOKEN` / `ALERT_TG_CHAT_ID` — `control.env` da yoki `/etc/insof/backup.env` da (agent faqat shu
ikki kalit va `OUT_DIR` ni o'qiydi). AI tahlil uchun `ANTHROPIC_API_KEY` — `control.env` da.

Tekshirish:
- `systemctl status insof-agent` → active; `journalctl -u insof-agent -n 30` — `[agent] ishga tushdi: … linux=true, systemd=true`;
- `psql "<control URL>" -c 'SELECT "lastSeenAt", version FROM "AgentHeartbeat"'` — 15 s ichida yangilanadi;
- panel → Monitoring: host grafigi, xizmatlar ro'yxati; «Tekshirish» (RUN_HEALTH_CHECK) → DONE;
- sudo: `sudo -n /usr/sbin/nginx -t` (deploy ostida) parol so'ramasin.

Qaytarish: `sudo systemctl disable --now insof-agent && sudo rm /etc/systemd/system/insof-agent.service`
(jadvallar qoladi, panel «Agent javob bermayapti» ko'rsatadi). `deploy.sh` agent yoqilgan bo'lsa uni har relizdan keyin
qayta ishga tushiradi va yakunda holati + heartbeat yoshini chiqaradi.

### Nima tekshiriladi

| Har | Tekshiruv | Kalit (`ServiceCheck.key`) | WARN / CRIT |
|---|---|---|---|
| 15 s | CPU (`/proc/stat` farqi) | `host:cpu` | ketma-ket 3 namuna ≥ 85% / ≥ 95% |
| 15 s | xotira (`MemTotal − MemAvailable`) | `host:memory` | ≥ 85% / ≥ 95% |
| 15 s | load1 / yadro | `host:load` | ≥ 1.5 / ≥ 3 |
| 15 s | disk `/` va `/var` (statfs) | `host:disk` | ≥ 80% / ≥ 90% |
| 15 s | systemd: har ACTIVE `insof-erp@<slug>`, `insof-control`, `insof-eco`, `nginx`, `postgresql@14-main` (+`AGENT_EXTRA_UNITS`) | `unit:<unit>` | activating/restart oshgan (10 daq) / failed, inactive |
| 15 s | korxona `127.0.0.1:<port>/api/health`, panel `:3100` | `http:tenant:<slug>`, `http:control` | > 2 s yoki eski reliz versiyasi / 503, javob yo'q |
| 15 s | ECO `/v1/health` | `http:eco` | sekin / javob yo'q |
| 15 s | Postgres: ulanishlar/`max_connections`, eng uzun so'rov, baza hajmlari; korxona bazasi bormi | `db:postgres`, `db:tenant:<slug>` | ≥ 80% yoki ≥ 300 s / ≥ 95% yoki ≥ 1800 s; baza yo'q |
| 5 daq | SSL (TLS, servername): korxona domenlari + admin + api | `ssl:<domen>` | < 21 kun / < 7 kun yoki ishonchsiz |
| 5 daq | zaxira: oxirgi `/var/backups/insof/<sana>`, `SHA256SUMS`, `insof-backup.log` oxirgi qatori | `backup:latest` | SHA yo'q / logda xato / > 26 soat |
| 5 daq | journald `-p err` oxirgi 5 daqiqa, har unit | `journal:<unit>` | ≥ 10 / ≥ 50 qator |
| 5 daq | `/var/run/reboot-required` | `host:reboot` | bor (WARN) |
| 5 daq | xavfsizlik moduli (`runSecurityChecks`): ssh, ufw, portlar, sir fayllari, apt, npm audit … | `security:<nom>`, `security:scan` | topilma og'irligi bo'yicha |
| 6 soat | AI tahlil (`runAiAnalysis`) → `SecurityReport` | — | — |

Hamma HostSnapshot 15 s da (CPU, load, xotira, swap, disk, uptime, tarmoq rx/tx B/s, jarayonlar soni, xotira bo'yicha top 5).
Tozalash (soatiga): surat > 7 kun, RESOLVED hodisa > 90 kun, amal > 90 kun, 1 soatdan beri tekshirilmagan kalitlar
(o'chirilgan korxona/domen) — ServiceCheck o'chadi, ochiq hodisasi yopiladi.

**Hodisalar:** WARN → MEDIUM, CRIT → HIGH (korxona/panel/nginx/postgres/baza/disk — CRITICAL). Bir kalit — bitta ochiq hodisa
(`count`, `lastSeenAt` oshadi); ketma-ket **2 marta OK** → avtomatik RESOLVED; UNKNOWN na ochadi, na yopadi. Xavfsizlik:
INFO yoki `detail.status` OK/UNKNOWN hodisa ochmaydi, kalit OK qaytsa (yoki qaytmasa) 2 skanerdan keyin yopiladi;
`source "ai"` hodisalarini AI modul o'zi yuritadi. **Telegram:** yangi HIGH/CRITICAL (monitor — kamida 2 marta ko'rilgan,
ya'ni restart paytidagi bir martalik xato emas) va xabar berilgan hodisaning yopilishi; `notifiedAt` bilan takrorlanmaydi,
soatiga ≤ 30 xabar, matndan sirlar tozalanadi.

### Amallar (panel → AgentAction)

Agent har 3 s da `PENDING` ni atomar oladi (`PENDING → RUNNING`), turini oq ro'yxatdan, parametrlarni regex bilan tekshiradi
(noto'g'ri → `REJECTED`), shell'siz, qat'iy argv va vaqt cheklovi bilan bajaradi; natija — `DONE`/`FAILED`, chiqishning
oxirgi 8 KB i (parol, token, `KEY=…`, URL ichidagi parol yashirilgan). Bir turdagi amal bir vaqtda bittadan, jami ≤ 3.

| Tur | Buyruq |
|---|---|
| `RESTART_UNIT {unit}` | `sudo -n systemctl restart <insof-erp@slug \| insof-control \| insof-eco>` → 60 s gacha unit + /api/health qayta tekshiriladi |
| `RELOAD_NGINX` | `sudo -n nginx -t` → faqat o'tsa `sudo -n systemctl reload nginx` |
| `RUN_BACKUP` | `bash scripts/server-backup.sh` (APP_DIR dan, 3 soat cheklov; muhitga control.env sirlari berilmaydi) |
| `RENEW_CERT` | `sudo -n certbot renew --quiet` → `nginx -t` → reload |
| `FIX_SECRET_PERMS` | `control.env`, `build.env`, `tenants/*.env` → 600, `tenants/` → 700 (sudo'siz), nima o'zgargani hisobotda |
| `BLOCK_IP` / `UNBLOCK_IP {ip}` | `sudo -n ufw insert 1 deny from <ip>` / `ufw delete deny from <ip>` (faqat IPv4; 127.x, 0.x bloklanmaydi) |
| `RUN_HEALTH_CHECK` / `RUN_SECURITY_SCAN` / `RUN_AI_ANALYSIS` | tegishli siklni darhol ishga tushiradi |

Agent qayta ishga tushsa, `RUNNING` qolib ketgan amallar `FAILED` («natija noma'lum») bo'ladi. Bitta nusxa: control bazada
pg advisory lock — ikkinchisi `exit 3` bilan chiqadi.

### Muammolar

| Belgi | Sabab / yechim |
|---|---|
| amal `FAILED`: «a password is required» / «sudoers ruxsati yo'q» | sudoers fayli o'rnatilmagan yoki yo'l boshqa (`command -v certbot`) — yuqoridagi `install` + `visudo -c` |
| `sudo: … no new privileges` | unit'ga `NoNewPrivileges` yoki uni yashirin yoqadigan direktiva qo'shilgan (ro'yxat — unit fayl izohida) |
| `journal:*` hammasi 0 yoki `journalctl xato` | `deploy` `systemd-journal` guruhida emas → `usermod -aG` + `systemctl restart insof-agent` |
| `backup:latest` CRIT «papka yo'q» | `/var/backups/insof` yo'q yoki `OUT_DIR` boshqa (backup.env) |
| `ssl:*` WARN «ulanib bo'lmadi» | DNS hali ulanmagan yoki 443 yopiq; sertifikat muddati — CRIT < 7 kun → «Sertifikatni yangilash» |
| `security:scan` UNKNOWN «modul hali o'rnatilmagan» | `src/lib/control/security` relizda yo'q — kod yangilanishi kerak |
| panel «Agent javob bermayapti» | `systemctl status insof-agent`, `journalctl -u insof-agent -n 80`; baza ulanishi (`CONTROL_DATABASE_URL`) |
| `boshqa insof-agent allaqachon ishlayapti` | qo'lda ishga tushirilgan nusxa bor — `pgrep -af insof-agent` |

Qo'lda (sinov uchun) ishga tushirish: `cd /var/www/insof-erp/current && CONTROL_ENV_FILE=/var/www/insof-erp/control.env node_modules/.bin/tsx scripts/insof-agent.ts`
(xizmat to'xtatilgan bo'lsin — aks holda qulf).

## Baza va trafik (IT panel → «Baza», «Trafik»)

`insof-agent` ning ikki qo'shimcha sikli (`scripts/agent/dbtraffic.ts`, sof mantiq — `src/lib/control/dbtraffic/`).
sudo va root skript KERAK EMAS: baza — `insof` roli bilan (superuser emas), loglar — `adm` guruhi orqali o'qiladi.

| Har | Nima | Kalit | WARN / CRIT |
|---|---|---|---|
| 5 daq | Postgres: har baza hajmi + kunlik/7 kunlik o'sish (tarix `data.history` da, 35 kun), har ma'lum baza (control + korxonalar) ichida eng katta 10 jadval (hajm, qator taxmini, o'lik qator %, oxirgi autovacuum/analyze), o'lik qatorlar ulushi eng yuqori 5 jadval; ulanishlar holat/baza bo'yicha, `max_connections` ga nisbat; uzoq tranzaksiyalar (> 1 daq), uzoq so'rovlar (> 30 s), qulf kutayotganlar (kim to'sayapti); cache hit; `pg_stat_statements` bo'lsa — eng og'ir 10 so'rov | `db:stats` (kind `db`) | 10+ daq «idle in transaction», 1+ daq qulf kutish, cache hit < 90%, jadvalda o'lik qator ≥ 20% va ≥ 10 000 / — |
| 60 s | nginx `access.log` oxirgi 5/60 daqiqa: domen bo'yicha so'rov/daq, 4xx/5xx ulushi, 429, eng sekin yo'llar, eng faol 10 IP; `error.log`: upstream xatolari domen bo'yicha (refused/timeout…), `limit_req` zonalari | `traffic:nginx` (kind `traffic`) | — / 5 daqiqada ≥ 20 so'rov bo'lsa 5xx ≥ 5% WARN, ≥ 20% CRIT |
| 60 s | upstream xatosi bo'lgan har domen (oxirgi 60 daq) | `traffic:upstream:<domen>` | 5 daqiqada ≥ 3 / ≥ 20 xato yoki ≥ 5 «Connection refused» (masalan `files.insof-erp.uz → 127.0.0.1:9010` ishlamayapti). Port korxona/panel/ECO niki bo'lsa hodisada «qayta ishga tushirish» tugmasi |

Shaxsiy ma'lumot chiqmaydi: so'rov matnidagi satr/son literallari `'?'`/`?` ga almashtiriladi va 300 belgigacha
qisqartiriladi; log yo'llarida query string tashlanadi, id/raqam/uuid → `:id`; user-agent, referer saqlanmaydi.
Loglar butun holda o'qilmaydi — fayl oxiridan 256 KB bo'laklab orqaga, 60 daqiqadan eski qatorga yetganda to'xtaydi
(kunlik rotatsiyadan keyin `access.log.1` ham; chegara 512 MB). Katta `data` monitoring SSE oqimiga qo'shilmaydi.

**Amallar** (panelda qayta tasdiq bilan; agent har birini bazadan qayta tekshiradi, natija — `AgentAction.output`):

| Tur | Nima qiladi | Tasdiq so'zi | Cheklov |
|---|---|---|---|
| `PG_CANCEL {db, pid}` | `pg_cancel_backend(pid)` | pid | faqat agent roli (`insof`) ning FAOL so'rovi, shu bazada; boshqa rol (postgres) → `REJECTED` |
| `PG_TERMINATE {db, pid}` | `pg_terminate_backend(pid)` | `TASDIQLAYMAN` | faqat o'z rolining **10 daqiqadan ortiq «idle in transaction»** ulanishi; faol so'rov → `REJECTED` |
| `VACUUM_ANALYZE {db, table?}` | `VACUUM (ANALYZE)` jadval yoki butun baza | baza nomi | `db` — control yoki korxona bazasi; jadval — `public` sxemadagi mavjud nom (`pg_class`), identifikator `format('%I.%I')` bilan; egasi bo'lmasa xato |

Holat tekshiruvi va bajarish bitta SQL da (`… FROM pg_stat_activity WHERE pid=… AND usename=current_user AND state=…`) —
oraliqda pid boshqa jarayonga o'tsa ham noto'g'ri ulanish to'xtatilmaydi. `insof` superuser emas, shuning uchun Postgres
o'zi ham boshqa rollarning jarayonlariga signal yuborishga ruxsat bermaydi.

### O'rnatish / yangilash (bir marta)

```bash
# 1) nginx loglari: deploy adm guruhida (Monitoring agenti o'rnatilganda qilingan bo'lsa — o'tkazib yuboring)
id deploy | grep -q '(adm)' || { sudo usermod -aG adm deploy && sudo systemctl restart insof-agent; }
sudo -u deploy head -c 100 /var/log/nginx/access.log >/dev/null && echo "o'qiydi"

# 2) access.log formatiga $host va $request_time (domen bo'yicha va eng sekin yo'llar uchun; ixtiyoriy, lekin tavsiya)
sudo install -m 644 docs/deploy/nginx-log.conf /etc/nginx/conf.d/insof-log.conf
grep -n 'access_log' /etc/nginx/nginx.conf               # standart qator: access_log /var/log/nginx/access.log;
sudo sed -i 's|^\(\s*\)access_log /var/log/nginx/access.log;|\1# insof-log.conf ga ko'\''chirildi: access_log /var/log/nginx/access.log;|' /etc/nginx/nginx.conf
sudo nginx -t && sudo systemctl reload nginx
tail -n1 /var/log/nginx/access.log                        # oxirida: host=… rt=0.012 urt="0.011"
# Qaytarish: sudo rm /etc/nginx/conf.d/insof-log.conf; nginx.conf dagi izohni olib tashlang; nginx -t && reload

# 3) control.env da TENANT_DATABASE_URL (panel uchun allaqachon bor) — agent korxona bazalariga shu shablon bilan ulanadi.
#    Bo'lmasa tenants/<slug>.env dagi DATABASE_URL ishlatiladi.

# 4) pg_stat_statements (ixtiyoriy; panel O'ZI YOQMAYDI — Postgres qayta ishga tushadi, 5–10 s UZILISH, kam yuklama paytida):
sudo -u postgres psql -c "SHOW shared_preload_libraries"  # bo'sh bo'lmasa — mavjud ro'yxatga vergul bilan qo'shing
sudo -u postgres psql -c "ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements'"
sudo systemctl restart postgresql@14-main
sudo -u postgres psql -d insof_control -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"
sudo -u postgres psql -c "GRANT pg_read_all_stats TO insof"   # boshqa bazalardagi so'rov matnlari ham ko'rinsin
# Qaytarish: DROP EXTENSION pg_stat_statements; ALTER SYSTEM RESET shared_preload_libraries; restart
```
Agent yangi kod bilan `deploy.sh` dan keyin o'zi qayta ishga tushadi. Ixtiyoriy muhit: `AGENT_TRAFFIC_MS` (60000),
`AGENT_NGINX_ACCESS_LOG`, `AGENT_NGINX_ERROR_LOG`.

Tekshirish: panel → «Baza» — bazalar jadvali va «Eng katta jadvallar» to'ladi (5 daq ichida); «Trafik» — 1 daqiqada.
`journalctl -u insof-agent | grep -E 'dbstats|traffic'` — xato bo'lmasin. Sinov: `npx tsx scripts/qa/d-dbtraffic.mts` (lokal).

| Belgi | Sabab / yechim |
|---|---|
| «Trafik»: `access.log: o'qishga ruxsat yo'q` | `deploy` `adm` guruhida emas → 1-qadam |
| domen ustunida faqat `(noma'lum)`, «eng sekin yo'llar» bo'sh | log formatida `$host`/`$request_time` yo'q → 2-qadam |
| «Baza»: korxona bazasi «o'qib bo'lmadi» | `TENANT_DATABASE_URL` yo'q/noto'g'ri yoki `tenants/<slug>.env` o'qilmaydi |
| `PG_CANCEL` → `REJECTED` «boshqa rol» | jarayon `postgres` yoki boshqa rolniki — serverda `sudo -u postgres psql -c "SELECT pg_cancel_backend(<pid>)"` |
| `VACUUM_ANALYZE` → «jadval egasi bu rol emas» | jadval boshqa rol yaratgan — `sudo -u postgres vacuumdb -z -t '"Jadval"' <baza>` |

## Go-live ro'yxati (tartib bilan)

1. **Server:** `docs/server-xavfsizlik.md` 3.1–3.5 (3000/3010 yopiq, SSH faqat kalit, fail2ban, avtomatik yangilanish, Postgres faqat localhost).
2. **Lokal sinov** (Mac'da, deploydan oldin): `scripts/qa/d-run-all.sh` — hammasi PASS («Lokal sinov (QA)»).
3. **«Birinchi o'rnatish (insof)»** 0–7-qadamlar: qo'lda zaxira, paketlar, control baza, sozlama fayllari (ildizda `.env` QOLMASIN,
   hammasi `chmod 600`), birinchi reliz, superadmin + ro'yxat + SSO kaliti, panel, insof'ni `insof-erp@insof` ga o'tkazish.
4. **systemd:** `journalctl -u insof-erp@insof -n 50 | grep -i eacces` — bo'sh bo'lsin (ProtectSystem=strict).
5. **nginx** (8-qadam): `insof-limits.conf`, korxona va panel saytlari yangi shablonlardan; `nginx -t`. Mac'dan 429 sinovi (server-xavfsizlik.md 3.4).
6. **IT panel:** `https://admin.insof-erp.uz` faqat kerakli IP'lardan (nginx-control.conf → `allow`/`deny`), superadmin paroli kuchli.
7. **SSO:** har korxonada `CONTROL_SSO_KEY` (global `CONTROL_SECRET` yo'q); paneldan «Kirish (IT)» ishlashini sinang.
8. **Telegram webhook** har bot bor korxona uchun (`ENV_FILE=... npm run bot:webhook -- https://<domen>`), `npm run bot:webhook` holati — xatosiz.
9. **Demo/test ma'lumot yo'qligini tekshirish** (insof bazasida, `psql "<insof DATABASE_URL, ?schema siz>"`):
   ```sql
   -- test va seed loginlari (bo'sh bo'lishi shart; admin — faqat haqiqiy direktor bo'lsa va paroli almashtirilgan bo'lsa)
   SELECT login, role, "isActive" FROM "User"
    WHERE login LIKE 'test.%'
       OR login IN ('admin','sotuv1','prod1','log1','sklad1','prorab1','buh1','hr1','kassa1');
   -- seed namunaviy mijoz va yetkazuvchilar (INN 30123456x / 20098765x)
   SELECT id, name, inn FROM "Customer" WHERE inn LIKE '30123456%';
   SELECT id, name, inn FROM "Supplier" WHERE inn LIKE '20098765%';
   -- demo-data.ts yozuvlari ([demo] belgisi)
   SELECT count(*) AS demo_zayavka FROM "Order" WHERE note LIKE '[demo]%';
   -- seed mikserlari
   SELECT plate FROM "Vehicle" WHERE plate IN ('01D321GH','01H654JK');
   ```
   Topilsa: test loginlar — `ALLOW_DEMO=yes-i-know npm run db:test-users -- --remove`; demo — `ALLOW_DEMO=yes-i-know npm run db:demo -- --remove`
   (har ikkalasi `ENV_FILE=/var/www/insof-erp/tenants/insof.env` bilan, `current/` dan); qolganini qo'lda yoki to'liq tozalash (README → «Birinchi direktor hisobi»).
   Keyin: `ENV_FILE=/var/www/insof-erp/tenants/insof.env npm run security:check` — standart parollar (admin123, parol123) qolmagan bo'lsin.
10. **Zaxira va kuzatuv** (9-qadam): `/etc/insof/backup.env` (rclone masofa + Telegram), `server-backup.sh` → `restore-test.sh` qo'lda
    `exit 0`, cron qatorlari, logrotate. Telegram sinov xabari: `health-watch.sh` ishlayotganda bitta xizmatni to'xtatib ko'ring.
11. **Yakuniy** (10-qadam): `bash scripts/deploy.sh` (to'liq, restart bilan) xatosiz; `curl -s 127.0.0.1:3000/api/health` → `ok:true`; Mac'dan
    `curl -sI https://insof-erp.uz/api/health` → 403 (tashqaridan yopiq).

## Lokal sinov (QA)

Platformani serverga chiqarishdan oldin Mac'da to'liq sinash (`scripts/qa/d-*`). Faqat lokal Postgres va `insof_test_` bazalari
(`insof_test_ctl`, `insof_test_t_<slug>`, `insof_test_restore_*`), portlar 3204 (panel), 3205+ (korxonalar); serverdagi papkalar
o'rniga `D_ROOT` (masalan `/tmp/insof-qa-d`). Panel test rejimida (`INSOF_ENV=test`) bo'lgani uchun u yaratgan korxonalar
ham test rejimida va `insof_test_t_` prefiksli bazada (prodda test rejimi yoqilmaydi — server real kalit yoki test bo'lmagan
baza bilan ishga tushmaydi).

```bash
D_ROOT=/tmp/insof-qa-d bash scripts/qa/d-run-all.sh        # sozlash → deploy (DRY_RUN) → HTTP → zaxira → kuzatuv → tozalash
```

| Skript | Nima |
|---|---|
| `d-setup.sh` | control.env/build.env/backup.env, `insof_test_ctl` + `control:migrate`, superadminlar (`control:admin`), «alfa» (`provisionTenant`) |
| `d-deploy-test.sh first\|fail <ref>\|rollback\|again\|migfail\|guard` | `deploy.sh` `DRY_RUN=1`: build, migratsiya, symlink, health; buzuq reliz → avtomatik qaytarish; `ROLLBACK=1`; build qayta ishlatish; yo'q baza; himoyalar |
| `d-platform.ts` | panel login/qulf, «beta» panel formasi orqali, SSO (takror, boshqa korxona, muddati o'tgan, soxta aud), direktor va IT hisobi, izolyatsiya, to'xtatish, statistika |
| `d-backup-test.sh` | `server-backup.sh` (rclone/restic yo'q → exit 1, `OFFSITE=local`, yo'q baza, qulf) va `restore-test.sh` (butun, bitta, buzilgan) |
| `d-health-test.sh` | `health-watch.sh`: korxona yiqilishi, ogohlantirish chegarasi, takrorlanmaslik, tiklanish |
| `d-agent.mts` | insof-agent: parserlar/chegaralar/hodisa/amal tekshiruvi (unit) + lokal integratsiya (`insof_test_ctl_agent`) |
| `d-svc.sh` | systemd o'rnida `next start` (deploy'ning `RESTART_CMD`) |
| `d-cleanup.sh` | jarayonlar, test bazalari, `D_ROOT` ni o'chiradi |
