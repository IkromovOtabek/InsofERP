# Insof platforma — ko'p korxonali tuzilma

```
                 admin.insof-erp.uz  ──►  insof-control (3100, INSOF_MODE=control)
                                             │  control baza: korxonalar, superadminlar, jurnal, kunlik statistika
                                             │  korxona bazalariga to'g'ridan-to'g'ri (yaratish, direktor, statistika)
                                             │  SSO: CONTROL_SECRET bilan imzolangan 60 s token
          ┌──────────────────────────────────┼───────────────────────────────┐
  insof-erp.uz → :3000              sharq.insof-erp.uz → :3101          zavod3… → :3102
  insof-erp@insof                   insof-erp@sharq                     insof-erp@zavod3
  baza insof_erp                    baza insof_t_sharq                  baza insof_t_zavod3
  uploads/insof                     /var/lib/insof/sharq/uploads        …
```

Kod bitta (bitta `npm run build`), har korxona — o'z jarayoni, o'z bazasi, o'z `.env` i
(`tenants/<slug>.env`: AUTH_SECRET, ECO/AI/Telegram kalitlari alohida). Ma'lumot hech qachon aralashmaydi.

## Rollar

| Kim | Qayerda | Nima qiladi |
|---|---|---|
| **IT superadmin** | admin domeni, `/superadmin` | korxona yaratadi, direktorga login/parol beradi, to'xtatadi/yoqadi, barcha korxonalar statistikasi va holati (ERP, baza, ECO), istalgan korxonaga «Kirish (IT)» — ichkarida direktor huquqi |
| **Direktor** | korxona domeni | xodimlarga login/parol beradi (Sozlamalar → Foydalanuvchilar, Otdel kadr), ruxsatlar |
| **Xodim** | korxona domeni / mobil | o'z roli va direktor bergan ruxsat bo'yicha |

IT korxona ichida `it.<login>` hisobi bilan ko'rinadi: direktor uni ro'yxatda ko'rmaydi va o'zgartira olmaydi,
lekin har kirishi korxona audit jurnaliga yoziladi. Bu hisobga parol bilan kirib bo'lmaydi.

## Birinchi o'rnatish (bir marta)

```bash
# 1. Control baza
sudo -u postgres psql -c "CREATE DATABASE insof_control OWNER insof"
sudo -u postgres psql -c "ALTER ROLE insof CREATEDB"          # panel yangi korxona bazasini o'zi yaratadi

# 2. Panel sozlamasi
cd /var/www/insof-erp
cp docs/deploy/control.env.example control.env && chmod 600 control.env && nano control.env
set -a; . ./control.env; set +a
npx prisma migrate deploy --schema prisma/control/schema.prisma
npm run build

# 3. Birinchi superadmin (parol so'raladi)
npm run control:admin -- otabek "Otabek Ikromov"

# 4. Panel xizmati + nginx (admin.insof-erp.uz → 127.0.0.1:3100)
sudo cp docs/deploy/insof-control.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now insof-control
```

## Mavjud Insof'ni platformaga ko'chirish

**Muhim:** Next.js ishchi papkadagi `.env` ni har jarayonga avtomatik yuklaydi. Ildizda `.env` qolsa,
uning kalitlari (SMS, Telegram, ECO) yangi korxonalarga «sizib» o'tadi. Shuning uchun:

```bash
cd /var/www/insof-erp
mkdir -p tenants && mv .env tenants/insof.env && chmod 600 tenants/insof.env
# tenants/insof.env ga qo'shing:
#   PORT=3000
#   TENANT_SLUG=insof
#   CONTROL_SECRET=<control.env dagi bilan bir xil>
#   UPLOADS_DIR=/var/www/insof-erp/uploads      # eski fayllar joyida qoladi
npm run tenant -- register --slug insof --name "Insof beton" --db insof_erp --port 3000 --domain insof-erp.uz

sudo systemctl disable --now insof-erp                     # eski yagona xizmat
sudo bash scripts/tenant-up.sh insof                       # endi insof-erp@insof (port 3000, nginx o'zgarmaydi)
```

Skriptlar (bot, eco:sync) korxona fayli bilan: `ENV_FILE=tenants/insof.env npm run eco:sync`.

## Yangi korxona

1. Panel → «Yangi korxona»: nomi, qisqa nom (`sharq`), domen, direktor F.I.O./login/parol → baza + jadvallar + direktor + `tenants/sharq.env`.
2. DNS: `sharq.insof-erp.uz` → server IP.
3. Serverda: `sudo bash scripts/tenant-up.sh sharq sharq.insof-erp.uz` (systemd, nginx, SSL).
4. Panelda «Tekshirish» → holat «Faol». Direktorga manzil va login/parolni bering.

## Yangilash

`bash scripts/deploy.sh` — `control.env` bo'lsa: control migratsiya → **barcha** korxona bazalariga migratsiya →
panel va har `insof-erp@*` qayta ishga tushadi → `npm run tenant -- stats` bilan tekshiruv.

## Kuzatuv

- Panel bosh sahifasi har ochilganda jonli tekshiradi (ERP javobi, baza, ECO `/v1/health`) va kunlik suratni saqlaydi.
- Cron uchun: `*/15 * * * * cd /var/www/insof-erp && npm run -s tenant -- stats >> /var/log/insof-stats.log`
- To'xtatilgan korxona: xodimlar veb/mobilda darhol chiqariladi, sabab login sahifasida ko'rinadi; IT kira oladi.
