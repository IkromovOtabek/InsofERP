# Ish haqi: Excel'dan ERP'ga o'tish rejasi

Manba: «Иш Хаки октябрь 2026.xlsx» (17 varaq) va ERP kodi tahlili, 2026-11-17.
Maqsad: xodimlar hozir Excel'da qanday ishlayotgan bo'lsa, ERP'da ham **shunday qulay** ishlashi. Shu bilan birga
qo'lda nusxalash, qattiq yozilgan sonlar va qatorlar siljib ketishi kabi xatolar yo'qolishi kerak.

---

## 1. Excel'dagi ish jarayoni (qisqacha)

```
Tabellar (soat/kun, 1..31)                       Ushlanmalar
 ├─ Ауп ........... oklad ÷ norma kun × (soat/8)   ├─ Миб карздорлик (sud/ijro, aliment) ──qo'lda──┐
 ├─ Поврименшики .. kunbay × (soat/8)              ├─ Карз (qarz daftari, oyma-oy o'tadi) ──qo'lda─┤
 ├─ Сваршики ...... kunbay × (soat/8)              └─ C2026: tug'ilgan kun/to'y puli, jarima,      │
 ├─ Brigadalar (Илхом, Шухрат, Сардор, Исмоил, Столба)         avans, oylikdan qarz (qo'lda)        │
 │    har kuni: Σ(mahsulot soni × sdelka narxi) = kunlik fond                                       │
 │    kunlik fond → a'zolarga shu kungi soatiga qarab bo'linadi                                    │
 │    oy jami → 10 000 ga yaxlitlanadi → minus brak (brak ÷ brigada soati × xodim soati)            │
 ├─ БРУ 1/2 ....... beton m³ × narx, xuddi shu usulda                                              │
 └─ Shofyorlar .... qo'lga summa tashqaridan yoziladi (yalpi = qo'lga ÷ 0,88)                       │
                │                                                                                  │
                ▼                                                                                  ▼
        C2026 (bosh hisob): yalpi → 12% daromad solig'i → qo'lga → ushlanmalar → QOLDIQ (to'lanadi)
                │
                ├─ «Аванс наличка» (vedomost №1, imzo ustuni) — oy o'rtasida
                └─ «Зарплата 2» (vedomost №2, imzo ustuni) — QOLDIQ, hammasi naqd
```

**Har oy qo'lda qilinadigan ishlar:** o'tgan oy faylini nusxalash; har kuni yoki oy oxirida soatlarni yozish;
brigada va БРУ uchun kunlik mahsulot sonini yozish; brakni Excel'dan tashqarida hisoblab koeffitsient sifatida
yozish; Карз/Миб'dagi ushlanmalarni C2026'ga qo'lda ko'chirish; vedomostlarni chop etish.

**Excel'dagi xatolar (ERP'da yo'qolishi kerak):**
- Карз → C2026 ko'chirishda bir qatorga siljigan: qarz boshqa odamdan ushlangan.
- Миб'dagi ismlar kirillda, C2026'dagilar lotinda, ular avtomatik ulanmaydi.
- Bonus va brak koeffitsientlari formulaning ichiga yozilgan (`+1000000`, `AJ4*1247`).
- Bitta odam 2–3 bo'limda turadi, avans va ushlanmasi alohida hisoblanadi.
- Ismsiz qatorga ham pul to'lanadi.
- Oy sarlavhasi eskirgan (oktabr fayli «Sentabr» deb yozilgan).
- `#REF!` xatolari va boshqa faylga tashqi havola bor.

---

## 2. Moslik: varaq → ERP (sahifa, model, API)

| Excel varag'i | ERP'da hozir bor | Yetishmaydi | ERP'dagi joyi |
|---|---|---|---|
| **Ауп** (oklad) | `Employee.payType=SALARY`, `tariffRate`; hisob `rate × kelgan kun ÷ normDays` (`lib/hr/payroll.ts`) | Soat qo'lda yozilmaydi (faqat kelish/ketish vaqti); kun = soat/8 hisobi yo'q; tahrirlanadigan 1..31 jadval yo'q | Otdel kadr → **Tabel** (yangi tahrir jadvali) |
| **Поврименшики, Сваршики** (kunbay) | `payType=DAILY` | Kun = soat/8; bonuslar formulaga yozilgan | Tabel + `PayAdjustment` (bonus) |
| **Brigada varaqlari** (sdelka) | `Product.pieceRate`, `brigadeOutput` (TaskProgress × narx), `ProductDefect`, `/brigades` | **Kunlik fond yo'q** (oylik fond oylik soatga bo'linadi — natija farq qiladi); o'tgan kunga mahsulot yozib bo'lmaydi; 10 000 yaxlitlash yo'q; brak sotuv narxida | Ishlab chiqarish → brigada kunlik hisoboti (`ProductionReport.data.daily`) → **kunlik fond** |
| **БРУ 1/2** | Faqat zavod nomi (reyslar uchun) | Smena ekipaji va beton bo'yicha haq yo'q | БРУ = brigada (mahsulot «Beton», m³ `ProductionBatch` dan yoki qo'lda) |
| **Shofyorlar** | `driver-trip-pay.ts` (reys narxi → payroll), Logistika → Hisob varag'i | Excel'da summa tashqaridan qo'lda yoziladi | Mavjud oqim, yalpi/qo'lga qoidasi kelishilishi kerak |
| **C2026** (bosh hisob) | `PayrollRun FINAL` / `PayrollLine`, holatlar Qoralama → Direktor → Kassir | Ushlanmalar **bitta `penalty`** ustuniga qo'shilib ketadi; Excel ustunlari (aliment, qarz, to'y puli, jarima, avans) alohida emas; C2026 ko'rinishidagi jadval va Excel eksport yo'q | Ish haqi → vedomost (yangi ustunli ko'rinish + eksport) |
| **Карз** (qarz daftari) | `EmployeeDebt` (kassadan «Oylikdan nasiya», teng bo'lib ushlanadi) | Boshlang'ich qoldiqni kiritib bo'lmaydi; oylik ushlanma qo'lda belgilanmaydi; «oylikdan qarz» turi yo'q | Ish haqi → Xodim qarzlari (kengaytiriladi) |
| **Миб карздорлik** | **Yo'q** | Sud/ijro va aliment: ish raqami, qarz, %, oylik ushlanma, qoldiq | Yangi: **Ushlab qolishlar** (`Withholding`) |
| **Tug'ilgan kun / to'y puli** | Yo'q (faqat HR eslatmasi) | Har oy belgilangan summa ushlanadi va fondga tushadi | Yangi: doimiy ushlanma (sozlama + istisnolar) |
| **Аванс наличка** | ADVANCE (avtomatik 40%) va EXTRA (xodim arizasi) | Amalda har kimga qo'lda belgilangan summa (1,2–1,5 mln); chop etiladigan ro'yxat yo'q | Avans vedomosti: summalar qo'lda + **chop etish (imzo ustuni)** |
| **Зарплата 2** | `payRun` (bitta hisobdan, satr to'liq to'lanadi) | Plastik/naqd bo'linmaydi; imzo ustunli ro'yxat yo'q | To'lov: naqd + plastik bo'lib to'lash, **chop etish** |
| **Повр / сварш** (yashirin, 2025) | — | Ishlatilmaydi | O'tkazilmaydi |

**API (mobil ilova).** Barcha mobil so'rovlar umumiy `/api/mobile/{list,detail,action,create}` orqali ishlaydi:
- **Brigadir:** soat va kunlik mahsulotni `action` (`att.*`, `task.progress`) orqali yozadi.
- **Xodim:** `oyligim` kartasida o'z hisob varag'ini ko'radi; bunga qarz va ushlanmalar qo'shiladi.
- **Direktor:** vedomostni tasdiqlaydi (mavjud).
- **Kassir:** to'lov qiladi (mavjud), naqd + plastik bo'lishi qo'shiladi.

---

## 3. ERP'da yangi ish jarayoni (kim, qayerda, nima qiladi)

1. **Har kuni — soatlar.** Brigadir telefondan o'z brigadasiga, Sekretar/HR vebda istalgan kun uchun yozadi.
   «Tabel» jadvali Excel'dagidek: guruh tanlanadi (AUP, Vaqtbay, Payvandchilar, Brigada…), qatorda xodim,
   ustunlarda 1..31 kun, katakka soat yoziladi (8, 4, 2…). Face ID yoki kelish-ketish vaqti bo'lsa, soat avtomatik
   to'ladi, qo'lda tuzatsa ham bo'ladi.
2. **Har kuni — mahsulot.** Ish boshqaruvchi yoki brigadir brigada × mahsulot sonini o'tgan kunlarga ham yozadi.
   Sdelka narxlari Sozlamalarda bir marta kiritiladi, 31 marta qayta yozilmaydi.
3. **Brak.** Mavjud brak yozuvi ishlatiladi. Brigada brakini a'zolarga soatiga qarab taqsimlash — Excel'dagi
   koeffitsient o'rniga avtomatik.
4. **Ushlanmalar** (Sekretar/Buxgalteriya, oyiga bir marta):
   - Карз: boshlang'ich qoldiq va oylik ushlanma; qoldiq keyingi oyga o'zi o'tadi.
   - Миб/aliment: ish raqami, qarz, oylik summa yoki foiz.
   - To'y puli: hammaga bitta summa, alohida istisnolar bilan.
   - Jarima va bonus: mavjud «Jarima va bonuslar».
5. **Avans (oy o'rtasida).** Avans vedomosti ochiladi, summalar oldingi oydan taklif qilinadi va o'zgartiriladi.
   Direktor tasdiqlaydi, kassir to'laydi, ro'yxat imzo ustuni bilan chop etiladi.
6. **Oy yakuni.** «Hisoblash» bosilganda C2026 ko'rinishidagi vedomost hosil bo'ladi:
   - **Bo'limlar:** AUP / Vaqtbay / Payvandchilar / БРУ / har brigada / Shofyorlar.
   - **Ustunlar:** yalpi · 12% · qo'lga · brak · aliment · qarz · oylikdan qarz · to'y puli · jarima · avans · qoldiq · plastik · naqd.
   - Bir xodim bir necha bo'limda ishlasa, **bitta qatorga yig'iladi**.
   - Direktor tasdiqlaydi, kassir naqd va plastik qilib to'laydi, «Зарплата» ro'yxati imzo bilan chop etiladi,
     Excel eksport ham shu ustunlarda.
7. **Xodim.** Ilovada va «Hisobim» sahifasida hisob varag'i va qarz qoldig'i ko'rinadi.

**Excel'dan ma'lumot tortish.** Fayl yuklanganda u alohida kitob bo'lib qolmaydi, ma'lumot ERP'ning o'z yozuvlariga
tushadi:
- tabel varaqlaridagi soatlar → Tabel;
- brigada va БРУ'dagi kunlik mahsulot soni → kunlik ishlab chiqarish;
- Карз → qarz qoldiqlari;
- Миб → ushlab qolishlar;
- C2026'dagi G–L ustunlar → ushlanmalar va avans.

Ismlar xodimlar bilan solishtiriladi (kirill/lotin `toLatin` va alias orqali). Topilmaganlari bitta oynada qo'lda
moslanadi; tanlov keyingi safar eslab qolinadi. Hozirgi «Oylik varaqlari» (Excel ERP ichida) o'tish davrida
**solishtirish uchun** qoladi.

---

## 4. Bosqichlar

| Bosqich | Nima qilinadi | Natija |
|---|---|---|
| **1. Tabel** | `Attendance.hours` (qo'lda soat). 1..31 tahrirlanadigan jadval guruhlar bo'yicha (veb + mobil brigadir). SALARY/DAILY hisobi soat/8 asosida. Excel'dagi tabel varaqlaridan import | Ауп, Поврименшики, Сваршики ERP'da yuritiladi |
| **2. Sdelka** | Brigada × mahsulot × kun soni (o'tgan kunga ham). **Kunlik fond** soatga bo'linadi, 10 000 ga yaxlitlanadi, brak soatga qarab. БРУ = brigada (beton m³). Brigada va БРУ varaqlaridan import | Brigada varaqlari ERP'da, natija Excel bilan teng |
| **3. Ushlanmalar** | Ushlanma turlari (brak, aliment, qarz, oylikdan qarz, to'y puli, jarima). `Withholding` (Миб/aliment). Qarz boshlang'ich qoldig'i va qo'lda oylik ushlanma. To'y puli fondi. Карз/Миб/C2026 dan import | Карз va Миб ERP'da, qo'lda ko'chirish yo'q |
| **4. Vedomost va to'lov** | C2026 ko'rinishidagi vedomost + Excel eksport. Qo'lda summali avans. Plastik/naqd bo'lib to'lash. Imzo ustunli chop etish (avans va oylik) | C2026, «Аванс наличка», «Зарплата 2» ERP'dan chiqadi |
| **5. Parallel oy** | 1 oy ham Excel, ham ERP. Xodim kesimida farq hisoboti. Farq bo'lmasa Excel to'xtatiladi | Ishonchli o'tish |

Har bosqichdan keyin: `tsc`, `eslint`, QA (`run-all.sh`), haqiqiy fayl bilan solishtirish (oktabr Excel natijasi = ERP natijasi).

### 1-bosqich holati (2026-11-17, bajarildi)
- **Joyi:** «Ish haqi» → **Tabel** (`/ish-haqi?tab=tabel&oy=YYYY-MM&guruh=…`); ruxsat `payroll.tabel` — Sekretar, direktor avtomatik.
- **Jadval:** guruhlar brigada → komanda → shofyorlar → bo'linma → ish haqi turi. Katakka soat yoki H/K/T/D yoziladi,
  avtomatik saqlanadi; ↑↓←→, Enter va Excel'dan blok joylash ishlaydi. Qatorda jami soat, kun, norma, stavka va
  taxminiy hisob.
- **Hisob qoidasi:** `Attendance.hours` (migratsiya `20261117155110_tabel_soat`). Oklad va kunbayda qo'lda soat yozilgan
  kun soat ÷ 8 kun bo'ladi, yozilmagan kelgan kun avvalgidek 1 kun. Vedomost hisobi tabeldagi «Hisob» bilan bir xil
  chiqqani tekshirildi.
- **Excel importi:** «Ф.И.О.» + 1..31 ustunli barcha varaqlar o'qiladi (oktabr faylida 10 varaq, 107 kishi). Ismlar
  aynan, o'xshash yoki eslab qolingan (`EmployeeAlias`) bo'yicha moslanadi, topilmaganlariga xodim tanlanadi.
- **Yopilish:** oy yakuni vedomosti direktorga yuborilgach tabel yopiladi; kelajak kuni va ishda bo'lmagan kunga yozilmaydi.
- **Qolgan:**
  - Brigadir telefondan soat yozishi (mobil ilovada maydon) — 2-bosqich bilan birga.
  - Brigada (sdelka) xodimlarining kunlik fondi — 2-bosqich.

### 2-bosqich holati (2026-11-17, bajarildi)
- **Joyi:** «Ish haqi» → Tabel → brigada guruhi. Excel'dagi brigada varag'i ko'rinishida:
  - tepada a'zolar × kun (shu brigadadagi soat), har birining ulushi, 10 000 ga yaxlitlangani, brak va summasi;
  - pastda mahsulot qatorlari × kun (soni) va narxi.
  - «Boshqa brigadadan xodim» qo'shiladi; brak qo'lda yoziladi yoki brak yozuvlaridan olinadi.
- **Model** (migratsiya `20261117161531_brigada_varaq`):
  - `BrigadeHours` — bir kunda bir nechta brigadada ishlash mumkin.
  - `BrigadeOutput`.
  - `BrigadeMonth` — qatorlar, narxlar, brak.
  - `Brigade.aliases` — Excel varaq nomi.
- **Hisob:** `lib/hr/brigade-calc.ts` — Excel formulasi: kunlik fond kun soatiga bo'linadi, ROUND(−4), brak soatga qarab.
  Varag'i to'ldirilgan brigadada vedomost sdelkani shundan oladi, boshqalarida avvalgidek. Kunbay yoki oklad xodim
  brigadada ham ishlasa, sdelka puli asosiyga qo'shiladi.
- **Import:** brigada varaqlari endi davomatga emas, brigada varag'iga tushadi (soat, soni, narx — Excel'dagidek qator
  tartibi bo'yicha, brak). Varaq ERP brigadasiga nomi, brigadiri yoki eslab qolingan nom bo'yicha moslanadi yoki yangi
  brigada ochiladi.
- **Tekshiruv (oktabr fayli):**
  - 7 varaqdagi 63 qatordan 62 tasi Excel'dagi «сумма + брак» bilan aynan teng. 1 tasi — Excel formulasiga qo'lda
    yozilgan +1 000 000 bonus; ERP'da u alohida bonus bo'lib kiritiladi.
  - Vedomost (FINAL) ham 54 sdelkachida Excel bilan mos.
  - Brak jami 4 609 056 — Excel bilan teng.
- **Qolgan:**
  - Brigadirning telefondan soat va soni yozishi (mobil ilova).
  - Tizimdagi ishlab chiqarish (topshiriq bajarilishi) sonini varaqqa taklif qilish.

---

## 5. Kelishib olinadigan savollar

1. **Narxlar yalpimi yoki qo'lga?** Excel'da narx va okladlarning ko'pi «qo'lga ÷ 0,88» qilib yozilgan, payvandchilar
   va ba'zi AUP esa yalpi. ERP'da hammasi yalpi saqlanadi, yonida «qo'lga» ham ko'rsatiladi. Shu ma'qulmi?
2. **Brak qanday baholanadi?** ERP'da hozir sotuv narxida (son × narx). Excel'da summa tashqarida hisoblanadi.
   Qaysi biri to'g'ri: sotuv narxi, sdelka narxi yoki qo'lda summa?
3. **Kim hisoblaydi?** Hozir Excel'ni Sekretar yuritadi, ERP'da hisoblash Otdel kadr/Buxgalteriyada. Sekretarga
   ham hisoblash ruxsati beriladimi?
4. **Plastik/naqd.** Excel'da plastik ustuni hozir bo'sh, hammasi naqd to'lanadi. Bo'lib to'lash hozir kerakmi
   yoki 4-bosqichda?
5. **Avans.** ERP'da avtomatik 40%, Excel'da qo'lda summa. Qo'lda summa (oldingi oydan taklif) qilinsinmi?
6. **Shofyorlar.** Haq Logistika → Hisob varag'idan avtomatik olinsinmi (hozir Excel'ga tashqaridan yoziladi)?
