# SMM: profillarni ulash, AI studiya va statistika

ERP'da: **Marketing → Statistika / Kontent reja / AI studiya / Media kutubxona / Target / Sozlamalar**.
Profil ulanmaguncha postlar tarmoqqa chiqmaydi: «Hozir chiqarish» xato beradi va «Sozlamalar'da profilni ulang» deydi.
Test rejimida (`INSOF_ENV=test`) yoki `SMM_DRY_RUN=1` bo'lsa hech narsa yuborilmaydi: post «Sinov (yuborilmadi)», reklama «Sinov (pul sarflanmadi)».

## Ish tartibi

1. **AI studiya**: g'oyani oddiy so'z bilan yozasiz, masalan «yangi FBS liniyamizni ko'rsatadigan Reels». AI quyidagilarni tayyorlaydi:
   ssenariy (sahnalar), ekrandagi matn, ovoz matni, izoh RU/UZ, heshteglar, joylashuv, eng yaxshi chiqish vaqti va suratga olish bo'yicha maslahatlar.
   Har sahnaga media kutubxonadan mos kadr o'zi tanlanadi, yetmaganini AI video yaratadi.
   «Saqlash va video yaratish» — Reels serverda montaj qilinadi (9:16) va postga biriktiriladi.
2. Post qoralama bo'lib **Kontent reja**ga tushadi → tekshirasiz → **Tasdiqlashga yuborish**.
3. Direktor **Tasdiqlash** (yoki sabab bilan **Rad etish**) bosadi. Tasdiqlangan post belgilangan vaqtda o'zi chiqadi.
   Tasdiqdan keyin matn, tarmoq, media yoki joylashuv o'zgarsa, post qayta qoralamaga qaytadi (chiqib bo'lgan post ham).
4. **Statistika**: ko'rishlar, qamrov, obunachilar, format bo'yicha natija, eng yaxshi kun va soat, raqobatchilar.
   Ma'lumot har 6 soatda o'zi yig'iladi. «AI tahlil va g'oyalar» tugmasi nima ishlaganini, nima ishlamaganini va 6–8 ta g'oyani beradi;
   har g'oyani bir bosishda studiyaga yuborish mumkin.
5. **Target**: Instagram'da chiqqan postga so'rov yuboriladi → direktor tasdiqlaydi → Meta'da ishga tushadi. Kunlik va oylik limitdan oshib bo'lmaydi.

AI hech qachon o'zi tasdiqlamaydi, chiqarmaydi va pul sarflamaydi.

## Profillarni ulash (Marketing → Sozlamalar)

Talab: Instagram **Business** (yoki Creator) hisobi Facebook sahifaga bog'langan bo'lishi kerak.

### A. «Meta orqali ulash» tugmasi (tavsiya)

Bir martalik sozlash (dasturchi yoki administrator qiladi):

1. developers.facebook.com → **Create App** → turi **Business**.
2. **Facebook Login for Business** mahsulotini qo'shing. *Valid OAuth Redirect URIs* ro'yxatiga har korxona uchun yozing:
   `https://<korxona-domeni>/api/marketing/oauth/meta`
3. App Review'ga ruxsatlarni yuboring (Meta 1–2 hafta tekshiradi):
   `instagram_basic, instagram_content_publish, instagram_manage_insights, instagram_manage_comments, pages_show_list,
   pages_read_engagement, pages_manage_posts, pages_read_user_content, business_management, ads_management, ads_read, leads_retrieval`.
   Tekshiruv tugaguncha tugma faqat ilovada rol berilgan (admin/tester) hisoblar uchun ishlaydi.
4. Korxona muhit fayliga (`tenants/<slug>.env`) qo'shing va xizmatni qayta ishga tushiring:
   - `META_APP_ID=…`
   - `META_APP_SECRET=…`

Shundan keyin direktor Sozlamalar'da tugmani bosadi, Meta oynasida sahifa va Instagram profilini tanlaydi. Profillar o'zi qo'shiladi.
Sahifa tokeni muddatsiz. Foydalanuvchi tokeni (reklama uchun) taxminan 60 kun amal qiladi va muddati tugashidan 10 kun oldin o'zi yangilanadi.

### B. Tokenni qo'lda kiritish (App Review kutilayotganda)

business.facebook.com → Sozlamalar → **Tizim foydalanuvchilari** → token yarating (yuqoridagi ruxsatlar bilan) →
Sozlamalar → «Instagram / Facebook tokenini qo'lda kiritish». Token tekshiriladi va bog'langan sahifa hamda Instagram profili saqlanadi.

### Telegram kanal

Botni kanalga **administrator** qilib qo'shing va «Xabar joylash» huquqini bering → Sozlamalar → «Telegram kanalni ulash»
(`@kanal_nomi` yoki `-100…`). Bot tokeni bo'sh qoldirilsa, korxonaning asosiy boti ishlatiladi.
Telegram bot 50 MB dan katta videoni qabul qilmaydi.

Tokenlar bazada shifrlangan holda saqlanadi (AES-256-GCM, kalit `AUTH_SECRET` dan olinadi).
`AUTH_SECRET` almashtirilsa, profillarni qayta ulash kerak bo'ladi. Eski usul (`META_*` va `SMM_TELEGRAM_*` muhit o'zgaruvchilari) ham ishlaydi,
lekin Sozlamalar'da ulangan profil undan ustun turadi.

### Reklama kabineti

Sozlamalar → «Reklama kabineti va limitlar»: `act_…` id, Lead forma id, valyuta, kunlik va oylik limit.
Valyuta Meta kabineti valyutasi bilan bir xil bo'lishi shart: farq qilsa, reklama ishga tushmaydi.
Kabinetda to'lov usuli ulangan bo'lishi kerak.

## AI studiya uchun server sozlamalari

| Nima | Kalit / dastur | Bo'lmasa |
|---|---|---|
| Matn, ssenariy, tahlil | `ANTHROPIC_API_KEY` (bor) | AI tugmalari o'chadi |
| Video montaj | serverda `ffmpeg` (`sudo apt install ffmpeg`), ixtiyoriy `SMM_FFMPEG` | faqat ssenariy va matn saqlanadi |
| AI kadr (kutubxonada mos video bo'lmasa) | `GEMINI_API_KEY`, ixtiyoriy `SMM_VIDEO_MODEL` (standart `veo-3.0-fast-generate-001`) | sahnaga o'z kadringizni tanlaysiz |
| AI ovoz (diktor) | `ELEVENLABS_API_KEY`, ixtiyoriy `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | video ovozsiz, ekrandagi matn bilan |

Ekrandagi matn sharp orqali chiziladi. Serverda lotin va kirill harflari uchun shrift bo'lishi kerak (`fonts-dejavu-core`, Ubuntu'da odatda bor).
Montaj navbat bilan bitta-bitta bajariladi (2 ta oqim). 30 soniyali Reels taxminan 1–2 daqiqada tayyor bo'ladi.

Instagram videoni ERP serveridan o'zi yuklab oladi (muddatli imzolangan havola), shuning uchun sayt domeni internetdan ochiq bo'lishi kerak.

## Tekshirish

- Sozlamalar'da har profil yonida **Tekshirish** tugmasi bor: token ishlayaptimi, obunachilar soni nechta.
- Birinchi haqiqiy postni kam muhim kontent bilan sinang. Xato bo'lsa, post sahifasida sababi va **Qayta yuborish** tugmasi chiqadi.
- Hammasini vaqtincha to'xtatish: `SMM_DRY_RUN=1` (sinov rejimi) yoki `SMM_WATCH=off` (avtomatik chiqarish, statistika va montaj o'chadi).
- Regressiya testi: `ENV_FILE=.env.test.example DATABASE_URL=<insof_test…> npx tsx scripts/qa/c-smm.ts`.
