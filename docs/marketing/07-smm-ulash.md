# SMM: tarmoqlarni ulash (Instagram, Facebook, Telegram, Target)

ERP'da: **Sotuv → Marketing → Kontent reja / Media kutubxona / Target**.
Kalitlar bo'lmaguncha hamma narsa **sinov rejimida** ishlaydi: post «Sinov (yuborilmadi)», reklama «Sinov (pul sarflanmadi)».
Kalitlar korxona muhit faylida (`tenants/<slug>.env`) turadi — bazaga va gitga yozilmaydi. Qo'shgandan keyin xizmatni qayta ishga tushiring.

## Ish tartibi

1. Sotuv (yoki agentlik) post tayyorlaydi: media, tarmoqlar, vaqt, izoh RU/UZ (AI yordamchi yozib beradi) → **Tasdiqlashga yuborish**.
2. Direktor **Tasdiqlash** (yoki sabab bilan **Rad etish**) — tasdiqlangan post belgilangan vaqtda o'zi chiqadi (har daqiqada tekshiriladi).
   Tasdiqlangan post o'zgartirilsa, qayta qoralamaga qaytadi.
3. Instagram'da chiqqan postga **Target qilish** so'rovi → direktor Target sahifasida tasdiqlaydi → Meta'da ishga tushadi.
   Kunlik va oylik limitdan oshib bo'lmaydi (Target → Oylik limit).
4. Statistika (ko'rish, layk, qamrov, sarf) har 30 daqiqada tarmoqlardan tortiladi.

AI agent post yozadi, oylik reja tuzadi, target **taklif qiladi** — lekin hech qachon tasdiqlamaydi, chiqarmaydi va pul sarflamaydi.

## Telegram kanal

1. Kanalga ERP botini (yoki alohida botni) **administrator** qilib qo'shing (xabar yuborish huquqi bilan).
2. Muhit fayliga:
   - `SMM_TELEGRAM_CHAT_ID=@kanal_nomi` (yopiq kanal bo'lsa `-100…` raqami)
   - alohida bot bo'lsa `SMM_TELEGRAM_BOT_TOKEN=…` (bo'lmasa mavjud `TELEGRAM_BOT_TOKEN` ishlatiladi)

Video 50 MB dan katta bo'lsa Telegram bot uni qabul qilmaydi — Reels'ni siqib yuklang.

## Instagram va Facebook (Meta)

Talab: Instagram **Business** hisobi Facebook sahifaga bog'langan, ikkalasi Meta Business Suite'da.

1. business.facebook.com → Sozlamalar → **Tizim foydalanuvchilari** → yangi (Admin) → sahifa, Instagram hisobi va reklama kabinetini unga biriktiring.
2. developers.facebook.com da ilova (Business turi) yarating, tizim foydalanuvchisiga **muddatsiz token** oling. Ruxsatlar:
   `instagram_basic, instagram_content_publish, instagram_manage_insights, pages_show_list, pages_read_engagement,
   pages_manage_posts, read_insights, ads_management, ads_read, business_management`.
3. Muhit fayliga:
   - `META_ACCESS_TOKEN=…`
   - `META_IG_USER_ID=…` (Instagram Business hisob id)
   - `META_PAGE_ID=…` (Facebook sahifa id)
   - `META_AD_ACCOUNT_ID=act_…` (target uchun reklama kabineti)
   - ixtiyoriy: `META_PAGE_ACCESS_TOKEN=…` (sahifaga alohida token), `META_LEAD_FORM_ID=…` («Ariza» maqsadi uchun Lead Ads formasi)
4. Reklama kabinetida to'lov usuli ulangan bo'lishi shart (pul Meta orqali yechiladi, ERP faqat limitni nazorat qiladi).

Instagram videoni ERP serveridan o'zi yuklab oladi (muddatli imzolangan havola) — sayt domeni internetdan ochiq bo'lishi kerak.

## Tekshirish

- Target sahifasidagi **Ulanishlar** bloki qaysi kalit yetishmayotganini ko'rsatadi (qiymatlarni emas).
- Birinchi haqiqiy postni kam muhim kontent bilan sinang; xato bo'lsa post sahifasida sababi va **Qayta yuborish** tugmasi chiqadi.
- Hammasini vaqtincha to'xtatish: `SMM_DRY_RUN=1` (sinov rejimi) yoki `SMM_WATCH=off` (avtomatik chiqarish o'chadi).
