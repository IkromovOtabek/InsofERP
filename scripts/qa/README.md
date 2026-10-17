# QA regressiya testlari

## To'liq regressiya — deploy oldidan bitta buyruq

```bash
bash scripts/qa/run-all.sh                      # a, b, pages, c, geo, dm, d — ketma-ket, ~25–40 daqiqa
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
| a | sotuv / moliya, Excel importlari, INN tekshiruvi, lavozim login shabloni va ruxsat shablonlari (mobil login bilan), Sozlamalar → Limitlar (standart va mijozlar kredit limiti, kunlik zayavka limiti blokdan chiqarishda ham, davomat radiusi), kassa ⇄ bank o'tkazmalari, yagona debitorka | sales-lifecycle.mjs, openings-cash.mjs, excel-imports.mts, login-templates.mts, limits.mts, prepay-gate.mts, transfers.mts, receivables.mts |
| b | sklad / ishlab chiqarish / logistika / ta'minot / kadr, ish haqi (b-payroll.mts — smena grafigi, arizalar → davomat / avans vedomosti, jarima-bonus qoidalari, oy yakuni hisobi va JShDS, direktor tasdig'i, kassadan to'lov, ruxsatlar; b-tasks.mts — vazifalar oqimi va huquqlari, kundalik cheklistlar, KPI → ish haqi bonusi; b-hire.mts — yollash va ishga qabul, moslashuv, o'qitish va sertifikat; b-voice.mts — so'rovnoma va anonimlik, HR chat, ommaviy xabar, kadr hisoboti, E-IMZO imzosi), tijorat taklifi (b-offers.mts — zayavkasiz taklif, QQS hisobi, ruxsat va direktor bergan «create», QR sahifa: kalitsiz 404, ko'rish hisobi, mijoz «qabul qilaman» → ACCEPTED + ariza + bildirishnoma, bekor / muddati o'tgan qoidalari, hujjat sozlamalari va chop etish), kirim QQS (b-vat.mts), Sklad → Xomashyo qoldig'i: belgilab o'chirish (materials-delete.mts — qoldiqsiz va o'zi kiritgan boshlang'ich qoldiqli butunlay o'chadi; ishlatilgani qoldig'i 0 bo'lsa arxivga, qoldig'i bor bo'lsa o'zgarmaydi; boshqa xodim kiritgani / kassaga chiqim bo'lgani o'chmaydi; ruxsat, sahifadagi panel), Sklad → Приход / Расход / Остатки (sklad-journals.mts — pastda) | b-all.sh |
| pages | `src/app/(app)` dagi barcha sahifalar × 14 rol, server log xatolari | pages-all.mjs |
| c | mobil API (jti, refresh rotatsiya, rollar, pul, kassa: to'lov / kirim-chiqim / o'tkazma — c-mobile-cash.ts), integratsiyalar, SMS kanali yo'qligi (statik) | c-run-all.sh (c-no-sms.ts …) |
| geo | mobil geofence yoqilgan rejim (`MOBILE_SITE_COORDS_REQUIRED=true`) | c-mobile-scope.ts |
| dm | IT panel monitoring va kiberxavfsizlik UI: SSE oqimi (login'siz rad, jonli yangilanish), amallar navbati (oq ro'yxat, yozma tasdiq, takror, 10/daq), hodisa ack/yopish, sahifalar, bo'sh holat, har sahifada «?» yordam tugmalari; yordam lug'ati (har amal, agent va xavfsizlik kalitlari uchun tushuntirish) | d-help.mts, d-monitor-ui.mts + d-monitor-seed.mts (`insof_test_r_ctl_ui`, `INSOF_MODE=control`) |
| d | ko'p korxonali platforma: panel, SSO, deploy DRY_RUN, zaxira, health-watch, kiberxavfsizlik moduli (fixture'lar + stub AI) | d-run-all.sh (git HEAD klonida, portlar 3214–3216), d-security.mts |

`d-security.mts` alohida ham ishlaydi (server shart emas): `npx tsx scripts/qa/d-security.mts` — vaqtinchalik
`insof_test_ctl_sec` bazasini ochadi va oxirida o'chiradi; haqiqiy Claude API chaqirilmaydi (test rejimi stub).

`d-help.mts` (dm ichida, alohida ham, server/baza shart emas): `npx tsx scripts/qa/d-help.mts` — IT panel yordam
lug'ati (`src/lib/control/help-content.ts`): har `ACTION_TYPES` amali uchun to'liq yordam; `helpForCheckKey` agent
(`scripts/insof-agent.ts`, `scripts/agent/*.ts`) va xavfsizlik moduli yozadigan har kalit uchun maxsus javob beradi —
kalitlar manba koddan avtomatik yig'iladi, yangi kalit yordamsiz qolsa test yiqiladi; panel kodidagi har `topic="…"` lug'atda bor.

`d` to'plami `git archive HEAD` bilan ishlaydi — commit qilinmagan o'zgarishlar unga kirmaydi.

Parallel yugurish (bir mashinada bir nechta worktree/agent): `QA_DB_PREFIX`, `QA_PORT`, `QA_WORK`, `D_CTL_PORT`,
`D_FIRST_PORT` har biriga alohida. `run-all.sh` d to'plamiga `D_DB_PREFIX="${QA_DB_PREFIX}d_"` beradi — d ning barcha
bazalari shu prefiks bilan: `<pfx>ctl`, `<pfx>t_<slug>` (panel `TEST_TENANT_DB_PREFIX`, faqat test rejimida),
`<pfx>restore_*`, `<pfx>ctl_agent`, `<pfx>ctl_dbt`, `<pfx>dbt_t1`, `<pfx>ctl_sec`, `<pfx>ctl_eco`; tozalash ham faqat
shularni o'chiradi. `d-run-all.sh` ni to'g'ridan ishga tushirganda `D_DB_PREFIX` berilmasa — eski nomlar (`insof_test_ctl` …).

`d-agent.mts` (d ichida, alohida ham): `npx tsx scripts/qa/d-agent.mts` — insof-agent parserlari, chegaralar, hodisa
hayot sikli, amal tekshiruvi/sir tozalash (unit) va ~70 s lokal integratsiya: vaqtinchalik `insof_test_ctl_agent`
(boshida qayta yaratiladi, oxirida o'chiriladi), yopiq portdagi soxta korxona → CRIT hodisa → tiklanish → RESOLVED,
amallar navbati, qulf, SIGTERM, xavfsizlik moduli stub'i. `AGENT_QA_UNIT_ONLY=1` — faqat unit (bazasiz).

## Sklad jurnallari — `sklad-journals.mts` (b ichida)

Sklad → «Приход», «Расход», «Остатки» (ekranlar ruscha, Excel jurnallaridagidek), «Дона сўм», «Кому» ro'yxati va mobil:

- **«Кому»** (`stock/rasxod/actions` saveRecipient / toggleRecipient): sklad qo'shadi, takror nom (registrsiz, nofaol ham) — xato,
  snabjeniye tahrirlaydi, nofaol qilinadi (o'chirilmaydi), sotuvchi — 403; `/stock/rasxod/new` da faqat faollar.
- **«Приход»** (`stock/prixod/actions#createPrixod`): П-р kirim 2 qator (biri dostavka bilan) — ТТН, Деньги, Кому, Адрес,
  Снабженец, Почему, `deliveryCost`; `StockMove.unitCost` = narx (+QQS, korxona QQS to'lovchisi bo'lmasa) + dostavka / qty;
  Н-к — QQS 0; takror `clientToken`; ruscha xatolar; `prixodJournal`, `/stock/prixod` sahifasi, yetkazuvchi qarzi dostavka bilan.
- **«Дона сўм»** (`stock/price-actions#saveMaterialPrice`): faqat snabjeniye, audit; narx o'zgargach keyingi spisanie / brigadaga
  berish yangi narxda, eski chiqim o'zgarmaydi.
- **«Расход»** (`stock/rasxod/actions#createRasxod`): oluvchiga `ISSUE`, brigadaga `BRIGADE_ISSUE` + `BrigadeMove`, qoldiqdan
  oshsa hech narsa yozilmaydi, takror kalit, sana chegaralari; `rasxodJournal` (Деньги / НДС oxirgi kirimdan, «Кому» filtri),
  zames — kun + xomashyo + sklad bo'yicha bitta qator (test bazasida zames bo'lsa).
- **«Остатки»** (`materialTurnover`, `/stock?tab=balance&from&to`): test xomashyosi bo'yicha aniq qiymatlar, har xomashyo uchun
  oxirgi = boshlang'ich + приход − расход va SQL qoldig'i bilan moslik, «Расход» ustuni = Расход jurnali.
- **Mobil**: `/api/mobile/list?key=prixod|rasxod|ostatki`, `/api/mobile/form?key=prixod|rasxod` (sklad — 200, sotuvchi — 403),
  `/api/mobile/create` rasxod (payload forma tavsifidan yig'iladi) va takror kalit.

O'z ma'lumotini `T` qo'shimchasi bilan ochadi (yetkazuvchi, 2 xomashyo, oluvchilar, brigada); oxirida brigada qoldig'i qaytariladi,
test xomashyosi qoldig'i hisobdan chiqarilib arxivga olinadi, «Дона сўм» qaytariladi, oluvchi / brigada / yetkazuvchi nofaol
bo'ladi. Boshqa xomashyolar narxiga tegmaydi (`fillPricesFromAvg` chaqirilmaydi). Lib funksiyalari (faqat o'qish) ham chaqiriladi —
skript `DATABASE_URL` ni `QA_DATABASE_URL` ga tenglaydi (db.mjs uni `insof_test…` ekanini tekshiradi).

```bash
QA_BASE=http://localhost:3202 QA_DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_b npx tsx scripts/qa/sklad-journals.mts
```

## Sotuv / moliya to'plami (a) — qo'lda

Faqat **test bazasida** ishlaydi (nomi `insof_test…`, `insof_test_golden` emas — skriptlar boshqasida to'xtaydi).

```bash
dropdb --if-exists insof_test_a && createdb -T insof_test_golden insof_test_a
# .env: INSOF_ENV=test, DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_a (.env.test.example dan)
npx prisma migrate deploy && npm run db:test-users && npx next build && npx next start -p 3201 &

export QA_DATABASE_URL=postgresql://otabek@localhost:5432/insof_test_a   # QA_BASE=http://localhost:3201 (standart)
node scripts/qa/sales-lifecycle.mjs     # zayavka → avans → schyot → to'lov/ortiqcha/storno, limit/blok, qora ro'yxat, 403
node scripts/qa/openings-cash.mjs       # boshlang'ich qoldiq (4 tur) qo'lda + bank overdraft nazorati + yetkazuvchi to'lovi stornosi
npx tsx scripts/qa/login-templates.mts  # lavozim login shabloni: kadr/direktor huquqi, login shablon bilan, mobil, bir nechta xodimga birdan
npx tsx scripts/qa/limits.mts           # Sozlamalar → Limitlar: faqat direktor, standart kredit limiti, kunlik limit (blokdan chiqarishda ham), radius, mijozlar limiti jadvali
npx tsx scripts/qa/excel-imports.mts    # haqiqiy .xlsx: mijoz/yetkazuvchi (1000 qator), qoldiqlar importi, yomon qatorlar, INN (9/14 raqam) forma+import
DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/prepay-gate.mts   # bosh to'lov darvozasi (Order.prepayAmount)
DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/transfers.mts     # o'tkazma: kassa→bank, komissiya, overdraft, takror bosish, storno, P&L, mobil qoldiq
DATABASE_URL=$QA_DATABASE_URL npx tsx scripts/qa/receivables.mts   # yagona debitorka: balans, FIFO aging — karta, dashboard, BI, /sales, mobil bir xil
```

Har skript oxirida `N OK, M FAIL` chiqaradi; xato bo'lsa chiqish kodi 1. Skriptlar qayta ishga tushirilsa ham
o'tadi (har safar noyob nomlar). Server action'lar `client.mjs` orqali brauzer kabi chaqiriladi
(id'lar `.next/server/server-reference-manifest.json` dan).
