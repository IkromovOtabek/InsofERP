# QA regressiya testlari (sotuv / moliya)

Faqat **test bazasida** ishlaydi (nomi `insof_test…`, `insof_test_golden` emas — skriptlar boshqasida to'xtaydi).

```bash
dropdb --if-exists insof_test_a && createdb -T insof_test_golden insof_test_a
# .env: INSOF_ENV=test, DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_a (.env.test.example dan)
npx prisma migrate deploy && npm run db:test-users && npx next build && npx next start -p 3201 &

export QA_DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_a   # QA_BASE=http://localhost:3201 (standart)
node scripts/qa/sales-lifecycle.mjs     # zayavka → avans → schyot → to'lov/ortiqcha/storno, limit/blok, qora ro'yxat, 403
node scripts/qa/openings-cash.mjs       # boshlang'ich qoldiq (4 tur) qo'lda + bank overdraft nazorati + yetkazuvchi to'lovi stornosi
npx tsx scripts/qa/excel-imports.mts    # haqiqiy .xlsx: mijoz/yetkazuvchi (1000 qator), qoldiqlar importi, yomon qatorlar
DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/prepay-gate.mts   # bosh to'lov darvozasi (Order.prepayAmount)
```

Har skript oxirida `N OK, M FAIL` chiqaradi; xato bo'lsa chiqish kodi 1. Skriptlar qayta ishga tushirilsa ham
o'tadi (har safar noyob nomlar). Server action'lar `client.mjs` orqali brauzer kabi chaqiriladi
(id'lar `.next/server/server-reference-manifest.json` dan).
