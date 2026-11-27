# Insof ERP — «Sotuv / CRM» moduli
### Claude Code uchun yo'riqnoma va texnik topshiriq

> **Programmistga:** bu faylni loyiha repozitoriysiga `docs/CRM_SPEC.md` qilib qo'ying va Claude Code'ga quyidagi buyruqni bering:
>
> ```
> docs/CRM_SPEC.md faylini to'liq o'qi. Keyin repozitoriyni o'rgan: stack, ma'lumotlar bazasi,
> avtorizatsiya, mavjud "Buyurtmalar" bo'limi qanday yozilgan. Shundan keyin menga 0-bosqich
> hisobotini ber (nima topding, qanday qilishni taklif qilasan) va mening tasdig'imni kut.
> Har bosqichni alohida bajar, oxirida to'xtab natijani ko'rsat.
> ```

---

## 1. Kontekst: kim, nima uchun

**Korxona:** beton plita, beton va opora ishlab chiqaradigan zavod (Insof). Insof ERP — zavodning o'z veb-tizimi (`insof-erp.uz`), unda allaqachon buyurtmalar bo'limi bor.

**Foydalanuvchilar:**

| Kim | Roli | Qayerdan ishlaydi |
|---|---|---|
| Mirzakarimov Sarvar | Ish boshqaruvchisi (menejer). Hammasini ko'radi, hisobotlar unga kerak | Kompyuter va telefon |
| Normirzayeva Mushtariy | Sotuv operatori. Har kuni 30–40 ta mijozga qo'ng'iroq qiladi | Asosan telefon |

**Hozirgi holat:** sotuv Google Sheets'da («Mijozlar bazasi» fayli) yuritiladi: 101 ta mijoz, ~160 ta aloqa (qo'ng'iroq) yozuvi. Lidlar asosan davlat tender saytlaridan keladi: **tender.mc.uz** va **uztender.com** (g'olib bo'lgan pudratchilar — ularga plita/beton kerak bo'ladi).

**Muammo:** jadval murakkablashib ketdi — 20 dan ortiq varaq, mijozlar aralash, telefonda ishlash noqulay, voronkani ko'rish qiyin.

**Maqsad:** ERP ichida oddiy, telefonda qulay CRM:
1. Operator ertalab ochadi → **bugun kimga qo'ng'iroq qilishi** kerakligini ko'radi.
2. Qo'ng'iroqdan keyin **10 soniyada** natijani yozadi (2–3 bosish).
3. Menejer **voronkani** va **kim qayerda yo'qotilayotganini** ko'radi.
4. Zayafka tushsa — u ERP'ning mavjud buyurtmalar bo'limiga o'tadi.

**Asosiy tamoyil:** operatorning har bosishi qimmat. Kam maydon, katta tugmalar, standart qiymatlar avtomatik to'lsin.

---

## 2. Claude, ishlash qoidalaring

1. **Avval o'rgan, keyin yoz.** Repozitoriydagi mavjud uslubni (framework, ORM, papka tuzilmasi, UI komponentlari, nomlash) aniqlab, aynan shunga mos yoz. Yangi framework yoki katta kutubxona qo'shishdan oldin so'ra.
2. **Mavjud narsani buzma.** Mavjud jadvallar, buyurtmalar bo'limi va API'ni o'zgartirish kerak bo'lsa — avval rejani ko'rsat va ruxsat ol. Hech qanday ma'lumotni o'chirma.
3. **Bosqichma-bosqich** (8-bo'lim). Har bosqich oxirida: nima qilindi, qanday tekshirish mumkin, keyingi bosqich. Keyin to'xta.
4. **Migratsiyalar** orqali bazani o'zgartir, qaytariladigan bo'lsin.
5. **Kodda nomlar ingliz tilida** (`clients`, `contacts`), **interfeys matni o'zbek lotin tilida** (bu hujjatdagi so'zlar bilan aynan bir xil). Matnlarni bitta joyda saqla (keyin rus tili qo'shilishi mumkin).
6. **Mobile-first.** Har ekran avval 390 px kenglikda ishlashi kerak, keyin kompyuterga kengayadi. Tugmalar kamida 44 px.
7. Tushunmagan joyingni **o'ylab topma** — 10-bo'limdagi savollar ro'yxatiga qo'sh va so'ra.

---

## 3. Ma'lumotlar modeli

### 3.1. `clients` — Mijozlar (har firma bitta marta)

| Maydon | Turi | Interfeysdagi nomi | Izoh |
|---|---|---|---|
| id | PK | — | |
| name | string, majburiy | Mijoz nomi | «ZASTROY MCHJ» |
| inn | string, null | STIR | 9 raqam, bo'sh joylarsiz saqlansin. **Unikal** (bo'sh bo'lmasa) |
| contact_person | string | Aloqa shaxsi | |
| phone | string | Telefon | `+998XXXXXXXXX` ko'rinishiga normallashtirilsin |
| region | string | Viloyat / shahar | |
| district | string | Tuman | |
| object_type | string | Nima qurilmoqda | |
| foreman_name | string | Prorab | |
| foreman_phone | string | Prorab telefoni | |
| client_type | enum | Mijoz turi | 3.5-bo'lim |
| source | enum, majburiy | Manba | 3.5-bo'lim |
| status | enum | Holat | 3.5-bo'lim; 4.3-bo'limdagi qoida bo'yicha avtomatik |
| owner_id | FK users | Mas'ul xodim | standart: yaratgan xodim |
| link | string | Havola | tender sahifasi URL |
| note | text | Izoh | |
| created_at, updated_at | | | |

**Hisoblanadigan (bazada saqlanmaydi yoki kesh):** birinchi / oxirgi aloqa sanasi, **keyingi aloqa sanasi** (eng oxirgi aloqadagi `next_contact_date`), zayafkalar soni va summasi (bekor qilinganlarsiz), oxirgi zayafka sanasi, **faollik** (4.4).

**Dublikat tekshiruvi:** yangi mijoz qo'shilayotganda STIR yoki normallashtirilgan telefon bo'yicha mavjud mijoz topilsa — ogohlantirish va «Shu mijozni ochish» tugmasi.

### 3.2. `contacts` — Aloqalar (har qo'ng'iroq/yozishma — yangi qator)

| Maydon | Turi | Interfeysdagi nomi | Izoh |
|---|---|---|---|
| id | PK | | |
| client_id | FK clients, majburiy | Mijoz | |
| date | date, majburiy | Sana | standart: bugun |
| channel | enum | Aloqa turi | standart: Qo'ng'iroq |
| result | enum, majburiy | Natija | **eng muhim maydon**, 3.5 |
| product | enum, null | Mahsulot | |
| offered_price | decimal, null | Taklif narxi (so'm) | |
| next_contact_date | date, null | Keyingi aloqa sanasi | 4.2-bo'lim qoidalari |
| user_id | FK users | Mas'ul xodim | standart: joriy foydalanuvchi |
| lead_source | enum | Lid manbasi | standart: mijozning `source`'i |
| object_name | string | Obyekt nomi / ish tavsifi | |
| object_area | string | Obyekt hududi | |
| note | text | Izoh | |

Aloqa **tahrirlanmaydi va o'chirilmaydi** (faqat menejer, sababi bilan). Bu tarix.

### 3.3. Zayafkalar

ERP'da buyurtmalar jadvali allaqachon bor. **Yangi jadval yaratma** — mavjud buyurtmalar jadvaliga `client_id` (va kerak bo'lsa `contact_id`) bog'lanishini qo'sh. Kerakli maydonlar (mavjudlarida bo'lmasa — taklif qil):

Sana · Mijoz · Mahsulot · Hajmi · O'lchov birligi · Narx (birlik uchun) · Summa · Yetkazish manzili · Tuman · Prorab va telefoni · Kerak bo'ladigan sana · **Holat** (Yangi / Tasdiqlandi / Yuk xati berildi / Yetkazildi / Bekor qilindi) · Mas'ul xodim · **To'lov holati** (To'lanmagan / Qisman to'landi / To'liq to'landi) · To'langan summa · Izoh.

### 3.4. `lead_objects` — Topilgan obyektlar (ixtiyoriy, 7-bosqich)

Tender saytlaridan topilgan, lekin hali mijozga aylanmagan obyektlar. Holatlar: Yangi topildi → Aloqa qilindi → Mijozga aylandi / Kerak emas. «Mijozga aylandi» bosilganda `clients`'ga yozuv yaratiladi.

### 3.5. Ro'yxatlar (enum yoki sozlanadigan ma'lumotnoma jadvali)

Menejer keyin qo'sha olishi uchun **ma'lumotnoma jadvali** sifatida qilish afzal.

**Manba:** tender.mc.uz · UzTender (uztender.com) · Reklama · Realizator (ko'chada) · OLX · Telegram kanal yoki guruh · Instagram yoki Facebook · Google / 2GIS · O'z saytimiz · Boshqa sayt · Tavsiya · O'zi murojaat qildi · Eski mijoz

**Mijoz turi:** Quruvchi firma · Pudratchi · Davlat buyurtmachisi · Savdo / dilyer · Yakka shaxs

**Mahsulot:** Plita · Beton · Opora · Boshqa

**Aloqa turi:** Qo'ng'iroq · Telegram · Uchrashuv · Kiruvchi qo'ng'iroq · Reklama orqali murojaat

**Mijoz holati:** Yangi · Aloqa qilindi · Muzokara · Ishlayotgan · Eski mijoz · Yo'qotilgan

**Natija** — har biri voronka bosqichiga va guruhga bog'langan (bu jadval — butun tizimning yuragi):

| Natija | Voronka bosqichi (eng yuqori yetgan) | Guruh | Keyingi aloqa sanasi |
|---|---|---|---|
| Telefon ko'tarmadi | 1 | Javob yo'q | majburiy, standart: ertaga |
| Telefon o'chiq | 1 | Javob yo'q | majburiy, standart: ertaga |
| Telefon raqam notogri | 1 | Yo'qotish | kerak emas |
| Band, keyinroq | 2 | Davom | majburiy |
| Gaplashildi | 2 | Davom | majburiy |
| Qayta aloqa kerak | 2 | Davom | majburiy |
| Kerak emas | 2 | **Otkaz** | kerak emas |
| Lokatsiyasi uzoq | 2 | **Otkaz** | kerak emas |
| Raqobatchidan oldi | 2 | **Otkaz** | kerak emas |
| Ehtiyoji bor | 3 | Davom | majburiy |
| Narx so'radi | 3 | Davom | majburiy |
| Keyinroq kerak (obyekt boshlanmagan) | 3 | **Kutilayotgan** | majburiy (odatda +1 oy) |
| Taklif yuborildi | 4 | Davom | majburiy, standart: +2 kun |
| Qimmat dedi | 4 | **Otkaz** | ixtiyoriy |
| Muzokarada | 5 | Davom | majburiy |
| Zayafka oldim | 6 | Yutuq | kerak emas → zayafka formasi ochiladi |

---

## 4. Biznes mantiq

### 4.1. Voronka (7 bosqich)

Tanlangan davr (sanadan–sanagacha) va xodim bo'yicha, **unikal mijozlar soni**. Bosqichlar **jamlanuvchi**: 4-bosqichga yetgan mijoz 1, 2, 3-bosqichlarda ham sanaladi.

| # | Bosqich | Mijoz shu bosqichda sanaladi, agar davr ichida… |
|---|---|---|
| 1 | Lid / aloqa | kamida bitta aloqasi bo'lsa |
| 2 | Javob berdi | bosqichi ≥ 2 bo'lgan natija bo'lsa |
| 3 | Ehtiyoji bor | bosqichi ≥ 3 bo'lgan natija bo'lsa |
| 4 | Taklif yuborildi | bosqichi ≥ 4 |
| 5 | Muzokara | «Muzokarada» yoki «Zayafka oldim» |
| 6 | Zayafka | «Zayafka oldim» **yoki** davr ichida bekor qilinmagan buyurtmasi bor |
| 7 | Yetkazildi | davr ichidagi buyurtmasi holati «Yetkazildi» |

Har bosqich uchun: son, boshidan % (`n / bosqich1`), oldingi bosqichdan % (`n / oldingi`). Har bosqich **bosiladigan** — o'sha mijozlar ro'yxati ochiladi.

**Yonida:**
- **Kutilayotgan mijozlar** — **oxirgi** aloqasi natijasi «Keyinroq kerak» bo'lganlar (davrdan qat'iy nazar). Keyingi aloqa sanasi bo'yicha oylarga guruhlab ko'rsatish: «Dekabrda 4 ta obyekt boshlanadi».
- **Otkaz sabablari** — davr ichida har «Otkaz» natijasi soni + «Raqam noto'g'ri».
- **To'lov** — davr ichida to'liq to'langan zayafkalar soni va to'langan summa.

### 4.2. Keyingi aloqa sanasi

- 3.5-jadvaldagi «majburiy» natijalarda sanasiz saqlab bo'lmaydi.
- Formada tezkor tugmalar: **Ertaga · 3 kun · 1 hafta · 1 oy** + kalendar.
- Dam olish kuni (yakshanba) tanlansa — ogohlantirish, dushanbani taklif qilish.

### 4.3. Mijoz holatini avtomatik yangilash

Yangi aloqa saqlanganda (menejer qo'lda o'zgartira oladi, qo'lda o'zgartirilgan holat ustidan yozilmasin):

- aloqasi yo'q → **Yangi**
- oxirgi natija bosqichi 1–3 → **Aloqa qilindi**
- bosqich 4–5 → **Muzokara**
- zayafkasi bor, oxirgi zayafkadan ≤ 90 kun → **Ishlayotgan**
- oxirgi zayafkadan > 90 kun → **Eski mijoz**
- oxirgi natija «Otkaz» guruhida yoki «Raqam noto'g'ri» → **Yo'qotilgan**

### 4.4. Faollik (mijoz kartochkasida va ro'yxatda belgi)

Zayafka yo'q · **Faol** (oxirgi zayafkadan ≤ 30 kun) · **Sovib qoldi** (31–90 kun) · **Eski: qayta aloqa kerak** (> 90 kun). Chegaralar (30 va 90) sozlamalarda o'zgartiriladi.

### 4.5. Ruxsatlar

- **Operator:** hamma mijozni ko'radi va qidiradi, yangi mijoz va aloqa qo'shadi, o'z aloqalarini ko'radi. Aloqani o'chira olmaydi.
- **Menejer:** hammasi + mas'ul xodimni almashtirish, ma'lumotnomalarni tahrirlash, import, hisobotlar.
- ERP'da rollar tizimi bo'lsa — o'shandan foydalan.

---

## 5. Ekranlar

Vizual maket (5 ta telefon ekrani, bosib yurish mumkin) — menejer alohida havola qilib beradi: **[maket havolasi — menejerdan oling]**. Ranglar va uslub — ERP'ning mavjud dizayniga moslashtirilsin; maket faqat tuzilma va mantiq uchun.

Pastki menyu (telefonda): **📞 Bugun · 👥 Mijozlar · 🔻 Voronka · 📝 Aloqalar**. Kompyuterda — chap yon menyu.

### 5.1. Bugun (bosh ekran)
- Sarlavha: sana, «N ta mijoz».
- Ikki chip: **O'tib ketgan · N** (qizil) va **Bugun · N** (ko'k).
- Ro'yxat: keyingi aloqa sanasi ≤ bugun, holati «Yo'qotilgan» emas. Tartib: eng eski muddat tepada.
- Kartochka: nom, telefon, mas'ul xodim, holat chipi, «Muddat o'tgan: 22.11» yoki «Bugun». O'ngda yashil **qo'ng'iroq tugmasi** (`tel:` havolasi).
- Kartochkani bosish → mijoz kartochkasi.
- Operator o'z mijozlarini ko'radi, menejer hammasini (filtr bilan).

### 5.2. Mijozlar
- Qidiruv: nom, telefon (raqamlarning istalgan qismi, bo'sh joy/tire hisobga olinmasin), STIR, viloyat, prorab.
- Filtr chiplari: Hammasi · Yangi · Ishlayotgan · Kutilayotgan · Otkaz · + manba va xodim bo'yicha.
- Qator: bosh harflar doirasi, nom, «Viloyat · Manba», holat chipi.
- **＋** tugmasi → yangi mijoz formasi (dublikat tekshiruvi bilan).

### 5.3. Mijoz kartochkasi
- Tepada: nom, holat, manba · mas'ul xodim.
- 4 ta katta tugma: **Qo'ng'iroq · Telegram** (`https://t.me/+998…`) · **Aloqa yozish** (asosiy) · **Zayafka**.
- «Voronkadagi joyi» — 7 bo'lakli chiziq, nechtasi to'lgani + «Keyingisi: …».
- Ma'lumotlar: telefon, hudud, manba, mas'ul, keyingi aloqa, STIR, prorab, havola.
- **Aloqalar tarixi** — vaqt chizig'i, yangisi tepada: natija, sana · tur · xodim, izoh.
- Zayafkalar ro'yxati (summa, holat, to'lov).

### 5.4. Aloqa yozish (eng ko'p ishlatiladigan forma — eng tez bo'lishi shart)
- Mijoz (kartochkadan kelganda avtomatik), Sana (bugun), Xodim (joriy).
- Aloqa turi — 3 segmentli tugma.
- **Natija — chip-tugmalar** (dropdown emas!), guruhlab: Davom / Kutilayotgan / Otkaz / Javob yo'q.
- Natija tanlanganda keyingi aloqa sanasi standart qiymat bilan avtomatik to'ladi (3.5-jadval), tezkor tugmalar.
- «Zayafka oldim» tanlansa → saqlangandan keyin zayafka formasi ochiladi, mijoz ma'lumotlari to'ldirilgan holda.
- Izoh (ixtiyoriy). Pastda katta **Saqlash**.
- Maqsad: oddiy holatda **3 bosish** — natija → (sana avtomatik) → Saqlash.

### 5.5. Voronka
- Davr: Bugun · Hafta · Oy · O'zim tanlayman. Xodim: Hammasi / har biri.
- 7 qavatli rangli voronka (qizil → to'q sariq → sariq → yashil), har qavat kengligi pastga qarab kichrayadi, ichida son va %.
- Ostida: bosqichlar orasidagi o'tish %, Kutilayotgan, Otkaz sabablari, To'lov.
- **Xodimlar bo'yicha jadval:** jami aloqa, javob berdi, ko'tarmadi, taklif, zayafka, qimmat dedi, otkaz.
- **Lid manbalari jadvali:** har manba bo'yicha — mijozlar, zayafka, konversiya %. (Menejer uchun asosiy savol: *tender.mc.uz yoki UzTender — qaysi biri ko'proq zayafka beradi?*)

---

## 6. Google Sheets'dan import (bir martalik)

Menejer «Mijozlar bazasi» faylidan uchta varaqni CSV qilib beradi: **Mijozlar**, **Aloqalar**, **Zayafkalar**. Import buyrug'i/sahifasi yoz:

- Avval **quruq ishga tushirish** (dry-run): nechta yoziladi, nechta dublikat, nechta xato — hisobot. Keyin tasdiq bilan haqiqiy import.
- Ustunlar sarlavha nomi bo'yicha moslashtirilsin (3.1–3.3 jadvallaridagi «Interfeysdagi nomi»).
- Sanalar `dd.mm.yyyy` formatida.
- Telefonlar har xil yozilgan (`+998 99 860 88 83`, `998 99 441-07-33`) — normallashtir.
- Manba: **«Tender sayti» → tender.mc.uz**. Mijozlar varag'ida manbasi bo'sh ~37 ta mijoz bor — ularga Aloqalar varag'idagi «Lid manbasi» ustunidan (shu mijozning birinchi aloqasi) ol.
- Mijozlar orasida bo'sh qatorlar bor — tashlab ket.
- Aloqalar → mijozga **nom bo'yicha** bog'lanadi (aniq moslik, keyin bo'sh joy/registrni e'tiborsiz qoldirib). Topilmaganlari hisobotga.
- Hisoblanadigan ustunlar (Oxirgi aloqa, Faollik va h.k.) import qilinmaydi — tizim o'zi hisoblaydi.
- Import qayta ishga tushirilsa dublikat yaratmasin.

---

## 7. Telegram bot uchun API

Zavodning Telegram hisobot boti hozir Google Sheets'dan o'qiydi. Unga ERP'dan o'qishi uchun **faqat o'qish** (read-only) endpointlari kerak, token bilan himoyalangan:

- `GET /api/crm/summary?from=&to=&user=` — jami aloqa, javob berdi, ko'tarmadi, taklif, zayafka, qimmat, otkaz, kutilayotgan.
- `GET /api/crm/funnel?from=&to=&user=` — 7 bosqich: son, %.
- `GET /api/crm/today?user=` — bugun qo'ng'iroq qilinadiganlar ro'yxati.
- `GET /api/crm/clients/search?q=` — mijoz kartochkasi + oxirgi 5 aloqa.
- `GET /api/crm/sources?from=&to=` — manbalar bo'yicha.

Javob formati — JSON. Bot kodi bu topshiriqqa kirmaydi, faqat API.

---

## 8. Ish bosqichlari

Har bosqich oxirida to'xta va natijani ko'rsat.

| Bosqich | Nima | Qabul qilish mezoni |
|---|---|---|
| **0. O'rganish** | Repozitoriy tahlili, reja, 10-bo'limdagi savollarga javob so'rash | Menejer rejani tasdiqladi |
| **1. Baza** | Migratsiyalar: clients, contacts, ma'lumotnomalar, buyurtmalarga bog'lanish | Migratsiya o'tadi va qaytariladi |
| **2. Mijozlar** | Ro'yxat, qidiruv, filtr, kartochka, yangi mijoz, dublikat tekshiruvi | Telefonda 390 px'da ishlaydi |
| **3. Aloqa yozish + Bugun** | Forma, natija qoidalari, avto-holat, Bugun ekrani | Oddiy aloqa 3 bosishda yoziladi |
| **4. Import** | CSV import, dry-run hisobot | 101 mijoz va ~160 aloqa xatosiz ko'chdi |
| **5. Voronka va hisobotlar** | 4.1-bo'lim, xodimlar, manbalar | 9-bo'limdagi tekshiruv mos keladi |
| **6. Zayafka integratsiyasi** | «Zayafka oldim» → buyurtma, to'lov holati | Buyurtma mijoz kartochkasida ko'rinadi |
| **7. API + obyektlar** | 7-bo'lim, 3.4-bo'lim | Bot endpointlardan javob oladi |

---

## 9. Tekshiruv uchun haqiqiy misollar

Import qilingandan keyin hisob to'g'riligini shular bilan tekshir (Google Sheets'dagi hisob bilan mos kelishi kerak):

- **25.11.2026, barcha xodimlar:** jami 37 ta aloqa; shundan «Telefon ko'tarmadi» + «Telefon o'chiq» = 13; «Telefon raqam notogri» = 6; «Kerak emas» = 9; «Zayafka oldim» = 1; 1 ta aloqaning natijasi bo'sh.
- **26.11.2026 (kunduzgi holat):** voronka 6 → 2 → 1 → 1 → 0 → 0 → 0.
- Mijoz **ZASTROY MCHJ**: 26.11 da «Taklif yuborildi», keyingi aloqa 27.11.2026, manba UzTender, mas'ul Mushtariy → voronkada 4-bosqich, holati «Muzokara».

Natijasi bo'sh eski aloqalar import qilinadi, lekin voronkada faqat 1-bosqichda sanaladi.

---

## 10. Boshlashdan oldin menejerdan so'raladigan savollar

1. ERP'da foydalanuvchilar va rollar bormi? Mushtariy uchun akkaunt bormi?
2. Mavjud buyurtmalar jadvalida qaysi maydonlar bor, to'lovlar qayerda yuritiladi?
3. Operator boshqa xodimning mijozlarini ham ko'rishi va ularga aloqa yozishi mumkinmi?
4. Telegram bot qayerda ishlaydi, kim yozgan, qanday ulanadi?
5. Tender saytlaridan lidlar keyinchalik avtomatik olinsinmi (alohida loyiha)?
6. Interfeysga rus tili kerakmi?

---

*Bu hujjat Google Sheets'dagi mavjud «Mijozlar bazasi» tizimi (Mijozlar, Aloqalar, Zayafkalar varaqlari, 7 bosqichli voronka, kunlik panel) asosida tuzilgan. O'sha jadval ERP ishga tushguncha ishlashda davom etadi.*
