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
(SMS, Telegram, ECO) boshqa korxonalarga «sizadi». Kod `releases/<sha>` dan ishlagani uchun barcha yo'llar
(`TENANTS_DIR`, `UPLOADS_DIR`, `APK_PATH`) **mutlaq** yozilsin.

## Birinchi o'rnatish (bir marta)

```bash
# 1. Control baza
sudo -u postgres psql -c "CREATE DATABASE insof_control OWNER insof"
sudo -u postgres psql -c "ALTER ROLE insof CREATEDB"          # panel yangi korxona bazasini o'zi yaratadi

# 2. Sozlamalar
cd /var/www/insof-erp
cp docs/deploy/control.env.example control.env && chmod 600 control.env && nano control.env
cp build.env.example build.env && chmod 600 build.env && nano build.env   # NEXT_PUBLIC_YANDEX_MAPS_KEY, DATABASE_URL, APP_URL

# 3. Birinchi reliz (build + barcha bazalarga migratsiya + current symlink; xizmatlarga tegmaydi)
SKIP_RESTART=1 bash scripts/deploy.sh

# 4. Birinchi superadmin (parol so'raladi)
cd /var/www/insof-erp/current && CONTROL_ENV_FILE=/var/www/insof-erp/control.env npm run control:admin -- otabek "Otabek Ikromov"

# 5. Panel xizmati + nginx (admin.insof-erp.uz → 127.0.0.1:3100)
sudo install -m 644 docs/deploy/insof-control.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now insof-control
sudo install -m 644 docs/deploy/nginx-limits.conf /etc/nginx/conf.d/insof-limits.conf
sudo install -m 644 docs/deploy/nginx-control.conf /etc/nginx/sites-available/insof-control
sudo ln -sf /etc/nginx/sites-available/insof-control /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx -d admin.insof-erp.uz --redirect
```

## Mavjud Insof'ni platformaga ko'chirish

```bash
cd /var/www/insof-erp
mkdir -p tenants && mv .env tenants/insof.env && chmod 600 tenants/insof.env
# tenants/insof.env ga qo'shing / tekshiring:
#   PORT=3000
#   TENANT_SLUG=insof
#   UPLOADS_DIR=/var/www/insof-erp/uploads                     # eski fayllar joyida qoladi (MUTLAQ yo'l)
#   APK_PATH=/var/www/insof-erp/uploads/app/insof-eco.apk
#   CONTROL_SSO_KEY=<pastdagi sso-key natijasi>                 # CONTROL_SECRET EMAS
#   NEXT_PUBLIC_YANDEX_MAPS_KEY — build.env ga ko'chiring (bu yerda ta'siri yo'q)

SKIP_RESTART=1 bash scripts/deploy.sh                      # releases/<sha> + current; eski xizmat ishlashda davom etadi

cd /var/www/insof-erp/current
export CONTROL_ENV_FILE=/var/www/insof-erp/control.env
npm run -s tenant -- sso-key insof                         # → CONTROL_SSO_KEY=... ni tenants/insof.env ga yozing
npm run tenant -- register --slug insof --name "Insof beton" --db insof_erp --port 3000 --domain insof-erp.uz
cd /var/www/insof-erp

sudo systemctl disable --now insof-erp                     # eski yagona xizmat (WorkingDirectory repo ildizida edi)
sudo bash scripts/tenant-up.sh insof                       # endi insof-erp@insof (current/ dan, port 3000)
```

Eski xizmat to'xtashi va yangisi ko'tarilishi orasida bir necha soniya uzilish bo'ladi — ishdan tashqari vaqtda qiling.

Eski nginx sayt fayli (`/etc/nginx/sites-available/insof-erp`) ni `docs/deploy/nginx-tenant.conf` asosida yangilang
(X-Real-IP, limit_req, 16m) yoki `sudo bash scripts/tenant-up.sh insof insof-erp.uz` bilan qayta yarating
(certbot 443 qismini qayta qo'shadi).

Skriptlar korxona fayli bilan: `cd /var/www/insof-erp/current && ENV_FILE=/var/www/insof-erp/tenants/insof.env npm run eco:sync`.

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
2. `prisma migrate deploy` — control baza va **har** `tenants/*.env` bazasi. Xato bo'lsa — almashtirilmaydi.
3. `current` symlink atomar almashadi.
4. Yoqilgan `insof-erp@*` va `insof-control` bittadan qayta ishga tushadi, har biri `127.0.0.1:<port>/api/health` = 200
   bo'lishini kutadi (60 s). Biri o'tmasa — `current` oldingi relizga qaytadi, qayta ishga tushirilganlar qaytariladi, exit 1.
5. Oxirgi 3 reliz saqlanadi (`KEEP_RELEASES`).

Qo'lda qaytarish: `ROLLBACK=1 bash scripts/deploy.sh`. **Migratsiyalar qaytmaydi** — sxema o'zgarishlari
«kengaytiruvchi» bo'lsin (ustun qo'shish; eski ustunni o'chirish keyingi relizda), shunda oldingi kod yangi bazada ishlaydi.

Repodagi `docs/deploy/*.service` o'zgarsa deploy ogohlantiradi: `sudo install -m 644 docs/deploy/<unit> /etc/systemd/system/ && sudo systemctl daemon-reload`.

## Zaxira nusxa

```bash
sudo install -d -m 750 -o root -g deploy /etc/insof
sudo install -m 640 -o root -g deploy docs/deploy/backup.env.example /etc/insof/backup.env && sudo nano /etc/insof/backup.env
sudo install -d -m 750 -o deploy -g deploy /var/backups/insof
for f in backup restore-test health stats; do sudo install -o deploy -g deploy -m 640 /dev/null /var/log/insof-$f.log; done
sudo install -m 644 docs/deploy/logrotate-insof /etc/logrotate.d/insof
# rclone: deploy ostida `rclone config` → masofa (B2/S3/...), backup.env da RCLONE_REMOTE=...
bash scripts/server-backup.sh && bash scripts/restore-test.sh      # birinchi qo'lda sinov
```

`server-backup.sh`: control + har korxona bazasi (`pg_dump -Fc`), har korxona fayllari (tar.gz), SHA256SUMS,
14 kun mahalliy, rclone/restic bilan server tashqarisiga; xato bo'lsa Telegram + exit 1.
`restore-test.sh`: oxirgi nusxani vaqtinchalik bazaga tiklaydi, jadval/qator sonlarini tekshiradi, bazani o'chiradi.

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
- `/api/health` — login'siz, 200 `{"ok":true,"version":"<sha>"}` yoki 503; nginx shablonlarida tashqaridan yopiq.
- Panel bosh sahifasi har ochilganda jonli tekshiradi (ERP javobi, baza, ECO `/v1/health`) va kunlik suratni saqlaydi.
- To'xtatilgan korxona: xodimlar veb/mobilda darhol chiqariladi, sabab login sahifasida ko'rinadi; IT kira oladi.

## Go-live ro'yxati (tartib bilan)

1. **Server:** `docs/server-xavfsizlik.md` 3.1–3.5 (3000/3010 yopiq, SSH faqat kalit, fail2ban, avtomatik yangilanish, Postgres faqat localhost).
2. **Zaxira nusxa — o'zgarishlardan OLDIN:** joriy bazaning qo'lda nusxasi: `pg_dump -Fc "<URL>" -f ~/insof-oldin.dump`.
3. **Sozlamalar:** `control.env`, `build.env`, `tenants/insof.env` (yuqoridagi «ko'chirish»); ildizda `.env` QOLMASIN; barcha fayllar `chmod 600`.
4. **Birinchi reliz:** `SKIP_RESTART=1 bash scripts/deploy.sh`.
5. **systemd:** `sudo install -m 644 docs/deploy/insof-erp@.service docs/deploy/insof-control.service /etc/systemd/system/ && sudo systemctl daemon-reload`;
   eski `insof-erp` xizmatini o'chirish; `sudo bash scripts/tenant-up.sh insof insof-erp.uz`; panel (`insof-control`).
   `journalctl -u insof-erp@insof -n 50 | grep -i eacces` — bo'sh bo'lsin (ProtectSystem=strict).
6. **nginx:** `insof-limits.conf`, korxona va panel saytlari yangi shablonlardan; `nginx -t`. Mac'dan 429 sinovi (server-xavfsizlik.md 3.4).
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
10. **Zaxira va kuzatuv:** `/etc/insof/backup.env` (rclone masofa + Telegram), `server-backup.sh` → `restore-test.sh` qo'lda muvaffaqiyatli,
    cron qatorlari, logrotate. Telegram sinov xabari: `health-watch.sh` ishlayotganda bitta xizmatni to'xtatib ko'ring.
11. **Yakuniy:** `bash scripts/deploy.sh` (to'liq, restart bilan) xatosiz; `curl -s 127.0.0.1:3000/api/health` → `ok:true`; Mac'dan
    `curl -sI https://insof-erp.uz/api/health` → 403 (tashqaridan yopiq).
