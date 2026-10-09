# Insof ERP

Beton zavodi (tayyor beton m³ + dona mahsulot: ustun, FBS blok) uchun ERP. Ko'p korxonali platforma:
har korxona — alohida baza va alohida jarayon. Batafsil: `README.md`, `docs/deploy/PLATFORMA.md`, `docs/deploy/SERVER.md`.

## Stack
- Next.js 15 (App Router, server actions), React 19, TypeScript, Tailwind 4
- Prisma 6 + PostgreSQL 15. Klient `src/generated/prisma` (korxona), `src/generated/control` (IT panel)
- O'z auth: JWT cookie (`jose`) + bcrypt, `User.sessionVersion`; mobil API — `src/app/api/mobile`
- zod (formalar), lucide-react (ikonkalar), xlsx (SheetJS CDN tarball'i), sharp 0.33.5, face-api/tfjs (Face ID), three.js (sayt)

## Tuzilma
- `src/app/(app)/<modul>/` — ERP bo'limlari: `page.tsx`, `actions.ts`, `*-form.tsx`, `[id]/`, `new/`
- `src/app/(site)` — ommaviy sayt, `(auth)` — kirish, `superadmin` — IT panel (`INSOF_MODE=control`)
- `src/lib/` — biznes mantiq (bo'lim nomi bilan: `orders.ts`, `receivables.ts`, `cash-transfer.ts` …);
  `lib/mobile`, `lib/eco`, `lib/control`, `lib/ai`
- `src/components/ui/index.tsx` — dizayn primitivlari; `app-shell.tsx` — qobiq va menyu
- `prisma/schema.prisma` (korxona), `prisma/control/schema.prisma` (IT panel)
- `scripts/` — bot, ECO sinx., tenant, agent, deploy; `scripts/qa/` — regressiya testlari

## Buyruqlar
```bash
npm run dev                          # dev server (.claude/launch.json, autoPort)
npx tsc --noEmit                     # tiplar
npx eslint <fayllar>                 # lint (butun loyiha: npm run lint)
npx prisma validate                  # sxema tekshiruvi
bash scripts/qa/run-all.sh           # to'liq regressiya, ~25–40 daq; QA_ONLY="a pages" — tanlab
npm run security:check               # sirlar, standart parollar, NODE_ENV
```
Tez tekshiruv = `tsc` + `eslint`. Dev-server ishlab turganda `next build` ishlatma (`.next` buziladi).
Katta o'zgarishdan keyin, deploydan oldin esa albatta `run-all.sh` ishga tushir. `d` to'plami faqat commit qilingan kodni ko'radi.

## Kod qoidalari
- **Sahifa himoyasi:** ma'lumot o'qiydigan har `(app)` sahifasi boshida `await requirePage("/prefiks")`
  (`lib/page-guard.ts`). Middleware faqat imzoni tekshiradi, layout RSC navigatsiyada o'tkazib yuborilishi mumkin.
- **Server action:** forma `parseForm(schema, fd)` + `zDec/zStr/zOpt` (`lib/action.ts`), natija `ActionState`.
  Xato matnlari o'zbekcha.
- **Rollar:** har amal bitta mas'ul rolga beriladi. Vebda DIRECTOR ham qo'shiladi; mobil `can()` va bildirishnomalar qat'iy.
  SUPERADMIN korxona ichida DIRECTOR kabi ishlaydi, faqat SSO orqali kiradi. Yo'l ruxsatlari: `lib/nav.ts`, `lib/permissions.ts`.
- **Pul** `Decimal(18,2)`, **miqdor** `Decimal(18,3)`; `float` ishlatma.
- **Sklad:** `StockMove` — yagona o'zgarmas jurnal, qoldiq = `SUM(qty)`. Sarf `lockStock(tx)` ostida.
- **Hujjatlar o'chirilmaydi:** faqat holat (`CANCELLED`/storno) o'zgaradi, hammasi `AuditLog`ga yoziladi.
- **Holat o'tishlari** shartli `updateMany` bilan (poyga bo'lmasin). Idempotentlik uchun `clientToken` ishlatiladi:
  unique (P2002) xatosi kutilgan holat, mavjud yozuvni qaytarish kerak.
- **Formatlash** faqat `lib/format.ts` orqali (Intl'siz: server va brauzer bir xil chiqarsin).
- **UI:** faqat `components/ui` primitivlari (`PageHeader`, `Card`, `Table`, `Field`, `Tabs`, `StatCard`…),
  ad-hoc kartochka yasama. Ikonka faqat lucide, emoji yo'q. Barcha UI matni o'zbek (lotin), enum'lar label orqali.
- **Ko'p korxona:** korxonaga xos sozlama korxona bazasida yoki `tenants/<slug>.env` da turadi;
  control bazaga korxona ma'lumoti yozilmaydi.
- **Excel import:** umumiy `components/excel-import.tsx` + `FIELD_SYNONYMS`; yangi import uchun shundan foydalan.

## Migratsiya (terminalsiz muhitda)
```bash
D=prisma/migrations/$(date +%Y%m%d%H%M%S)_nomi && mkdir -p $D
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "postgresql://otabek@localhost:5432/insof_erp_shadow" --script > $D/migration.sql
npx prisma migrate deploy && npx prisma generate
```
- Shadow uchun **faqat** `insof_erp_shadow`. Asosiy URL berilsa, `insof_erp` tozalanib ketadi (2026-09-30 da shunday bo'lgan).
- Xavfli ishdan oldin: `pg_dump insof_erp > <scratchpad>/insof_erp-<sana>.sql`.
- Control sxema: `--schema prisma/control/schema.prisma`, deploy `npm run control:migrate`.
- `prisma generate` dan keyin dev-serverni qayta ishga tushir (eski klient keshda qoladi).

## Bazalar va muhit
- Lokal Homebrew `postgresql@15`, rol `otabek` (parolsiz). Bazalar: `insof_erp` (dev), `insof_erp_shadow`,
  `insof_test` / `insof_test_golden` (QA). `docker-compose` dagi baza va `.env.example` dagi 5438-port — ECO bazasi, ERP'niki emas.
- Test hisoblari: `scripts/test-users.ts` (`test.*`, 14 rol). QA `.env.test.example` bilan ishlaydi;
  `INSOF_ENV=test` da real kalit bo'lsa server ishga tushmaydi.
- `~/.npm` keshida ruxsat muammosi bor: `npm_config_cache=<scratchpad>/.npmcache npm install`.
- **package.json yoki lock o'zgarsa:** server npm 10 ishlatadi. Lockni npm 10 bilan yangila va `npm ci` bilan sinab ko'r.
  `sharp` override `"$sharp"` bo'lib qolsin, versiya 0.33.5 dan oshmasin (VPS protsessori).

## Integratsiyalar
- **Insof ECO** (haydovchi ilovasi, `~/Desktop/InsofECO`): `lib/eco`, `npm run eco:sync`. Spravochniklar uchun ERP — manba.
- **Telegram:** bot, webhook (`TELEGRAM_WEBHOOK_SECRET` shart), Gateway orqali kirish kodlari. SMS/Eskiz olib tashlangan.
- **AI:** `lib/ai`, `@anthropic-ai/sdk`; IT panel kiberxavfsizlik moduli testda stub ishlatadi.

## Prod
- Domen `insof-erp.uz`, VPS'da `deploy` foydalanuvchisi, xizmat `insof-erp@<slug>`. Deploy: `scripts/deploy.sh`,
  qadamlar `docs/deploy/PLATFORMA.md` da.
- Serverga (ssh/scp/deploy/restart/nginx) har amaldan oldin ruxsat so'ra. Prodda `db:seed` hech qachon ishlatilmaydi.
- Foydalanuvchiga server buyrug'i berganda izohni buyruq bloki ichiga qo'shma: u blokni butunligicha terminalga
  joylaydi, `o'sha` dagi apostrof esa shell'da ochiq qo'shtirnoq bo'lib qoladi.
