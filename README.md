# Insof ERP — beton zavodi boshqaruv tizimi

Tayyor beton (BSG) ishlab chiqaruvchi zavod uchun ichki ERP. Bitta Next.js ilova: UI + server actions + PostgreSQL.

## Ishga tushirish

```bash
cp .env.example .env        # DATABASE_URL va AUTH_SECRET ni to'g'rilang
npm install
npx prisma migrate deploy   # jadvallarni yaratadi
npm run db:seed             # admin / admin123 (Direktor), namuna xomashyo, markalar, M300 retsepti
npm run dev
```

Postgres lokal bo'lmasa: `docker compose up -d db` (foydalanuvchi/parol: postgres/postgres).

## Sahifalar

- `/` — mijozlar uchun ommaviy landing (zavod haqida, markalar, sifat, aloqa). Rekvizitlar va "Zavod haqida" matni Sozlamalar → Zavod rekvizitlari'dan olinadi.
- `/login` — xodimlar kirishi
- `/dashboard` va qolgan hammasi — ERP (login talab qiladi)
- `/verify/<nakladnoy>` — QR orqali ommaviy tekshiruv
- `/bi-tahlil/ai/telegram` — Telegram bot: hisobni ulash, ulangan chatlar, savollar jurnali
- `/orders` — **Zayavkalar**: faqat qabul qilinmagan (qoralama, bloklangan, bekor). Yangi zayavka shu yerda ochiladi.
- `/sales` — **Sotuv**: qabul qilingan zayavkalar (tasdiqlangan → ishlab chiqarish → yetkazildi → yopildi), to'lov holati va pastda sklad surati.

## Asosiy oqim

```
Zayavka (DRAFT, /orders) → Qabul qilish → kredit limit tekshiruvi → CONFIRMED (Sotuv, /sales) yoki BLOCKED (direktor ochadi)
  → Zames (retsept bo'yicha xomashyo skladdan avtomatik chiqadi) → IN_PRODUCTION
  → Reys / nakladnoy (QR) → Yuklandi → Yo'lda → Yetkazildi → DELIVERED
  → Schyot → To'lov (kassa/bank) → CLOSED
```

### Mijoz, kredit limit va qora ro'yxat

- Zayavka formasida mijoz qidirib tanlanadi yoki **"Yangi mijoz"** rejimida shu yerning o'zida ochiladi (zayavka bilan bitta tranzaksiyada saqlanadi).
- Har bir mijozga standart **100 000 000 so'm** limit (`DEFAULT_CREDIT_LIMIT`, `src/lib/finance.ts`). Finance/direktor o'zgartira oladi.
- Ishlatilgan limit = ochiq schyotlar bo'yicha qarz + schyot yozilmagan tasdiqlangan zayavkalar. Bo'sh limit = limit − ishlatilgan.
- Bo'sh limit ≤ 0 bo'lsa mijoz **qora ro'yxatda** (`customerCredit().blacklisted`) — saqlanmaydi, har safar hisoblanadi, qarz to'lansa avtomatik chiqadi.
  Qora ro'yxatdagi mijozga yangi zayavka ochilmaydi; Mijozlar sahifasida alohida tab.
- Qabul qilishda ishlatilgan + shu zayavka > limit bo'lsa zayavka BLOCKED — faqat direktor ochadi.

### Brigadalar, topshiriqlar, dastavka, zarur, kafolat xati

- **Brigadalar** (`/brigades`, Ishlab chiqarish/HR): nomi, brigadir (Xodimlar ro'yxatidan), telefon.
- Zayavka formasida (sotuv): yetkazish sanasi **va soati** (`deliveryTime`, "HH:MM", majburiy — ro'yxatlar, ishlab chiqarish, topshiriqlar va kafolat xatida ko'rinadi), "Dastavka kerak" (`needsDelivery`), "Zarur" (`isUrgent`), to'lov turi "Oldindan / Qarzga" (`onCredit`). Brigada sotuvda tanlanmaydi.
- **Brigada tayinlash** — Ishlab chiqarish oynasining o'zida (`/production`): saqlangan zayavkalar (qoralama, tasdiqlangan, ishlab chiqarilmoqda)
  ro'yxati, har birida yashil "Brigada tayinlangan" (ptichka) yoki qizil "Brigada tayinlanmagan" belgisi. "Tayinlash" bosilsa forma shu oynada
  (`/production?order=<id>`) ochiladi; har mahsulot qatoriga brigada tanlanib **"Tasdiqlash — brigadalarga yuborish"** bosilgandagina
  **topshiriq** (`BrigadeTask`, T-YYYY-00001) yaratiladi va `/tasks` ga tushadi. Brigada tanlanmagan qatorlar qizil holatda qoladi.
- Ishlab chiqarish oynasida filtrlar (`?tab=`): Ochiq, Bugungilar, Muddati yaqin, Brigada kutayotgan, Zarur, Tugallanganlar, Hammasi (soni bilan).
  Yetkazishga ≤ 2 kun qolgan ochiq zayavkalar qizil fon bilan ro'yxat tepasida ("Bugun", "Ertaga", "N kun qoldi", "N kun kechikdi").
  "Tugallangan" = yetkazildi/yopildi yoki barcha topshiriqlar bajarilgan.
  Ishlab chiqarish/logistika bajarilgan miqdorni kiritadi (`TaskProgress`), qoldiq = topshiriq − bajarilgan; to'liq bo'lsa DONE.
  Zayavka bekor qilinsa ochiq topshiriqlar ham bekor bo'ladi. Zarur zayavkalar ro'yxatda birinchi.
- **Kafolat xati** (`/orders/<id>/guarantee`): qarzga zayavka uchun A4 chop etiladigan xat — mijoz rekvizitlari bazadan,
  muddat, penya, imzo, muhr kataklari bo'sh (mijoz qo'lda to'ldiradi). Sotuv xodimi imzolangan xat kelganda "qabul qilindi" belgisini qo'yadi (`guaranteeAt`).

### Kirim-Chiqim (`/cashflow`)

Pul oqimi jurnali: mijoz to'lovlari (`Payment`) avtomatik kirim sifatida, boshqa kirimlar va barcha chiqimlar `CashTransaction` da
(kategoriya, kimdan/kimga, yetkazuvchi, hisob). Davr va hisob bo'yicha filtr, chiqimlar kategoriya kesimi, hisob qoldiqlari = to'lovlar + kirim − chiqim.
Kategoriyalar ro'yxati: `src/app/(app)/cashflow/categories.ts`.

### Sotuvchi uchun sklad ma'lumoti

Sotuvchi mijoz bilan gaplashganda sklad xodimi kiritgan raqamlarga tayanadi: `/sales` va `/orders/new` sahifalarida
**Sklad holati** paneli (dona mahsulot erkin/band, tayyor beton, xomashyo) va har qatorda oxirgi kirimni **kim, qachon** kiritgani.
SALES roli `/stock` va `/receipts` ni faqat ko'radi; `GoodsReceipt.createdById` — kirimni kiritgan xodim.

## Mahsulot birligi va Astatka

`Product.unit` — `m3` bo'lsa tayyor beton (saqlanmaydi, zames → mikser → obyekt). `dona`/`m2`/`m` bo'lsa hovlida turadigan tayyor mahsulot (ustun, FBS blok, bordyur, plitka). Retsept va zames miqdori shu birlikka nisbatan (`qtyM3` maydoni dona mahsulotda "dona"ni bildiradi — nomi tarixiy).

**Astatka** (`/astatka`, `src/lib/ostatka.ts`): dona mahsulotlar qoldig'i.
- Jami = `StockMove` (PRODUCTION_OUTPUT − SHIPMENT)
- Egasi bor = tasdiqlangan (`CONFIRMED`/`IN_PRODUCTION`) zayavkalardagi hali jo'natilmagan miqdor
- Egasi yo'q = jami − egasi bor; Yetishmaydi = band > jami
- Mahsulot sahifasi: kimga band (zayavka, mijoz, telefon, sana), partiyalar, harakat tarixi

## Rollar va xodimlar

`DIRECTOR` — yagona to'liq huquqli rol (sozlamalar, bloklarni ochish, hamma bo'lim). Qolganlari: `SALES`, `PRODUCTION`, `LOGISTICS`, `WAREHOUSE`, `PROCUREMENT`, `ACCOUNTING`, `FINANCE`, `HR`, `CASHIER`.

Ruxsat uch qatlamda tekshiriladi:
1. **Menyu** — `src/lib/nav.ts` (rolga mos bo'limlar ko'rinadi)
2. **Sahifa** — `src/middleware.ts` (URL to'g'ridan-to'g'ri ochilsa `/?denied=1` ga qaytaradi)
3. **Amal** — har bir server action'da `requireSession([...])`

**Sozlamalar** (faqat direktor): zavod rekvizitlari, beton markalari, xomashyo, skladlar, kassa/hisoblar, foydalanuvchilar, audit jurnali.

Xodim qo'shishda (**Xodimlar** sahifasi) bo'lim lavozimi tanlansa (Sotuv, Ishlab chiqarish, Logistika, Buxgalteriya, Finance, Otdel kadr, Sklad, Snabjeniye, Kassa/bank, Direktor) login/parol so'raladi va mos rolli foydalanuvchi yaratiladi (`src/lib/positions.ts`). Xodim o'chirilsa logini ham bloklanadi. Login berish — faqat Otdel kadr yoki direktor.

## UI dizayn tizimi

- **Tokenlar** — `src/app/globals.css` (`@theme`): brend rang `brand-*` (amber), `ink-*` (to'q fon), soyalar, radius. Shrift — Inter (`next/font`).
- **Primitivlar** — `src/components/ui/index.tsx`: `PageHeader`, `Card`/`CardHeader`/`Section`, `StatCard`, `Button`/`LinkButton`/`IconButton`, `Field`/`Input`/`Select`/`Textarea`/`Checkbox`, `FormError`/`FormActions`, `Badge`, `Tabs`, `StatusSteps`, `Table`/`Th`/`Td`/`Tr`/`Empty`, `EmptyState`, `Callout`, `DL`, `Progress`, `Avatar`.
- **Qobiq** — `src/components/app-shell.tsx`: guruhlangan navigatsiya (Sotuv / Ishlab chiqarish / Logistika / Sklad / Moliya / Boshqaruv), mobil drawer, topbar.
- **Qoidalar:** yangi sahifa faqat shu primitivlardan quriladi; ro'yxatlar `Table`+`Tr`, filtrlar `Tabs`, ko'rsatkichlar `StatCard`, holat oqimi `StatusSteps`, formalar `Field` + `FormActions`. Ad-hoc Tailwind klasslari bilan yangi "kartochka" yasalmaydi.

## Muhim dizayn qarorlari

- **`StockMove` — yagona o'zgarmas sklad jurnali.** Qoldiq alohida saqlanmaydi, har doim `SUM(qty)`. Kirim (+), zames chiqimi (−), tayyor beton (+), jo'natish (−).
- **Retsept versiyalanadi** — eski versiya o'chirilmaydi, zames qaysi versiyada qilinganini eslab qoladi.
- **Pul `Decimal(18,2)`, miqdor `Decimal(18,3)`** — `float` yo'q.
- **Hujjatlar o'chirilmaydi** — faqat holat o'zgaradi (`CANCELLED`), hammasi `AuditLog`ga tushadi.
- **Ikonkalar faqat `lucide-react`** — emoji ishlatilmaydi. Menyu ikonkalari `src/components/sidebar.tsx` da.
- **Hamma matn o'zbek (lotin)** — enum'lar UI'da label orqali ko'rsatiladi (`*/status.tsx`, `ROLE_LABELS`, settings'dagi `ACTION_LABEL`/`ENTITY_LABEL`).
- **Raqam/sana formatlash Intl'siz** (`src/lib/format.ts`) — server va brauzer bir xil natija berishi uchun.
- Hujjat raqamlari: `Z-2026-00001` (zayavka), `ZM-` (zames), `N-` (nakladnoy), `K-` (kirim), `S-` (schyot).

## Sxema o'zgartirish (migratsiya)

`prisma migrate dev` interaktiv terminal talab qiladi. Terminalsiz muhitda:

```bash
D=prisma/migrations/$(date +%Y%m%d%H%M%S)_nomi && mkdir -p $D
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://otabek@localhost:5432/insof_erp_shadow" --script > $D/migration.sql
npx prisma migrate deploy && npx prisma generate
```

Prisma klient yangilangach dev serverni qayta ishga tushiring (eski klient keshda qoladi).

## Tuzilma

```
prisma/schema.prisma        ma'lumotlar modeli
prisma/seed.ts              boshlang'ich ma'lumotlar
src/lib/auth.ts             sessiya (JWT cookie), requireSession
src/lib/stock.ts            qoldiq hisoblash
src/lib/finance.ts          debitorka, ochiq zayavkalar
src/lib/numbering.ts        hujjat raqamlari
src/lib/positions.ts        lavozim → rol
src/lib/company.ts          zavod rekvizitlari (bitta qator)
src/components/row-form.tsx sozlamalardagi spravochnik formalari
src/app/page.tsx            ommaviy landing
src/lib/dashboard.ts        mikserlar holati, xomashyo kunlari, bugungi reyslar
src/lib/ostatka.ts          tayyor mahsulot qoldig'i (egasi bor / yo'q)
src/lib/unit.ts             mahsulot birligi yordamchilari
src/components/ui/          dizayn tizimi primitivlari
src/components/app-shell.tsx ilova qobig'i (sidebar, mobil drawer, topbar)
src/app/(app)/<modul>/      page.tsx + actions.ts + *-form.tsx
src/app/verify/[noteNo]     ommaviy QR tekshiruv sahifasi (login shart emas)
```

## Telegram bot (ovozli savol → AI javob)

Telegramga **ovozli xabar** yuborasiz — bot uni matnga o'giradi, savolni Insof AI dvigateliga beradi
va ERP raqamlari asosida javob qaytaradi. Matn bilan yozish ham ishlaydi.

```
ovozli xabar → STT (uzbekvoice.ai / Whisper) → matn → aiAnswer (+Claude) → javob
```

### Sozlash

1. Telegramda [@BotFather](https://t.me/BotFather) → `/newbot` → tokenni oling
2. `.env` ga qo'shing:

```bash
TELEGRAM_BOT_TOKEN="123456:AA..."      # majburiy
GROQ_API_KEY="gsk_..."                  # ovoz → matn, bepul tarif (yoki MOHIR_API_KEY / OPENAI_API_KEY)
ANTHROPIC_API_KEY="..."                 # ixtiyoriy: erkin savollarga Claude javobi
APP_URL="https://erp.domen.uz"          # javobdagi havolalar uchun
TELEGRAM_WEBHOOK_SECRET="tasodifiy-satr" # webhook rejimida
```

3. Ishga tushiring:

```bash
npm run bot                              # lokal: long polling (webhook shart emas)
npm run bot:webhook -- https://erp.domen.uz   # serverda: webhook o'rnatish
npm run bot:webhook                      # holatni ko'rish, `-- delete` — o'chirish
```

### Ovoz → matn provayderi

Kalit qaysi biriga berilgan bo'lsa o'sha ishlaydi (tanlov tartibi: mohir → groq → openai;
`STT_PROVIDER` bilan majburlash mumkin):

| Provayder | Kalit | Narx | Izoh |
|---|---|---|---|
| Groq · Whisper large-v3 | `GROQ_API_KEY` | **bepul tarif** (karta shart emas) | sinov uchun; o'zbek tilida aniqligi o'rtacha |
| uzbekvoice.ai | `MOHIR_API_KEY` | 450 so'm/daqiqa | o'zbek tili uchun eng aniq — ishlab chiqarish uchun |
| OpenAI Whisper | `OPENAI_API_KEY` | $0.006/daqiqa | muqobil |

`ANTHROPIC_API_KEY` **majburiy emas**: bo'sh bo'lsa bot qoida asosidagi javoblarni beradi
(hisob-kitob bazadan, tashqi chaqiruvsiz, 0 token). Kalit qo'shilsa erkin savollar ham ishlaydi.

Qo'shimcha sozlamalar (ixtiyoriy): `MOHIR_STT_LANGUAGE` — `uz` (standart), `ru` yoki `uz-ru`
(aralash nutq uchun); `MOHIR_STT_MODEL` — `general` (standart) yoki `enhanced-stt`;
`MOHIR_STT_URL` — endpoint o'zgarsa. Kalit olish: [uzbekvoice.ai](https://uzbekvoice.ai) → *Profilga kirish*;
narx 450 so'm/daqiqa, ro'yxatdan o'tganda 10 000 so'm bonus. Bot ovozni 60 soniya bilan cheklaydi
(`blocking=true` rejimi 1 daqiqagacha ishlaydi).

Lokalda `npm run dev` va `npm run bot` yonma-yon ishlaydi. Serverda esa webhook yetarli —
`/api/telegram/webhook` Next ilovaning o'zida (alohida jarayon kerak emas).

### Foydalanuvchini ulash

Bot faqat **ulangan** hisobga javob beradi. Xodim ERP'da **Tahlil → Insof AI → Telegram bot**
sahifasidan 6 xonali kod oladi (15 daqiqa amal qiladi) va uni botga yuboradi.
Direktor shu sahifada barcha ulangan chatlarni ko'radi, keraksizini bloklaydi yoki uzadi.
Rollar `/api/ai` bilan bir xil: direktor, moliya, buxgalteriya.

Har bir savol-javob `TelegramMessage` jadvalida saqlanadi — o'sha sahifadagi jurnalda ko'rinadi
va oxirgi 3 ta juftlik Claude'ga suhbat konteksti sifatida beriladi.

### Tuzilma

```
src/lib/telegram/api.ts       Bot API klienti (kutubxonasiz fetch)
src/lib/telegram/stt.ts       ovoz → matn: uzbekvoice.ai (Mohir AI) yoki OpenAI Whisper
src/lib/telegram/bot.ts       update'ga ishlov: buyruqlar, ulash, savol → javob
src/app/api/telegram/webhook  webhook endpoint (maxfiy token bilan himoyalangan)
scripts/telegram-bot.ts       lokal long polling (npm run bot)
scripts/telegram-webhook.ts   webhook o'rnatish / holat (npm run bot:webhook)
src/lib/bi/answer.ts          AI panel va bot uchun umumiy javob funksiyasi
```

Bot hech narsani o'zgartirmaydi — faqat o'qiydi. Webhook `src/middleware.ts` da login'dan ozod
qilingan, o'rniga Telegram yuboradigan `X-Telegram-Bot-Api-Secret-Token` sarlavhasi tekshiriladi.

## Insof ECO (haydovchi ilovasi) integratsiyasi

Haydovchilar telefonida **Insof ECO** ilovasini ishlatadi (`~/Desktop/InsofECO`, NestJS API + Expo).
ERP nakladnoy yaratganda reys haydovchi telefoniga tushadi; u qabul qiladi, yo'lda GPS yuboradi,
obyektda mijoz imzolaydi — har bir bosqich ERP'dagi reys holatiga qaytadi (`LOADED`, `ON_ROAD`, `DELIVERED`).

### Sozlash

1. ECO tomonida integratsiya kaliti (zavod INN bo'yicha) — kalit bir marta chop etiladi:
   ```bash
   cd ~/Desktop/InsofECO && yarn workspace @insof/api integration:create -- --org 300000001 --webhook http://localhost:3000/api/eco/webhook
   ```
2. ERP `.env`: `ECO_API_URL`, `ECO_API_KEY`, `ECO_WEBHOOK_SECRET` (skript chiqargan qiymatlar), serverni qayta ishga tushiring.
3. **Logistika → Haydovchilar (ECO)** sahifasi: ulanish holati, haydovchilarni ulash (telefon `+998…` bo'lishi shart),
   texnikani yuborish, faol reyslarning ECO holati.

### Qanday ishlaydi

| ERP | ECO (haydovchi) |
|---|---|
| Reys yaratildi → `PUT /v1/erp/trips/N-…` | Ilovada "Yangi reys" (push) |
| "Yuklandi" → `LOADING` | Qabul + yuklash avtomatik belgilanadi |
| — | Haydovchi "Yo'lga chiqdim" → webhook → ERP `ON_ROAD` |
| — | Obyektda mijoz imzosi / SMS-kod → webhook → ERP `DELIVERED`, zayavka yopiladi |
| "Bekor" (faqat PLANNED) | Reys `CANCELLED` |

Kalit: `Trip.deliveryNoteNo` = ECO `Delivery.externalRef`. Webhook `/api/eco/webhook` HMAC-SHA256 imzo bilan
himoyalangan va middleware'da login'dan ozod. ECO o'chiq bo'lsa ERP ishlayveradi — xato reys sahifasida
ko'rinadi, "ECO'ga yuborish" tugmasi bilan qayta yuboriladi. Audit jurnalida haydovchi harakatlari
`Insof ECO (haydovchi ilovasi)` foydalanuvchisi nomidan yoziladi (tizimga kira olmaydi).

```
src/lib/eco/client.ts       ECO API klienti (X-Api-Key, fetch), telefon normalizatsiyasi
src/lib/eco/sync.ts         reysni yuborish / holat yuborish / ECO'dan olish / webhook holatini qo'llash
src/lib/eco/master.ts       spravochniklarni ECO'ga yuborish (mijoz, marka, xomashyo, zayavka, schyot, to'lov)
src/lib/eco/labels.ts       ECO holatlari o'zbekcha
src/lib/trips.ts            reys holat o'tishlari (action va webhook uchun umumiy)
src/app/api/eco/webhook     ECO → ERP webhook
src/app/api/eco/positions   yo'ldagi reyslarning joylashuvi (xarita shu yerdan o'qiydi)
src/app/api/eco/sync        spravochnik sinxronini ishga tushirish (faqat direktor)
src/app/(app)/drivers       Haydovchilar (ECO) sahifasi
src/app/(app)/trips/live-drivers.tsx   "Yo'lga chiqqan haydovchilar" bloki va xarita
scripts/eco-sync.ts         `npm run eco:sync` — spravochniklarni ECO'ga yuborish
```

### Spravochniklar: ERP — manba, ECO — ko'zgu

ERP ma'lumotlari ECO'ga bir tomonlama oqadi. ECO'dan ERP'ga faqat haydovchi harakati qaytadi.

| ERP | ECO | Kalit |
|---|---|---|
| Mijoz + kredit limiti | `Organization` (CONTRACTOR) + `CreditLimit` | ERP mijoz id → `externalRef` |
| Mahsulot (beton markasi) | `ConcreteMix` | marka kodi (M300) |
| Xomashyo | `Material` | ERP xomashyo id → `externalRef` |
| Zayavka + qatorlar | `Order` + `OrderItem` | zayavka raqami → `externalRef` |
| Schyot | `Invoice` | zayavka (ECO'da schyot buyurtmaga tegishli) |
| To'lov | `Payment` | ERP to'lov id → `externalId` |

```bash
npm run eco:sync                # oxirgi 90 kunlik zayavka / schyot / to'lov
npm run eco:sync -- --days=0    # hamma vaqt (birinchi to'liq yuklash)
```

Hammasi idempotent: qayta yuborilsa dublikat yaratilmaydi, mavjud yozuv yangilanadi. Hech narsa o'chirilmaydi —
ERP'da arxivlangan mijoz ECO'da yashiriladi (`deletedAt`), qayta faollashtirilsa tiklanadi.
ERP'dan kelgan zayavka `erpManaged` bo'lib belgilanadi: hajm va summa ERP'niki, reys qo'shilganda ECO uni
qayta hisoblamaydi.

### Yo'lga chiqqan haydovchilar (xarita)

**Logistika → Reyslar / nakladnoy** sahifasi tepasida yo'ldagi mikserlar ro'yxati va xaritasi turadi
(OpenStreetMap, 15 soniyada yangilanadi). Har bir qatorda davlat raqami, haydovchi, mijoz, manzil,
oxirgi GPS vaqti, tezlik va yetib borishgacha qolgan daqiqa ko'rinadi. Qator bosilsa telefon raqami va
Yandex xaritada ochish havolasi chiqadi.

GPS haydovchi ilovasidan keladi: reys boshlanganda fon kuzatuvi yoqiladi, nuqtalar ECO'ga yuboriladi,
ERP ularni `GET /v1/erp/positions` orqali o'qiydi. Haydovchi ilovani yopsa yoki ruxsat bermasa, qator
"GPS yo'q" deb turadi — reys baribir ro'yxatda qoladi.

> Zayavka manzilining koordinatasi ERP'da saqlanmaydi, shuning uchun obyekt nuqtasi ECO'ga bormaydi.
> Shu sababli yetib borish vaqti taxminiy va obyektga yaqinlashganda holat avtomatik o'zgarmaydi.
> Buning uchun zayavka formasiga xaritadan nuqta tanlash qo'shish kerak.

Nakladnoy QR: `APP_URL` telefon ocha oladigan manzil bo'lishi shart (LAN IP yoki domen) — aks holda QR `localhost`ga ishora qiladi.
ECO tomonidagi tavsif: `InsofECO/docs/06-erp-integratsiya.md`.

## Keyingi bosqich (rejada)

- Buxgalteriya provodkalari va hisobotlar (P&L, tannarx m³ bo'yicha)
- Otdel kadr: tabel, ish haqi (sdelka — m³, reys)
- Didox / Faktura.uz elektron schyot-faktura
- Sifat nazorati: kub namuna, 7/28 kunlik sinov, beton pasporti
- Batch-kompyuter / tarozi integratsiyasi (reja vs fakt)
