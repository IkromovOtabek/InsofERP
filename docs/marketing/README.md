# INSOF Temir Beton — marketing to'plami

21 Agency tijorat taklifi (2026-yil oktabr, oyiga $2 200, reklama byudjeti alohida) asosida tuzilgan ishchi hujjatlar.
Maqsad: INSOF'ni quruvchilar (застройщики), xususiy uy quruvchilar va pudratchilar orasida tanitish —
Reels orqali zavodni ko'rsatish va INSOF'ni Yandex hamda Google qidiruviga olib chiqish.

Asosiy g'oya (taklifdan): ko'p pustotli plitalar (ПК) va FBS bloklar INSOF'da yirik zavodlarga nisbatan 20% gacha arzon,
lekin xaridor ko'pincha "tanigan joyidan" oladi. Demak vazifa — ishonch va tanilish.

> ERP'da ishlash: **Sotuv → Marketing** (kontent reja, reklama, SEO, UTM, AI agent). Kontent reja va semantik yadro
> shu hujjatlardan bazaga yuklanadi: `npm run marketing:seed` (qayta ishga tushirish xavfsiz).

## Fayllar

| Fayl | Nima bor | Kim ishlatadi |
|---|---|---|
| `01-strategiya.md` | Pozitsiyalash, auditoriyalar, voronkalar, kanallar, KPI formulalari, UTM qoidasi | Hamma; kelishuv hujjati |
| `02-raqobatchilar.md` | Raqobatchilar tahlili shabloni va ma'lumot yig'ish tartibi | Agentlik (to'ldiradi), INSOF (narxlarni tasdiqlaydi) |
| `03-kontent-reja.md` | 1-oy: 8 ta Reels ssenariysi, kalendar, stories/postlar, suratga olish kunlari rejasi | Agentlik (montaj), INSOF (zavod/obyektga kirish) |
| `04-seo-semantik-yadro.md` | Semantik yadro, klaster → sahifa, title/description (RU+UZ), 12 ta maqola, texnik SEO | Agentlik (SEO), dasturchi (sayt) |
| `05-reklama.md` | Yandex Direct, Google Ads, Instagram/Facebook kampaniyalari tuzilmasi, matnlar, konversiya maqsadlari | Agentlik (sozlaydi), INSOF (byudjetni tasdiqlaydi) |
| `06-hisobot-shabloni.md` | Oylik hisobot shabloni: metrikalar, Reels, reklama, SEO, ERP'dagi lidlar, xulosa | Agentlik (har oy to'ldiradi), INSOF (qabul qiladi) |
| `07-smm-ulash.md` | SMM: tasdiqlash oqimi, Instagram/Facebook/Telegram va Target kalitlarini ulash | Direktor, dasturchi |

## Muhim belgilar

- `[aniqlash kerak]` — kompaniyadan olinadigan ma'lumot (narx, o'lcham, ruxsat va h.k.). Uni o'ylab topmang.
- `[Wordstat'dan olinadi]` — qidiruv chastotasi Yandex Wordstat / Google Keyword Planner'dan olinadi.
- `insof.uz` — **domen hali tanlanmagan**, hamma joyda vaqtincha shu yozilgan. Domen aniq bo'lgach, butun to'plamda almashtiring:
  `grep -rl "insof.uz" . | xargs sed -i '' 's/insof\.uz/YANGI-DOMEN/g'`
- Faqat katalogdagi faktlar ishlatilgan (1-bo'lim, `01-strategiya.md`). Yangi raqam qo'shishdan oldin texnolog/laboratoriya tasdiqlasin.

## Katalogdan aniqlanishi kerak bo'lgan ziddiyatlar (reklamaga chiqishdan oldin)

1. ПК plitalar katalogda "M450–M500 betondan" deyilgan, 11 m plita misolida esa "M400 og'ir beton". Qaysi biri qaysi plitaga tegishli — `[aniqlash kerak]`.
2. 11 m plita og'irligi 1125 kg — eni va qalinligi ko'rsatilmagan. Reels va saytda shu misol ishlatilsa, to'liq markasi (masalan, ПК 110-xx-x) `[aniqlash kerak]`.
3. "20% gacha arzon" — qiyosiy reklama da'vosi. Raqobatchi narxlari bilan hujjatlashtirilgan jadval bo'lishi shart
   (`02-raqobatchilar.md`, narx bo'limi). Isbotsiz da'vo O'zbekiston reklama qonunchiligi bo'yicha xavfli — yuristdan so'rang `[aniqlash kerak]`.

## 30 kunlik ishga tushirish rejasi

Boshlanish: 2026-10-19 (dushanba). Reels nashri 20-oktabrdan, haftasiga 2 ta (seshanba, juma).

**0-hafta (15–18 oktabr), shart:** shartnoma, brif va zavodda 1-suratga olish kuni (16 yoki 17-oktabr) —
aks holda 20-oktabrdagi Reels #1 uchun material bo'lmaydi. Reels #1 va #2 montaji 18-oktabrgacha tayyor bo'lsin.

### 1-hafta (19–25 oktabr) — tayyorgarlik va birinchi suratga olish

| Agentlik | INSOF tomoni | Dasturchi (sayt) |
|---|---|---|
| Brif: INSOF bilan 1 soatlik intervyu (narxlar, afzalliklar, mashhur obyektlar) | Mas'ul shaxs tayinlash (marketing bo'yicha bitta odam, Telegram'da javob beradi) | Domenni tanlash va ro'yxatdan o'tkazish (`insof.uz` vaqtinchalik) |
| Raqobatchilar ro'yxati (kamida 8 ta), ma'lumot yig'ishni boshlash | Narxlar ro'yxati (ПК, FBS, beton M200–M600, yetkazib berish tariflari) — PDF yoki Excel | Yandex Metrica + GA4 o'rnatish, maqsadlar (`05-reklama.md`, 6-bo'lim) |
| Instagram profilini tartibga solish: bio, highlights, havola (UTM bilan) | Zavodda suratga olish kunini tasdiqlash, laboratoriya va sexlarga ruxsat | Sayt formasi → ERP `Lead` (manba + UTM saqlansin) |
| Zavod materiallaridan Reels #3, #4 montaji (1-kun 0-haftada olingan) | Kadrga chiqadigan 3 kishi: texnolog, laborant va sotuv menejeri (0-haftada) | `robots.txt`, `sitemap.xml`, hreflang ru/uz |
| Reels #1 montaj va nashr (20-okt), #2 (23-okt) | Telefon raqami +998 33 000 14 18 ga kelgan qo'ng'iroqlarni "qayerdan bildingiz?" deb so'rash va yozib borish | Yandex Webmaster, Google Search Console'ga saytni qo'shish |

### 2-hafta (26 oktabr – 1 noyabr) — reklama va obyekt

| Agentlik | INSOF tomoni | Dasturchi (sayt) |
|---|---|---|
| Yandex Direct: qidiruv kampaniyalarini ishga tushirish (ПК, FBS, beton) | Reklama byudjetini tasdiqlash va to'lash (agentlik hisobi yoki o'z kabineti — kabinet INSOF nomida bo'lsin) | Kalkulyator sahifasi `/ru/kalkulyator` — telefon/forma maqsadlari ishlayaptimi, sinash |
| Google Ads: qidiruv kampaniyalari | Obyektda suratga olish: kamida 1 ta mijoz roziligi (uy yoki bino, INSOF plitasi/betoni bilan) | `schema.org` LocalBusiness + Product + FAQ |
| Obyektda suratga olish (2-kun) | Kechasi/dam olish kuni yetkazib berish reysini suratga olishga ruxsat (Reels #5) | Sahifa tezligi: PageSpeed mobil > 80 (rasmlar WebP, lazy-load) |
| Reels #3 (27-okt), #4 (30-okt) | Yandex Biznes va Google Business Profile tasdiqlash kodini qabul qilish (pochta/telefon) | Telefon raqamini `tel:` havola, Telegram tugmasi — maqsadlar bilan |

### 3-hafta (2–8 noyabr) — targeting va SEO

| Agentlik | INSOF tomoni | Dasturchi (sayt) |
|---|---|---|
| Instagram/Facebook targeting: Reels'ni reklama sifatida, lid-forma | Lid-formalar va qo'ng'iroqlarga 15 daqiqa ichida javob (ish vaqtida) | Katalog sahifalariga title/description joylash (`04-seo-semantik-yadro.md`) |
| Yandex RSYA va Google PMax/xaritalar | 2GIS, Yandex Xaritalar kartochkasi: rasm, ish vaqti, mahsulotlar | 1-maqola: "Что означает маркировка ПК 63-12-8" |
| Semantik yadroni Wordstat bilan to'ldirish, minus-so'zlar | Mijozlardan sharh so'rash (Yandex Xaritalar / Google) — kamida 5 ta | Maqola shabloni `/ru/stati/...` + ichki havolalar katalogga |
| Reels #5 (3-noy), #6 (6-noy) | ERP'da lidlarni `/leads` orqali yuritish, holatni yangilash | QR nakladnoy sahifasidan saytga havola (brend tanilishi) |

### 4-hafta (9–15 noyabr) — optimallashtirish va hisobot

| Agentlik | INSOF tomoni | Dasturchi (sayt) |
|---|---|---|
| Kalit so'z va e'lonlarni tozalash: qimmat/konversiyasiz so'rovlarni o'chirish | Bitimlar soni va summasini agentlikka berish (ERP'dan, manba bo'yicha) | 2-maqola, `/uz/` sahifalar uchun matnlar tekshiruvi |
| Reels #7 (10-noy), #8 (13-noy) | 2-oy uchun suratga olinadigan obyektlar ro'yxati | Search Console / Webmaster xatolarini tuzatish |
| 1-oy hisoboti (`06-hisobot-shabloni.md`), 2-oy kontent rejasi | Hisobotni qabul qilish, keyingi oy byudjetini tasdiqlash | Hisobot uchun ERP eksport: lidlar manba bo'yicha |

## Dasturchi uchun texnik eslatma (ERP bog'lanishi)

ERP'da tayyor `Lead` modeli bor (`prisma/schema.prisma`, `model Lead`: `name`, `phone`, `productId`, `qty`, `address`,
`message`, `source` — standart `"landing"`, holatlar `NEW / IN_PROGRESS / CONVERTED / REJECTED`, sahifa `/leads`).
Sayt formasi shu modelga yozsin. Hozir `source` bitta qator — UTM'ni saqlash uchun ikki yo'l:

- tez: `source` ga `utm_source/utm_medium/utm_campaign` ni birlashtirib yozish (masalan `yandex/cpc/ya_search_pk`);
- to'g'ri: `Lead` ga `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `utmTerm`, `landingUrl` maydonlarini qo'shish (migratsiya — avval reja).

Bu bo'lmasa, oylik hisobotda "qaysi kanal bitim olib keldi" savoliga javob bo'lmaydi.
