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

## Asosiy oqim

```
Zayavka (DRAFT) → Tasdiqlash → kredit limit tekshiruvi → CONFIRMED yoki BLOCKED (direktor ochadi)
  → Zames (retsept bo'yicha xomashyo skladdan avtomatik chiqadi) → IN_PRODUCTION
  → Reys / nakladnoy (QR) → Yuklandi → Yo'lda → Yetkazildi → DELIVERED
  → Schyot → To'lov (kassa/bank) → CLOSED
```

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

## Keyingi bosqich (rejada)

- Buxgalteriya provodkalari va hisobotlar (P&L, tannarx m³ bo'yicha)
- Otdel kadr: tabel, ish haqi (sdelka — m³, reys)
- Haydovchi uchun Telegram mini-app (reys qabul / yetkazdim + foto)
- Didox / Faktura.uz elektron schyot-faktura
- Sifat nazorati: kub namuna, 7/28 kunlik sinov, beton pasporti
- Batch-kompyuter / tarozi integratsiyasi (reja vs fakt)
