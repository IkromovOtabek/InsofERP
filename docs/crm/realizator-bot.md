# Realizator boti → Sotuv CRM

Bot: `github.com/sarvarmirzakarimoff-max/INSOF-realizator-bot`, serverda `/var/www/realizator-bot` (systemd `realizator-bot`).

| Botda | CRM'da |
|---|---|
| 🏗 Yangi obyekt | Mijoz (telefon bo'yicha topiladi yoki ochiladi), manba «Realizator (ko'chada)», aloqa: izohda ehtiyojlar, prorab, xarita havolasi; **keyingi aloqa — bugun** (operator «Bugun» ekranida ko'radi) |
| 💼 Tijorat taklifi | Aloqa «Taklif yuborildi», taklif narxi, mahsulot (beton/plita), keyingi aloqa +2 kun |

To'lov va qarzdorlar botda qoladi (ERP kassasiga yozilmaydi).

## Ulash

ERP (`tenants/<slug>.env`):
```
CRM_BOT_TOKEN=<uzun tasodifiy satr>
CRM_REALIZATOR_OWNER=<operator logini>   # ixtiyoriy: yangi obyektlar kimga biriktirilsin
```

Bot: `realizator-bot.patch` ni qo'llash (`git apply`), `.env` ga:
```
ERP_URL=https://insof-erp.uz
ERP_TOKEN=<CRM_BOT_TOKEN bilan bir xil>
```
va `sudo systemctl restart realizator-bot`. ERP_URL/ERP_TOKEN bo'lmasa bot avvalgidek ishlaydi.

Endpoint: `POST /api/crm/realizator` (`Authorization: Bearer`), takror voqea (`ref`) ikkinchi aloqa ochmaydi.
Realizatorning Telegram'i ERP hisobiga ulangan bo'lsa — aloqa uning nomidan, aks holda «Realizator boti» tizim foydalanuvchisidan.
