# 02. Raqobatchilar tahlili (shablon)

Bozor: Toshkent shahri va viloyati, Sirdaryo, Jizzax — yig'ma temir-beton (ПК plitalar, FBS, ЖБИ) va tovar beton.
Bu fayl **shablon**: hech qanday raqobatchi fakti o'ylab topilmaydi. Har bir katak manba bilan to'ldiriladi
(skrinshot yoki havola `manbalar/` papkasiga saqlanadi, sana bilan).

Maqsad: (1) "20% gacha arzon" da'vosini isbotlash yoki to'g'rilash; (2) raqobatchilar kuchsiz joylarini topish;
(3) reklama va SEO'da kim qaysi so'rovni egallaganini bilish.

## 1. Asosiy jadval

Kamida 8 ta raqobatchi: 3 ta yirik zavod (INSOF o'zini solishtiradigan), 3 ta o'rta zavod, 2 ta beton uzeli/dilery.

| # | Nomi | Turi (yirik zavod / o'rta / beton uzeli / diler) | Mahsulotlar (ПК, FBS, beton, halqa, bordyur, lotok, peremichka, inert) | Narx oralig'i (ПК, FBS, beton M300) | Instagram (akkaunt, obunachi, oxirgi 30 kunda post/Reels soni) | Sayt (bor/yo'q, narx ko'rsatiladimi, kalkulyator) | SEO ko'rinishi (asosiy 10 so'rovdan nechtasida TOP-10, Yandex/Google) | Reklama (Yandex, Google, Meta — faolmi, qaysi so'rov/kreativ) | USP (o'zi nimani da'vo qiladi) | Kuchsiz joylar | Manba va sana |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `[nomi]` | | | | | | | | | | |
| 2 | `[nomi]` | | | | | | | | | | |
| 3 | `[nomi]` | | | | | | | | | | |
| 4 | `[nomi]` | | | | | | | | | | |
| 5 | `[nomi]` | | | | | | | | | | |
| 6 | `[nomi]` | | | | | | | | | | |
| 7 | `[nomi]` | | | | | | | | | | |
| 8 | `[nomi]` | | | | | | | | | | |
| — | **INSOF** (taqqoslash uchun) | Zavod (2 ta maydon) | ПК, FBS, beton M200–M600, ustun, bordyur, КС, lotok, peremichka, inert | `[aniqlash kerak]` | `[aniqlash kerak]` | Qurilmoqda | 0 (sayt yo'q) | Yo'q | Halol zavod, 20% gacha arzon, to'liq komplekt, laboratoriya, QR nakladnoy | Tanilmagan, sayt yo'q, sharhlar `[aniqlash kerak]` | — |

## 2. Narx taqqoslash jadvali ("20% gacha arzon" isboti)

Bir xil marka, bir xil shart (zavoddan olib ketish yoki bir xil masofaga yetkazib berish, QQS bilan/QQSsiz) bo'yicha.

| Pozitsiya | INSOF narxi | Raqobatchi 1 | Raqobatchi 2 | Raqobatchi 3 | O'rtacha (yirik zavodlar) | INSOF farqi, % | Narx olingan usul va sana |
|---|---|---|---|---|---|---|---|
| ПК 63-12-8 (dona) | `[aniqlash kerak]` | | | | | | |
| ПК 60-12-8 (dona) | `[aniqlash kerak]` | | | | | | |
| ПК 90-12-8 (dona) | `[aniqlash kerak]` | | | | | | |
| ФБС 24-4-6 (dona) | `[aniqlash kerak]` | | | | | | |
| ФБС 12-4-6 (dona) | `[aniqlash kerak]` | | | | | | |
| Beton M300 (m³, zavoddan) | `[aniqlash kerak]` | | | | | | |
| Beton M300 (m³, Toshkent ichida yetkazib berish bilan) | `[aniqlash kerak]` | | | | | | |
| Bordyur (dona) | `[aniqlash kerak]` | | | | | | |
| КС halqa (dona) | `[aniqlash kerak]` | | | | | | |

Formula: `Farq % = (O'rtacha raqobatchi narxi − INSOF narxi) / O'rtacha raqobatchi narxi × 100`.
Reklamada "до 20%" faqat jadvaldagi eng katta farq ≥ 20% bo'lsa ishlatiladi; aks holda haqiqiy raqam ishlatiladi.
Pozitsiyalar ro'yxati INSOF assortimentiga qarab o'zgartiriladi (markalar `[aniqlash kerak]`).

## 3. Ma'lumot yig'ish tartibi (checklist)

### Narxlar
- [ ] Har raqobatchiga "sirli xaridor" qo'ng'irog'i: bir xil ssenariy ("uy 10×12, 2 qavat, poydevor FBS, plita ПК 63-12-8, Yangiyo'l/Chilonzorga yetkazib berish") — narx, muddat, to'lov sharti, minimal buyurtma yozib olinadi.
- [ ] Sayt va Instagram'dagi narxlar skrinshot bilan.
- [ ] OLX.uz va Telegram e'lonlaridagi narxlar (diler va zavod ajratilsin).

### Qidiruv talabi va SEO
- [ ] **Yandex Wordstat** (wordstat.yandex.ru): mintaqa "Toshkent" va "O'zbekiston", asosiy so'rovlar chastotasi (`04-seo-semantik-yadro.md` klasterlari bo'yicha), mavsumiylik ("История запросов").
- [ ] **Google Ads Keyword Planner**: joylashuv O'zbekiston, tillar rus + o'zbek; o'rtacha oylik qidiruv va taklif qilinadigan CPC oralig'i.
- [ ] Har asosiy so'rov bo'yicha Yandex va Google'da qo'lda tekshiruv (inkognito, Toshkent geo): TOP-10 da kimlar, reklama bloklarida kimlar — sana bilan skrinshot.
- [ ] Raqobatchi saytlari: sahifalar soni (`site:domen` so'rovi), narx bormi, kalkulyator, maqolalar, tillar (RU/UZ), mobil tezlik (PageSpeed Insights).

### Reklama
- [ ] **Meta Ad Library** (facebook.com/ads/library): mamlakat O'zbekiston, raqobatchi nomi yoki sahifasi bo'yicha — faol e'lonlar, kreativ turi, boshlangan sana.
- [ ] Yandex qidiruvda reklama bloklari: kim, qanday sarlavha, qanday taklif (5 ta asosiy so'rov × 2 vaqt: ish kunida va dam olish kunida).
- [ ] Google Ads Transparency Center (adstransparency.google.com): raqobatchi domeni bo'yicha e'lonlar.

### Instagram
- [ ] Obunachilar, oxirgi 30 kunda post/Reels soni, eng ko'p ko'rilgan 3 ta Reels mavzusi, izohlardagi savollar va shikoyatlar.
- [ ] Bio, highlights, havola (sayt/Telegram), javob tezligi (Direct'ga savol yozib sinash).

### Xaritalar va sharhlar
- [ ] **2GIS**: kartochka bormi, kategoriya, rasm, ish vaqti, reyting va sharhlar soni.
- [ ] **Yandex Xaritalar** va **Google Maps**: reyting, sharhlar soni, oxirgi 10 ta sharhdagi asosiy mavzular (kechikish, sifat, narx, xizmat).
- [ ] Salbiy sharhlardagi takrorlanuvchi og'riqlar → INSOF kontentida javob (masalan, "marka yozilganidan past chiqdi" → laboratoriya va QR Reels).

## 4. Xulosa shabloni (har raqobatchi uchun 3 qator)

```
[nomi]
Kuchli: ...
Kuchsiz (INSOF qayerda yutadi): ...
Bizning harakat: (so'rov / kreativ / kontent mavzusi)
```

## 5. Yangilash davriyligi

- Narx jadvali: oyiga 1 marta (hisobot oldidan).
- Reklama va SEO ko'rinishi: oyiga 1 marta, bir xil so'rovlar ro'yxati bilan.
- To'liq qayta tahlil: har chorakda.
