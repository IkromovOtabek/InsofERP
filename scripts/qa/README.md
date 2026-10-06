# QA regressiya testlari

## To'liq regressiya — deploy oldidan bitta buyruq

```bash
bash scripts/qa/run-all.sh                      # a, b, pages, c, geo, d — ketma-ket, ~25–40 daqiqa
QA_ONLY="a pages" bash scripts/qa/run-all.sh    # faqat tanlanganlar
QA_KEEP=1 bash scripts/qa/run-all.sh            # ish papkasi va insof_test_r_* bazalari saqlanadi (tahlil uchun)
QA_DB_PREFIX=insof_test_x_ QA_PORT=3241 QA_WORK=/tmp/qa-x bash scripts/qa/run-all.sh   # parallel yugurish: alohida bazalar, port va papka
```

Skript repo nusxasini (`$QA_WORK`, standart `$TMPDIR/insof-qa-run/app`; `.env*`, `.git`, `.next`, `uploads` ko'chirilmaydi)
`.env.test.example` dan yozilgan test `.env` bilan build qiladi, har to'plam uchun `insof_test_golden` dan **toza**
`insof_test_r_<nom>` bazasini ochib (migrate deploy + test foydalanuvchilar) serverni `QA_PORT` (3210) da ishga tushiradi.
Haqiqiy `.env`, `insof_erp`, `insof_test` va masofaviy serverlarga tegilmaydi. Oxirida natija jadvali; biror to'plam
yiqilsa exit 1, loglar `$QA_WORK/logs` da qoladi.

| To'plam | Nima | Fayllar |
|---|---|---|
| a | sotuv / moliya, Excel importlari, INN tekshiruvi, kassa ⇄ bank o'tkazmalari, yagona debitorka | sales-lifecycle.mjs, openings-cash.mjs, excel-imports.mts, prepay-gate.mts, transfers.mts, receivables.mts |
| b | sklad / ishlab chiqarish / logistika / ta'minot / kadr, kirim QQS (b-vat.mts) | b-all.sh |
| pages | `src/app/(app)` dagi barcha sahifalar × 14 rol, server log xatolari | pages-all.mjs |
| c | mobil API (jti, refresh rotatsiya, rollar, pul), integratsiyalar, SMS kanali yo'qligi (statik) | c-run-all.sh (c-no-sms.ts …) |
| geo | mobil geofence yoqilgan rejim (`MOBILE_SITE_COORDS_REQUIRED=true`) | c-mobile-scope.ts |
| d | ko'p korxonali platforma: panel, SSO, deploy DRY_RUN, zaxira, health-watch, kiberxavfsizlik moduli (fixture'lar + stub AI) | d-run-all.sh (git HEAD klonida, portlar 3214–3216), d-security.mts |

`d-security.mts` alohida ham ishlaydi (server shart emas): `npx tsx scripts/qa/d-security.mts` — vaqtinchalik
`insof_test_ctl_sec` bazasini ochadi va oxirida o'chiradi; haqiqiy Claude API chaqirilmaydi (test rejimi stub).

`d` to'plami `git archive HEAD` bilan ishlaydi — commit qilinmagan o'zgarishlar unga kirmaydi.

## Sotuv / moliya to'plami (a) — qo'lda

Faqat **test bazasida** ishlaydi (nomi `insof_test…`, `insof_test_golden` emas — skriptlar boshqasida to'xtaydi).

```bash
dropdb --if-exists insof_test_a && createdb -T insof_test_golden insof_test_a
# .env: INSOF_ENV=test, DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_a (.env.test.example dan)
npx prisma migrate deploy && npm run db:test-users && npx next build && npx next start -p 3201 &

export QA_DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_a   # QA_BASE=http://localhost:3201 (standart)
node scripts/qa/sales-lifecycle.mjs     # zayavka → avans → schyot → to'lov/ortiqcha/storno, limit/blok, qora ro'yxat, 403
node scripts/qa/openings-cash.mjs       # boshlang'ich qoldiq (4 tur) qo'lda + bank overdraft nazorati + yetkazuvchi to'lovi stornosi
npx tsx scripts/qa/excel-imports.mts    # haqiqiy .xlsx: mijoz/yetkazuvchi (1000 qator), qoldiqlar importi, yomon qatorlar, INN (9/14 raqam) forma+import
DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/prepay-gate.mts   # bosh to'lov darvozasi (Order.prepayAmount)
DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/transfers.mts     # o'tkazma: kassa→bank, komissiya, overdraft, takror bosish, storno, P&L, mobil qoldiq
DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/receivables.mts   # yagona debitorka: balans, FIFO aging — karta, dashboard, BI, /sales, mobil bir xil
```

Har skript oxirida `N OK, M FAIL` chiqaradi; xato bo'lsa chiqish kodi 1. Skriptlar qayta ishga tushirilsa ham
o'tadi (har safar noyob nomlar). Server action'lar `client.mjs` orqali brauzer kabi chaqiriladi
(id'lar `.next/server/server-reference-manifest.json` dan).
