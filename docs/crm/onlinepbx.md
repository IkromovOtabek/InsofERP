# onlinePBX → Sotuv CRM

Mushtariy, Asadbek va boshqa operatorlar CRM'dan (kompyuter yoki telefon) **«Qo'ng'iroq»** bosadi:
onlinePBX avval xodimning ichki raqamini (softfon / onlinePBX ilovasi) chaqiradi, ko'targach mijozga ulaydi — mijoz
kompaniya raqamini (78 555 57 55) ko'radi. amoCRM'dagi onlinePBX integratsiyasi ham ishlayveradi.

## Ulash

1. onlinePBX kabineti → API: **API kaliti**; ruxsat etilgan IP ro'yxati bo'lsa — server IP'si (189.74.98.242).
2. Serverda `tenants/insof.env` ga:
   ```
   ONLINEPBX_DOMAIN=<domen>.onpbx.ru
   ONLINEPBX_API_KEY=<kalit>
   ```
   va `sudo systemctl restart insof-erp@insof`.
3. ERP → Sotuv CRM → Sozlamalar → **Telefoniya**: «Ulangan» chiqadi, onlinePBX ichki raqamlari ro'yxati ko'rinadi;
   har xodimga ichki raqamini yozing (Mushtariy, Asadbek…). Xodim CRM ruxsatiga ega bo'lsin (Sotuv roli yoki `crm` moduli).
4. «Qo'ng'iroqlarni hozir olish (7 kun)» — eski tarix faqat mavjud mijozlarga bog'lanadi (yangi lid ochilmaydi).

## Nima bo'ladi

- Tarix har daqiqada olinadi (`CrmCall`): mijozga telefon, xodimga ichki raqam bo'yicha bog'lanadi.
- O'tkazib yuborilgan kiruvchi qo'ng'iroq → aloqa, keyingi aloqa bugun («Bugun» ekranida); noma'lum raqam → yangi lid
  «Kiruvchi +998…», manba «O'zi murojaat qildi».
- Chiquvchi qo'ng'iroqdan keyin aloqa formasida: javob bo'lmagan bo'lsa «Telefon ko'tarmadi» o'zi tanlangan; yozilgan
  aloqa oxirgi qo'ng'iroqqa bog'lanadi.
- Kartochkada «Qo'ng'iroqlar»: yo'nalish, vaqt, davomiylik, yozuvni tinglash (`/api/pbx/record/<uuid>`, faqat CRM huquqi bilan).
- Voronka → Xodimlar: qo'ng'iroqlar soni va gaplashilgan vaqt.
- `ONLINEPBX_WATCH=off` — sinxronni o'chirish.

## Call-markaz (`/crm/callcenter`)

- **Navbat** — javob berilmagan kiruvchi qo'ng'iroqlar (oxirgi 7 kun), raqam bo'yicha jamlangan, eng uzoq kutgani tepada.
  «Men olaman» — operatorga biriktiradi (boshqa operator ola olmaydi), «Hal qilindi» — qo'lda yopish. Shu raqam bilan
  keyin gaplashilsa (chiquvchi qo'ng'iroq javob olsa yoki mijoz o'zi qayta qo'ng'iroq qilsa) navbatdan o'zi chiqadi.
- **Terish paneli** — istalgan raqam: bazada bo'lsa mijoz ko'rsatiladi, yo'q bo'lsa «mijoz yaratish».
- **Jurnal** — barcha qo'ng'iroqlar (davr, yo'nalish, operator, qidiruv), yozuvni tinglash, «Aloqa yozish».
- **Statistika** (menejer) — javob foizi, o'tkazib yuborilganlar, qayta qo'ng'iroq tezligi, operatorlar, soatlar bo'yicha yuklama.
- Rol **«Call-markaz operatori»** (`CALL_CENTER`): vebda faqat Sotuv CRM, kirgach Call-markaz ochiladi; mijoz va aloqa yozadi.
  Ruxsat `crm.calls` (Sotuv, Ish boshqaruvchi, Call-markaz).

## Webhook (jonli qo'ng'iroq oynasi)

1. CRM → Sozlamalar → Telefoniya → «Webhook manzilini yaratish» → manzilni nusxalang (`/api/crm/pbx?k=<kalit>`).
2. onlinePBX kabineti → Сервисы → Webhooks → «Добавить», manzilni qo'ying; hodisalar: начался звонок, дозвон до пользователя,
   ответили на звонок, пропущенный звонок, звонок завершился.
3. Qo'ng'iroq kelishi bilan CRM sahifalarida oyna chiqadi (kim, oxirgi aloqa, karta / mijoz yaratish), jurnal soniyalar
   ichida yangilanadi. Webhook bo'lmasa ham tarix har daqiqada olinadi (faqat oyna chiqmaydi). Kalit yangilansa eski manzil
   ishlamay qoladi.
