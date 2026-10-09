/**
 * IT panel yordam matnlari — bitta lug'at. «?» tugmalari (HelpButton), hodisa tafsiloti va /superadmin/yordam
 * sahifasi shu yerdan o'qiydi. Sof modul (Prisma/Node yo'q) — brauzer ham import qiladi.
 *
 * Yozish qoidasi: oddiy o'zbek tili (lotin), qisqa, aniq. Har atama (CPU, SSL, nginx…) birinchi uchraganda
 * bir gap bilan tushuntiriladi. Buyruq va fayl nomlari `teskari tirnoq` ichida — ular kodday ko'rsatiladi va
 * kirill yozuviga o'girilmaydi. Chegaralar va buyruqlar PLATFORMA.md («Monitoring agenti») va agent kodidan olingan.
 */
import { ACTION_TYPES, type ActionType } from "./monitor/contract";

export type HelpGroup =
  | "umumiy" | "korxona" | "server" | "xizmat" | "hodisa" | "amal" | "xavfsizlik"
  | "baza" | "zaxira" | "reliz" | "jamoa" | "atama" | "tekshiruv";

export const HELP_GROUPS: Record<HelpGroup, string> = {
  umumiy: "Umumiy holat va sahifalar",
  korxona: "Korxonalar",
  server: "Server ko'rsatkichlari",
  xizmat: "Xizmatlar",
  hodisa: "Hodisalar",
  amal: "Tugmalar (serverdagi amallar)",
  xavfsizlik: "Kiberxavfsizlik",
  baza: "Baza va trafik",
  zaxira: "Zaxira va server tizimi",
  reliz: "Relizlar va loglar",
  jamoa: "IT jamoasi va jurnal",
  tekshiruv: "Tekshiruvlar va topilmalar",
  atama: "Atamalar lug'ati",
};

/** Xavf darajasi — popoverda rangli belgi. */
export type HelpRisk = "safe" | "low" | "medium" | "high";
export const RISK_LABEL: Record<HelpRisk, string> = { safe: "Xavfsiz", low: "Kam xavf", medium: "O'rtacha xavf", high: "Yuqori xavf" };

export type HelpAction = {
  /** Bu tugma nima qiladi (serverda aynan nima bajariladi) */
  does: string;
  /** Xavfi — oddiy tilda oqibati */
  risk: string;
  level: HelpRisk;
  /** Qancha vaqt oladi */
  duration: string;
  /** Qachon ishlatish kerak */
  use: string;
  /** Qachon ishlatmaslik kerak */
  avoid?: string;
};

export type HelpTopic = {
  title: string;
  group: HelpGroup;
  /** «Bu nima?» (tekshiruvda — «Nima bo'ldi?») */
  what: string;
  /** «Nega muhim?» — asosan tekshiruv/hodisa uchun */
  why?: string;
  /** «Normal holat» */
  normal?: string;
  /** «Muammo bo'lsa nima qilish kerak?» (tekshiruvda — «Qanday tuzatiladi?») — tartibli qadamlar */
  steps?: string[];
  /** Tugmalar uchun */
  action?: HelpAction;
  /** Tekshiruv/hodisa yordami (sarlavhalar boshqacha) */
  check?: boolean;
  /** Qidiruv uchun qo'shimcha so'zlar */
  keywords?: string;
};

/* ═════════════════════════ Tugmalar (ACTION_TYPES) ═════════════════════════ */

const ACTION_HELP: Record<ActionType, Omit<HelpTopic, "group">> = {
  RESTART_UNIT: {
    title: "Xizmatni qayta ishga tushirish",
    what: "Tanlangan dasturni (korxona sayti `insof-erp@<slug>`, IT panel `insof-control` yoki ECO API `insof-eco`) o'chirib-yoqadi — xuddi telefonni qayta yoqish kabi.",
    action: {
      does: "Agent serverda `sudo -n /usr/local/sbin/insof-restart <xizmat>` ni chaqiradi (ichida `systemctl restart`), keyin 60 soniyagacha xizmat va uning `/api/health` manzili javob berayotganini tekshiradi.",
      risk: "Shu xizmat 5–30 soniya ishlamaydi: ochiq sahifalar qayta yuklanadi, saqlanmagan forma yo'qolishi mumkin. Boshqa korxonalarga ta'sir qilmaydi.",
      level: "medium",
      duration: "30–60 soniya (natija «Amallar» sahifasida)",
      use: "Xizmat «Nosoz» (qizil) holatda, sayt ochilmayapti yoki «versiya eski» ko'rinsa.",
      avoid: "Ish vaqtida (09:00–18:00) xizmat normal ishlab turgan bo'lsa bosmang. Bir marta sekinlashgani uchun ham qayta yoqish shart emas.",
    },
    steps: ["Avval «Hozir tekshirish» bilan holatni yangilang.", "Hali ham qizil bo'lsa — shu tugmani bosing, korxona qisqa nomini yozib tasdiqlang.", "1 daqiqadan keyin «Amallar» sahifasida natija «Bajarildi» ekanini ko'ring.", "Yana ishlamasa — «Loglar» sahifasida shu xizmat logini o'qing yoki dasturchiga yuboring."],
    keywords: "restart qayta yoqish systemctl",
  },
  RELOAD_NGINX: {
    title: "Nginx reload",
    what: "nginx — internetdan kelgan so'rovlarni kerakli korxona saytiga yo'naltiruvchi «eshik qorovuli». Reload uning sozlamasini qayta o'qitadi.",
    action: {
      does: "Avval `sudo -n nginx -t` bilan sozlama to'g'riligi tekshiriladi. Faqat xato bo'lmasa `systemctl reload nginx` bajariladi.",
      risk: "Xavfsiz: saytlar uzilmaydi. Sozlamada xato bo'lsa reload qilinmaydi — eski sozlama ishlayveradi.",
      level: "low",
      duration: "2–5 soniya",
      use: "nginx sozlamasi o'zgartirilgandan keyin yoki AI/hodisa shuni tavsiya qilsa.",
      avoid: "Korxona sayti o'zi ishlamayotgan bo'lsa (502 xatosi) bu yordam bermaydi — o'sha xizmatni qayta ishga tushiring.",
    },
    keywords: "nginx reload sozlama",
  },
  RUN_BACKUP: {
    title: "Zaxira olish",
    what: "Barcha bazalarning (korxonalar va panel) nusxasini hozir oladi. Odatda har kecha avtomatik olinadi.",
    action: {
      does: "Agent `bash scripts/server-backup.sh` ni ishga tushiradi: har baza `/var/backups/insof/<sana>` papkasiga yoziladi, `SHA256SUMS` (nazorat yig'indisi) tuziladi va sozlangan bo'lsa server tashqarisiga (rclone) yuboriladi.",
      risk: "Xavfsiz, hech narsani o'chirmaydi. Faqat bir necha daqiqa server va disk yuklamasi oshadi, diskda joy egallaydi.",
      level: "low",
      duration: "Odatda 1–10 daqiqa (eng ko'pi 3 soat cheklov)",
      use: "Katta o'zgarishdan (deploy, migratsiya, server qayta yuklash) oldin yoki tungi zaxira xato bergan bo'lsa.",
      avoid: "Ketma-ket ko'p marta bosmang — har biri diskda yangi nusxa yaratadi. Disk 90% dan to'la bo'lsa avval joy bo'shating.",
    },
    keywords: "backup zaxira nusxa",
  },
  RENEW_CERT: {
    title: "SSL yangilash",
    what: "SSL sertifikat — saytning «pasporti»: brauzerda qulf belgisi va https shu tufayli. Let's Encrypt sertifikati 90 kun amal qiladi.",
    action: {
      does: "`sudo -n certbot renew --quiet` → `nginx -t` → nginx reload. certbot faqat muddati 30 kundan kam qolgan sertifikatlarni yangilaydi.",
      risk: "Kam xavf: yangilash muvaffaqiyatsiz bo'lsa eski sertifikat muddati tugaguncha ishlayveradi. Tasdiqlash uchun «SSL» deb yoziladi.",
      level: "low",
      duration: "10–60 soniya",
      use: "SSL kartasida 7 kundan kam qolgan bo'lsa va avtomatik yangilanmagan bo'lsa.",
      avoid: "Odatda kerak emas — certbot o'zi yangilaydi. Qayta-qayta bosmang: Let's Encrypt soatiga 5 tagacha xatoli urinishga ruxsat beradi.",
    },
    steps: ["Xato bersa — domen DNS'i shu serverga yo'naltirilganini tekshiring (`nslookup <domen>`).", "80 va 443 portlari ochiq bo'lishi kerak (`sudo ufw status`).", "Natija matnini «Amallar» sahifasida o'qing."],
    keywords: "ssl https sertifikat certbot letsencrypt",
  },
  FIX_SECRET_PERMS: {
    title: "Maxfiy fayllar huquqini tuzatish (600)",
    what: "Parol va kalitlar saqlanadigan fayllar (`control.env`, `build.env`, `tenants/*.env`) faqat egasi o'qiy oladigan bo'lishi kerak. «600» — Linux'da «faqat egasi o'qiydi va yozadi» degani.",
    action: {
      does: "`control.env`, `build.env`, `tenants/*.env` → 600, `tenants/` papkasi → 700. sudo kerak emas; nima o'zgargani natijada yoziladi.",
      risk: "Xavfsiz — fayl ichi o'zgarmaydi, xizmatlar to'xtamaydi.",
      level: "safe",
      duration: "1–2 soniya",
      use: "Xavfsizlik skaneri «Sir fayllari ochiq» (secret-perms) desa.",
    },
    keywords: "chmod 600 huquq env",
  },
  BLOCK_IP: {
    title: "IP bloklash",
    what: "IP manzil — internetdagi kompyuterning «uy raqami». Bloklangan manzildan serverga hech qanday ulanish (sayt, SSH) o'tmaydi.",
    action: {
      does: "`sudo -n /usr/local/sbin/insof-ufw deny <ip>` → firewall'ga (ufw) eng birinchi qoida sifatida `deny from <ip>` qo'shiladi. Faqat IPv4. Serverning o'z IP'lari, 127.x, 0.x va `/etc/insof/ufw-allow` ro'yxati bloklanmaydi.",
      risk: "O'z yoki ofis IP'ingizni bloklasangiz serverga o'zingiz kira olmaysiz (SSH ham). Mobil operator IP'ini bloklash ko'p mijozni uzib qo'yishi mumkin. Tasdiqlash uchun IP qayta yoziladi.",
      level: "high",
      duration: "1–3 soniya",
      use: "Bitta IP parol taxmin qilayotgan (SSH yoki login) yoki saytni skaner qilayotgan bo'lsa.",
      avoid: "IP o'zingizniki, ofisniki yoki mijozniki emasligini tekshirmasdan bosmang («mening IP manzilim» deb qidirib bilasiz).",
    },
    steps: ["Hodisa tafsilotida shu IP necha marta urinib ko'rganini ko'ring.", "O'zingizning IP'ingiz bilan solishtiring.", "Bloklang; xato bo'lsa — «Bloklangan IP'lar» ro'yxatidan «Blokdan chiqarish»."],
    keywords: "ufw firewall ban deny ip",
  },
  UNBLOCK_IP: {
    title: "IP blokdan chiqarish",
    what: "Avval bloklangan manzilga serverga ulanishga yana ruxsat beradi.",
    action: {
      does: "`sudo -n /usr/local/sbin/insof-ufw undeny <ip>` → `ufw delete deny from <ip>`.",
      risk: "Xavfsiz. Faqat o'sha manzil yana urinish qilishi mumkin bo'ladi.",
      level: "safe",
      duration: "1–3 soniya",
      use: "Xato bloklangan (o'zingiz, mijoz) manzilni qaytarish uchun.",
    },
    keywords: "ufw unblock",
  },
  RUN_HEALTH_CHECK: {
    title: "Hozir tekshirish",
    what: "Agent odatda har 15 soniyada tekshiradi. Bu tugma navbatni kutmasdan barcha tekshiruvlarni darhol bajartiradi.",
    action: {
      does: "Agentning tekshiruv sikli (CPU, xotira, disk, xizmatlar, saytlar, baza, SSL, zaxira) shu zahoti ishga tushadi.",
      risk: "Xavfsiz, hech narsani o'zgartirmaydi.",
      level: "safe",
      duration: "2–10 soniya",
      use: "Muammoni tuzatgandan keyin holat yashilga o'tganini tez ko'rish uchun.",
    },
    keywords: "tekshirish health yangilash",
  },
  RUN_SECURITY_SCAN: {
    title: "Xavfsizlik skaneri",
    what: "Serverni xavfsizlik bo'yicha tekshiradi: SSH urinishlari, firewall, ochiq portlar, fayl huquqlari, yangilanishlar, nginx loglari, korxonalardagi yangi huquqlar.",
    action: {
      does: "Agent xavfsizlik modulini (`runSecurityChecks`) darhol ishga tushiradi. Faqat o'qiydi — hech narsani o'zgartirmaydi.",
      risk: "Xavfsiz.",
      level: "safe",
      duration: "30 soniya – 3 daqiqa",
      use: "Biror narsani tuzatgandan keyin topilma yo'qolganini tekshirish uchun (odatda har 5 daqiqada o'zi ishlaydi).",
    },
    keywords: "scan skaner",
  },
  RUN_AI_ANALYSIS: {
    title: "AI xavfsizlik tahlili",
    what: "Topilmalar va ko'rsatkichlar qisqa xulosa qilib sun'iy intellektga (Claude) yuboriladi; u A–F baho va «nima qilish kerak» ro'yxatini qaytaradi.",
    action: {
      does: "Agent ochiq hodisalar, so'nggi tekshiruv natijalari va server foizlarini (CPU, xotira, disk) yig'adi, parol, token, kalit, telefon va e-pochtalarni yashiradi (IP'lar qoladi) va Claude API'ga yuboradi. Natija «Hisobotlar tarixi» ga yoziladi.",
      risk: "Server uchun xavfsiz. Har tahlil API hisobidan kichik pul yechadi (bir necha sent). `ANTHROPIC_API_KEY` sozlanmagan bo'lsa tahlil o'tkazilmaydi.",
      level: "safe",
      duration: "20–90 soniya",
      use: "Katta o'zgarishdan keyin yoki ko'p topilma chiqqanda umumiy baho olish uchun (odatda har 6 soatda o'zi ishlaydi).",
      avoid: "Ketma-ket ko'p bosmang — natija deyarli bir xil chiqadi, pul esa sarflanadi.",
    },
    keywords: "ai claude tahlil baho",
  },
  DEPLOY: {
    title: "Deploy (yangi reliz)",
    what: "Deploy — dasturning yangi versiyasini serverga o'rnatish. GitHub'dagi yangi kod olinadi, yig'iladi (build) va barcha xizmatlar yangi versiyaga o'tadi.",
    action: {
      does: "Agent `scripts/deploy.sh` ni alohida jarayonda ishga tushiradi: kodni oladi, `npm ci` va `next build`, baza migratsiyalari, `current` havolasini yangi relizga o'tkazadi va xizmatlarni qayta ishga tushiradi. Log `/var/log/insof-deploy.log` ga yoziladi.",
      risk: "Har xizmat qayta ishga tushganda bir necha soniya uzilish bo'ladi. Baza migratsiyalari orqaga qaytmaydi. «TASDIQLAYMAN» va parolingiz so'raladi.",
      level: "high",
      duration: "5–15 daqiqa",
      use: "Commitlar ro'yxatini ko'rib, ish vaqtidan tashqarida (kechqurun) yangi versiya o'rnatish uchun.",
      avoid: "Ish vaqtida, zaxira olinayotganda yoki serverda boshqa muammo (disk to'la, xotira yetmayapti) bo'lsa.",
    },
    steps: ["Avval «Zaxira olish».", "Deploy'ni bosing, natijani shu sahifada kuzating.", "Xato bo'lsa — eski xizmatlar ishlayveradi; kerak bo'lsa «Oldingi relizga qaytarish»."],
    keywords: "deploy reliz yangilash versiya",
  },
  ROLLBACK: {
    title: "Oldingi relizga qaytarish",
    what: "Yangi versiyada muammo chiqsa, serverdagi oldingi versiyaga tez qaytish.",
    action: {
      does: "`ROLLBACK=1 scripts/deploy.sh` — oldingi reliz papkasiga o'tadi (qayta build qilinmaydi) va xizmatlarni qayta ishga tushiradi.",
      risk: "Xizmatlar bir necha soniya uziladi. Baza migratsiyalari qaytmaydi — yangi versiya bazani o'zgartirgan bo'lsa eski kod bilan xato chiqishi mumkin. «TASDIQLAYMAN» va parol so'raladi.",
      level: "high",
      duration: "1–3 daqiqa",
      use: "Deploy'dan keyin saytlar ishlamay qolsa yoki jiddiy xato chiqsa.",
      avoid: "Muammo kodda emas (disk, xotira, baza) bo'lsa — qaytarish yordam bermaydi.",
    },
    keywords: "rollback qaytarish",
  },
  LOG_TAIL: {
    title: "Log o'qish",
    what: "Log — dastur o'z ishini va xatolarini yozib boradigan kundalik. Bu amal tanlangan logning oxirgi qatorlarini olib keladi.",
    action: {
      does: "Agent faqat ruxsat etilgan manbani o'qiydi: `journalctl -u <xizmat>` yoki nginx/zaxira/deploy log fayllari. ≤ 500 qator, ≤ 64 KB; parol va tokenlar yashiriladi. Natija matni 24 soatdan keyin o'chiriladi.",
      risk: "Xavfsiz, faqat o'qiydi.",
      level: "safe",
      duration: "1–5 soniya",
      use: "Xizmat nima uchun ishlamayotganini bilish yoki dasturchiga xato matnini yuborish uchun.",
    },
    keywords: "log journalctl",
  },
  PG_CANCEL: {
    title: "So'rovni bekor qilish",
    what: "Bazada juda uzoq ishlayotgan bitta so'rovni (masalan, osilib qolgan hisobot) to'xtatadi.",
    action: {
      does: "`pg_cancel_backend(<pid>)` — faqat `insof` foydalanuvchisining faol so'rovi. Ulanish qoladi, so'rov xato bilan tugaydi.",
      risk: "Kam xavf: shu so'rovni yuborgan foydalanuvchi ekranida xato chiqadi, u amalni qayta qiladi. Tasdiqlash uchun pid yoziladi.",
      level: "low",
      duration: "1 soniya",
      use: "So'rov 5 daqiqadan ko'p ishlayotgan va boshqalarni sekinlashtirayotgan bo'lsa.",
      avoid: "Zaxira yoki migratsiya so'rovlarini to'xtatmang.",
    },
    keywords: "postgres cancel query",
  },
  PG_TERMINATE: {
    title: "Ulanishni uzish",
    what: "Bazaga ulanib, tranzaksiyani ochiq qoldirib «uxlab qolgan» ulanishni uzadi. Bunday ulanish jadvallarni bloklab, boshqalarni kuttirib qo'yishi mumkin.",
    action: {
      does: "`pg_terminate_backend(<pid>)` — faqat 10 daqiqadan ortiq «idle in transaction» turgan o'z ulanishimizga. Ochiq tranzaksiya bekor qilinadi (ROLLBACK).",
      risk: "O'sha ulanishning saqlanmagan o'zgarishlari bekor bo'ladi. «TASDIQLAYMAN» va parol so'raladi.",
      level: "medium",
      duration: "1 soniya",
      use: "Baza sahifasida «idle in transaction» 10 daqiqadan oshgan va bloklar ko'rinsa.",
      avoid: "Faol ishlayotgan so'rov uchun avval «So'rovni bekor qilish» ni sinang.",
    },
    keywords: "postgres terminate idle",
  },
  VACUUM_ANALYZE: {
    title: "VACUUM ANALYZE",
    what: "Bazada o'chirilgan/o'zgartirilgan qatorlarning «axlati» (o'lik qatorlar) yig'iladi. VACUUM uni tozalaydi, ANALYZE esa baza qidiruv rejasi uchun statistikani yangilaydi.",
    action: {
      does: "`VACUUM (ANALYZE)` butun baza yoki bitta jadval uchun.",
      risk: "Jadval bloklanmaydi, lekin bir necha daqiqa disk va CPU yuklamasi oshadi. Tasdiqlash uchun baza nomi yoziladi.",
      level: "low",
      duration: "Soniyalardan bir necha daqiqagacha (jadval hajmiga qarab)",
      use: "«O'lik qator» ulushi 20% dan oshgan va so'rovlar sekinlashgan bo'lsa.",
      avoid: "Odatda Postgres buni o'zi (autovacuum) qiladi — har kuni qo'lda bosish shart emas. Ish vaqtining eng band soatida katta bazada bosmang.",
    },
    keywords: "vacuum analyze postgres",
  },
  RUN_RESTORE_TEST: {
    title: "Tiklash sinovi",
    what: "Zaxira nusxadan bazani haqiqatan tiklab bo'lishini tekshiradi. Tiklab bo'lmaydigan zaxira — zaxira emas.",
    action: {
      does: "`bash scripts/restore-test.sh`: oxirgi nusxadagi har dump vaqtinchalik bazaga tiklanadi, jadvallar va qatorlar sanaladi, keyin vaqtinchalik baza o'chiriladi. Haqiqiy bazalarga tegilmaydi.",
      risk: "Xavfsiz. Bir necha daqiqa server yuklamasi oshadi.",
      level: "safe",
      duration: "2–20 daqiqa (eng ko'pi 2 soat)",
      use: "Oxirgi sinov 8 kundan eski bo'lsa yoki zaxira tizimi o'zgartirilgandan keyin (odatda har yakshanba o'zi ishlaydi).",
    },
    keywords: "restore tiklash sinov",
  },
  REBOOT: {
    title: "Serverni qayta yuklash",
    what: "Butun serverni (kompyuterni) o'chirib-yoqadi. Yadro (kernel) yangilangandan keyin kerak bo'ladi.",
    action: {
      does: "Avval Telegram'ga xabar ketadi, keyin `sudo -n /usr/sbin/shutdown -r +1` (1 daqiqadan keyin) yoki tanlangan soatda (`-r HH:MM`). Zaxira, tiklash sinovi yoki korxona sozlanayotgan bo'lsa rad etiladi.",
      risk: "BARCHA korxonalar 1–3 daqiqa ishlamaydi. «TASDIQLAYMAN» va parol so'raladi. Bekor qilish mumkin (rejalashtirilgan vaqtgacha).",
      level: "high",
      duration: "1–3 daqiqa uzilish",
      use: "«Qayta yuklash kerak» ko'rsatilganda — kechasi (masalan 03:00) rejalashtirib.",
      avoid: "Ish vaqtida «hozir» tanlamang. Server sekin bo'lsa qayta yuklash yechim emas — avval sababini toping.",
    },
    keywords: "reboot qayta yuklash shutdown",
  },
  REBOOT_CANCEL: {
    title: "Qayta yuklashni bekor qilish",
    what: "Rejalashtirilgan qayta yuklashni bekor qiladi.",
    action: {
      does: "`sudo -n /usr/sbin/shutdown -c` + Telegram'ga xabar.",
      risk: "Xavfsiz.",
      level: "safe",
      duration: "1–2 soniya",
      use: "Qayta yuklash xato vaqtga qo'yilgan bo'lsa.",
    },
    keywords: "reboot cancel",
  },
  CLEAN_RELEASES: {
    title: "Eski relizlarni o'chirish",
    what: "Har deploy serverda yangi papka (reliz) qoldiradi. Bu amal eskilarini o'chirib diskda joy bo'shatadi.",
    action: {
      does: "`releases/` dan eng yangi 3 ta va joriy (`current`) relizdan boshqasi, hamda 2 soatdan eski `*.tmp` papkalar o'chiriladi. Deploy ketayotgan bo'lsa hech narsa o'chirilmaydi.",
      risk: "O'chirilgan relizga orqaga qaytib bo'lmaydi. Ishlayotgan saytlarga ta'sir qilmaydi. «TASDIQLAYMAN» so'raladi.",
      level: "medium",
      duration: "5–30 soniya",
      use: "Disk 80% dan to'lganda va «Disk: eng katta papkalar» da `releases/` katta bo'lsa.",
    },
    keywords: "releases disk tozalash",
  },
  JOURNAL_VACUUM: {
    title: "Jurnalni tozalash (14 kun)",
    what: "journald — Linux'ning umumiy log ombori. Vaqt o'tishi bilan gigabaytlab joy egallaydi.",
    action: {
      does: "`sudo -n /usr/bin/journalctl --vacuum-time=14d` — 14 kundan eski yozuvlar o'chiriladi (oldin/keyin hajmi natijada).",
      risk: "14 kundan eski loglar yo'qoladi (eski xatoni tekshirib bo'lmaydi). Xizmatlarga ta'sir qilmaydi. «TASDIQLAYMAN» so'raladi.",
      level: "low",
      duration: "5–60 soniya",
      use: "Disk to'lib borayotganda va jurnal hajmi katta bo'lsa.",
    },
    keywords: "journalctl vacuum log tozalash",
  },
  TENANT_UP: {
    title: "Korxonani serverda ishga tushirish",
    what: "Yangi yaratilgan korxonani haqiqatan ishlaydigan saytga aylantiradi: dastur, nginx manzili va SSL sozlanadi.",
    action: {
      does: "`sudo -n /usr/local/sbin/insof-tenant-up <slug> [domen]`: `insof-erp@<slug>` systemd xizmati yoqiladi, `/api/health` tekshiriladi, nginx sayti va certbot SSL sozlanadi. Javob 200 bo'lsa holat «Faol» bo'ladi.",
      risk: "Boshqa korxonalarga ta'sir qilmaydi; qayta bajarilsa zarari yo'q. Korxona qisqa nomi va parolingiz so'raladi.",
      level: "low",
      duration: "1–15 daqiqa",
      use: "Korxona yaratilgandan keyin (holat «Ishga tushirilmagan») yoki domen o'zgargandan keyin «qayta sozlash».",
      avoid: "Domen DNS'i shu serverga yo'naltirilmagan bo'lsa SSL olinmaydi — avval DNS'ni sozlang.",
    },
    keywords: "tenant-up ishga tushirish provisioning",
  },
};

/* ═════════════════════════ Asosiy mavzular ═════════════════════════ */

const BASE = {
  /* ── Sahifalar («Bu sahifa haqida») ── */
  "page:home": {
    title: "Bu sahifa haqida: Platforma holati", group: "umumiy",
    what: "Barcha korxonalar bitta ro'yxatda: har biri ishlayaptimi, nechta xodim, zayavka va aylanma. Tepada — server va hodisalarning qisqa holati.",
    normal: "Holat qatori yashil («Hammasi joyida»), har korxonada ERP va Baza yashil, ochiq kritik hodisa 0.",
    steps: ["Qizil yoki sariq narsa bo'lsa — yonidagi «?» ni bosing.", "Holat qatorini bosib «Server va xizmatlar» sahifasiga o'ting.", "Muayyan korxona bilan muammo bo'lsa — uning nomini bosing."],
    keywords: "bosh sahifa umumiy",
  },
  "page:monitoring": {
    title: "Bu sahifa haqida: Server va xizmatlar", group: "umumiy",
    what: "Server «salomatligi»: protsessor, xotira, disk, tarmoq, har dastur (xizmat) holati, SSL va zaxira. Ma'lumotni serverdagi `insof-agent` dasturi har 15 soniyada yig'adi, sahifa o'zi yangilanadi.",
    normal: "Barcha kartalar oq/yashil, «Agent ishlayapti», ochiq hodisa yo'q.",
    steps: ["Qizil karta yonidagi «?» ni bosing — nima qilish kerakligi yozilgan.", "Tuzatgandan keyin «Hozir tekshirish».", "Natijani «Amallar» sahifasida ko'ring."],
  },
  "page:hodisalar": {
    title: "Bu sahifa haqida: Hodisalar", group: "umumiy",
    what: "Hodisa — tizim topgan muammo (sayt javob bermayapti, disk to'lyapti, kimdir parol taxmin qilyapti…). Bir xil muammo takrorlansa yangi qator ochilmaydi — hisoblagich oshadi.",
    normal: "«Ochiq va ko'rilgan» filtrida ro'yxat bo'sh.",
    steps: ["Eng yuqoridagi (eng og'ir) hodisani bosing.", "Tafsilotdagi «Oddiy tilda» blokini o'qing.", "«Tuzatish» tugmasi bo'lsa — ishlating; aks holda ko'rsatmaga amal qiling.", "Ko'rganingizni «Ko'rdim» bilan belgilang; muammo ketgach hodisa o'zi yopiladi."],
  },
  "page:xavfsizlik": {
    title: "Bu sahifa haqida: Kiberxavfsizlik", group: "umumiy",
    what: "Serverni buzib kirishdan himoya holati: avtomatik skaner topilmalari, AI bahosi (A–F) va bloklangan IP manzillar.",
    normal: "Baho A yoki B, ochiq xavfsizlik hodisasi yo'q.",
    steps: ["Baho C–F bo'lsa — tavsiyalarni yuqoridan pastga bajaring.", "«Tuzatish» tugmasi xavfsiz amallarni agentga beradi.", "Tugma bo'lmasa — ko'rsatmadagi buyruqni SSH orqali (yoki dasturchi bilan) bajaring."],
  },
  "page:amallar": {
    title: "Bu sahifa haqida: Amallar", group: "umumiy",
    what: "Paneldan serverga yuborilgan har buyruq (qayta yoqish, zaxira, bloklash…) tarixi: kim so'radi, qachon, qancha vaqt ketdi va natija.",
    normal: "Ko'pchilik amal «Bajarildi» (yashil).",
    steps: ["«Xato» yoki «Rad etildi» amalni oching — «Natija» qismida sabab yozilgan.", "Tushunarsiz bo'lsa natija matnini nusxalab dasturchiga yuboring."],
  },
  "page:adminlar": {
    title: "Bu sahifa haqida: IT jamoasi", group: "umumiy",
    what: "IT panelga kira oladigan odamlar (superadminlar). Ular barcha korxonalarni ko'radi, yaratadi, direktorga login beradi va korxonaga IT sifatida kiradi.",
    normal: "Faqat ishonchli odamlar «Faol». Ketgan xodim — «Bloklangan».",
    steps: ["Yangi odam — «Yangi superadmin» formasi.", "Ishdan ketgan — «Bloklash».", "Parolni unutgan bo'lsa — serverda `npm run control:admin` (pastdagi «?»)."],
  },
  "page:jurnal": {
    title: "Bu sahifa haqida: Jurnal", group: "umumiy",
    what: "IT jamoasining har harakati yoziladi: kim, qachon, qaysi korxonada nima qildi va qaysi IP'dan. Parollar yozilmaydi.",
    normal: "Faqat siz va jamoangiz qilgan, tanish amallar.",
    steps: ["Notanish kirish yoki amal ko'rsangiz — o'sha superadminni bloklang va parollarni almashtiring."],
  },
  "page:korxona": {
    title: "Bu sahifa haqida: Korxona", group: "umumiy",
    what: "Bitta korxonaning to'liq holati: ishlayaptimi, statistika, direktor logini, sozlamalar, to'xtatish va texnik ma'lumot.",
    normal: "Holat «Faol», ERP va Baza yashil.",
    steps: ["Holat noto'g'ri ko'rinsa — «Tekshirish».", "Direktor parolni unutgan bo'lsa — «Direktor login/paroli».", "To'lov qilinmagan bo'lsa — «To'xtatish»."],
  },
  "page:yangi": {
    title: "Bu sahifa haqida: Yangi korxona", group: "umumiy",
    what: "Yangi mijoz korxonasini ochish. Har korxonaga alohida baza, alohida dastur jarayoni va alohida manzil (domen) beriladi.",
    normal: "Yaratilgach korxona sahifasi ochiladi va «Serverda ishga tushirish» taklif qilinadi.",
    steps: ["Formani to'ldiring (har maydon yonida «?»).", "Domen uchun DNS A-yozuvini sozlang.", "«Korxonani yaratish» → keyin korxona sahifasida «Serverda ishga tushirish».", "Direktorga manzil, login va parolni bering."],
  },
  "page:baza": {
    title: "Bu sahifa haqida: Baza", group: "umumiy",
    what: "PostgreSQL (barcha ma'lumot saqlanadigan baza dasturi) holati: bazalar hajmi, ulanishlar, uzoq so'rovlar, eng katta jadvallar. Agent har 5 daqiqada yig'adi.",
    normal: "Uzoq so'rov va bloklar yo'q, cache hit 99% ga yaqin.",
    steps: ["Uzoq so'rov ko'rinsa — «Bekor qilish».", "O'lik qator ko'p bo'lsa — «VACUUM».", "Har tugma yonidagi «?» xavfini aytadi."],
  },
  "page:trafik": {
    title: "Bu sahifa haqida: Trafik", group: "umumiy",
    what: "Saytlarga kelayotgan so'rovlar (nginx logidan): daqiqasiga nechta, nechtasi xato bilan tugadi, eng faol IP'lar va eng sekin sahifalar.",
    normal: "5xx (server xatosi) ulushi 1% dan kam, upstream xatolari yo'q.",
    steps: ["5xx ko'paysa — «Server va xizmatlar» da qaysi xizmat qizil ekanini ko'ring.", "Bitta IP juda ko'p so'rov yuborsa — tekshirib, kerak bo'lsa bloklang."],
  },
  "page:zaxira": {
    title: "Bu sahifa haqida: Zaxira nusxa", group: "umumiy",
    what: "Bazalarning nusxalari: har kecha avtomatik olinadi, server tashqarisiga (bulut) yuboriladi, har hafta tiklash sinovi o'tkaziladi.",
    normal: "Oxirgi nusxa 24 soatdan yangi, masofada bor, SHA256SUMS bor, tiklash sinovi «OK».",
    steps: ["Nusxa eski bo'lsa — «Hozir zaxira olish».", "Masofa xato bersa — rclone sozlamasini tekshirish kerak (dasturchi).", "Disk prognozi 14 kundan kam bo'lsa — joy bo'shating."],
  },
  "page:server": {
    title: "Bu sahifa haqida: Server tizimi", group: "umumiy",
    what: "Operatsion tizim (Ubuntu), yadro, kutilayotgan yangilanishlar, avtomatik xavfsizlik yangilanishlari va diskdagi eng katta papkalar.",
    normal: "Qayta yuklash kerak emas, avtomatik yangilanishlar yoqilgan, disk 80% dan kam.",
    steps: ["«Qayta yuklash kerak» bo'lsa — kechasiga rejalashtiring.", "Disk to'lsa — eski relizlar va jurnalni tozalang."],
  },
  "page:relizlar": {
    title: "Bu sahifa haqida: Relizlar", group: "umumiy",
    what: "Reliz — dasturning serverga o'rnatilgan bitta versiyasi. Bu yerda joriy versiya, GitHub'dagi yangi o'zgarishlar va deploy/qaytarish tugmalari.",
    normal: "Barcha xizmatlar joriy relizda, «yangi commit» yo'q yoki rejali.",
    steps: ["Yangi versiya o'rnatish — ish vaqtidan tashqarida «Deploy».", "Muammo chiqsa — «Oldingi relizga qaytarish»."],
  },
  "page:loglar": {
    title: "Bu sahifa haqida: Loglar", group: "umumiy",
    what: "Dasturlar yozgan kundalik (log) qatorlarini serverga SSH'siz o'qish. Har so'rov «Amallar» jurnaliga yoziladi.",
    normal: "Xatolar (err) filtrida kam qator.",
    steps: ["Manbani (xizmatni) tanlang, «Xatolar» darajasini tanlang, «Yangilash».", "Xato matnini nusxalab dasturchiga yuboring."],
  },

  "page:sozlamalar": {
    title: "Bu sahifa haqida: Sozlamalar", group: "umumiy",
    what: "Panelning sizga qanday ko'rinishini tanlash: telefondagi ko'rinish (Vidjetlar yoki Zich Pro) va rang rejimi (tizim, yorug', qorong'i). Faqat sizning hisobingiz uchun; tanlov bazaga saqlanadi va barcha qurilmalaringizda amal qiladi.",
    normal: "Kompyuterdagi «Status Board» ko'rinishi o'zgarmaydi — faqat telefon (ekran 760px gacha) va ranglar.",
    steps: ["Variantni bosing — darhol qo'llanadi.", "Boshqa adminlarga ta'sir qilmaydi."],
  },

  /* ── Bosh sahifa ── */
  "home:health": {
    title: "Ogohlantirish banneri", group: "umumiy",
    what: "Bosh sahifa tepasidagi rangli yo'lak: eng muhim muammo shu yerda yoziladi. Barcha tekshiruvlar, hodisalar va korxonalar holatidan yig'iladi. Hammasi joyida bo'lsa banner umuman ko'rinmaydi.",
    normal: "Banner yo'q. Sariq «E'tibor talab qiladi» — ochiq hodisa yoki ogohlantirish bor. Qizil «Muammo bor» — nimadir ishlamayapti yoki agent jim. Kulrang «Monitoring ma'lumoti yo'q» — agent hali o'rnatilmagan.",
    steps: ["Banner ichidagi «Hodisani ochish» ni bosing.", "Yonidagi «?» shu muammo uchun aniq ko'rsatma beradi."],
    keywords: "banner holat qatori",
  },
  "board:tiles": {
    title: "Svetofor plitkalari", group: "umumiy",
    what: "Bosh sahifadagi 6 ta katta plitka: Korxonalar, Xizmatlar, CPU, RAM, Disk, Zaxira. Har biri rang va so'z bilan holatni aytadi; bosilsa batafsil sahifa ochiladi.",
    normal: "Yashil «Me'yorda» / «Ishlayapti». Sariq «Yuqori» / «Ogohlantirish» — kuzating. Qizil «Haddan oshgan» / «Nosoz» — tez chora ko'ring. Kulrang «Ma'lumot yo'q» — agent hali ma'lumot bermagan.",
    steps: ["Qizil plitkani bosing — tegishli sahifa ochiladi.", "Plitkalar ostidagi «?» lar har birini tushuntiradi."],
    keywords: "plitka tile svetofor status board",
  },
  "board:tenants": {
    title: "Korxonalar plitkasi", group: "umumiy",
    what: "Nechta faol korxona ishlayapti (masalan «3 / 3»). Sayt yoki bazasi javob bermagan korxona nomi ostida yoziladi.",
    normal: "Barcha faol korxonalar ishlayapti.",
    steps: ["Nosoz bo'lsa — «Korxonalar» bo'limida qizil ramkali kartani toping.", "«Server va xizmatlar» da o'sha korxona xizmatini qayta ishga tushiring."],
  },
  "board:services": {
    title: "Xizmatlar plitkasi", group: "umumiy",
    what: "Serverdagi dasturlardan (korxonalar, IT panel, ECO, nginx, PostgreSQL) nechtasi ishlayapti. Eng yomon holatdagisi ostida yoziladi.",
    normal: "Hammasi javob beryapti.",
    steps: ["Plitkani bosing — «Server va xizmatlar» sahifasida qizil kartaning «?» sini o'qing."],
  },
  "board:backup": {
    title: "Zaxira plitkasi", group: "umumiy",
    what: "Oxirgi zaxira nusxa necha soat (yoki kun) oldin olingani va hajmi.",
    normal: "24 soatdan kam — «Bajarildi».",
    steps: ["«Eskirgan» bo'lsa — «Zaxira» sahifasida «Hozir zaxira olish»."],
  },
  "board:chart": {
    title: "CPU va RAM grafigi", group: "server",
    what: "So'nggi soatdagi protsessor va xotira bandligi (foizda). Ostida — server xotirasi, disk, ishlash vaqti, Node va reliz versiyasi.",
    normal: "Silliq chiziq, keskin uzoq cho'qqilar yo'q. Kechasi zaxira paytida qisqa ko'tarilish — normal.",
  },
  "mobile:widgets": {
    title: "Telefon: Vidjetlar ko'rinishi", group: "umumiy",
    what: "Telefondagi bosh sahifa: turli o'lchamdagi kartalar (vidjetlar), chapga-o'ngga suriladigan 3 sahifa va pastda asosiy bo'limlar paneli. 1-sahifa — eng muhim hodisa, server, korxona, zaxira; 2-sahifa — CPU grafigi va xizmatlar; 3-sahifa — boshqa hodisalar, xavfsizlik, amallar.",
    normal: "Hodisa vidjeti yashil «ochiq hodisa yo'q».",
    steps: ["Hodisa vidjetini bosing — pastdan varaq chiqadi: amal tanlab, shu yerning o'zida bajarish mumkin.", "Barcha bo'limlar — pastdagi «Ko'proq».", "Ko'rinishni almashtirish — Sozlamalar → Mavzu."],
    keywords: "vidjet telefon mobil m4",
  },
  "mobile:pro": {
    title: "Telefon: Zich Pro ko'rinishi", group: "umumiy",
    what: "Tezkor tashxis uchun zich ko'rinish: tepada CPU, RAM, DSK (disk), LOAD kichik grafiklar bilan; ostida xizmatlar jadvali (holat, javob vaqti, 24 soatlik ishlash ulushi) va ochiq hodisalar. Qator oxiridagi «⋯» — shu xizmat amallari (qayta ishga tushirish, log).",
    normal: "Barcha qatorlar yashil nuqtali, «CRIT» ogohlantirishi yo'q.",
    steps: ["Qizil qator «⋯» → «Qayta ishga tushirish» (yonidagi «?» xavfini aytadi).", "Tepadagi «LIVE 3s» — ma'lumot jonli kelyapti; «OFF» — aloqa yo'q."],
    keywords: "zich pro telefon mobil m5",
  },
  "settings:mobile": {
    title: "Telefon ko'rinishi", group: "umumiy",
    what: "Telefonda (ekran 760px gacha) bosh sahifa qanday ko'rinishi: «Vidjetlar» — katta kartalar, bir qarashda holat; «Zich Pro» — zich jadval va raqamlar, tez tashxis uchun.",
    normal: "Faqat sizga ta'sir qiladi, kompyuter ko'rinishi o'zgarmaydi.",
  },
  "settings:color": {
    title: "Rang rejimi", group: "umumiy",
    what: "«Tizim» — telefon/kompyuter sozlamasiga qarab (kechasi qorong'i). «Yorug'» — doim oq fon. «Qorong'i» — doim qora fon, tunda ko'zni charchatmaydi.",
    normal: "Yon menyudagi oy/quyosh tugmasi ham shuni almashtiradi.",
  },
  "home:hot": {
    title: "Ochiq kritik/yuqori hodisalar soni", group: "umumiy",
    what: "Hozir hal qilinmagan eng muhim (Kritik va Yuqori darajali) muammolar soni. Qavs ichida — barcha ochiq hodisalar.",
    normal: "0.",
    steps: ["«Hodisalar» sahifasini oching (menyuda qizil raqam bilan).", "Kritiklarni birinchi hal qiling."],
  },
  "agent:status": {
    title: "Agent holati", group: "server",
    what: "`insof-agent` — serverda doim ishlab turadigan yordamchi dastur. U ko'rsatkichlarni yig'adi va paneldagi tugmalar buyruqlarini bajaradi. Panelning o'zi serverga tegmaydi.",
    normal: "Yashil «Agent ishlayapti · v…». Har 15 soniyada signal beradi.",
    steps: ["Qizil «Agent javob bermayapti» bo'lsa — ko'rsatkichlar eskirgan va tugmalar bajarilmaydi.", "SSH orqali serverga kiring va tekshiring: `sudo systemctl status insof-agent`", "Oxirgi xatolar: `journalctl -u insof-agent -n 50`", "Qayta yoqish: `sudo systemctl restart insof-agent`", "Kulrang «o'rnatilmagan» — PLATFORMA.md → «Monitoring agenti» bo'yicha o'rnatish kerak."],
    keywords: "agent heartbeat signal",
  },
  "home:stats": {
    title: "Umumiy raqamlar", group: "umumiy",
    what: "Barcha korxonalar bo'yicha yig'indi: korxonalar soni, faol foydalanuvchilar, oylik zayavka va aylanma, mobil qurilmalar, AI so'rovlari va bazalar hajmi.",
    normal: "Kundan-kunga silliq o'zgaradi. Keskin tushish — biror korxona ishlamayotganini bildirishi mumkin.",
  },
  "home:server": {
    title: "Server (qisqa)", group: "server",
    what: "Host — server nomi. Ishlash — oxirgi qayta yuklashdan beri soat. Yuklama — 1/5/15 daqiqalik load (pastdagi «Load» ga qarang). Xotira va Disk — bo'sh / jami. Node — dastur ishlaydigan muhit versiyasi.",
    normal: "Xotira va diskda kamida 20% bo'sh joy; yuklama CPU sonidan kichik.",
    steps: ["Batafsil grafiklar — «Server» (monitoring) sahifasida."],
  },
  "home:hint": {
    title: "Yordam tugmalari", group: "umumiy",
    what: "Har bo'lim, ustun va tugma yonidagi «?» belgisini bossangiz — oddiy tilda tushuntirish chiqadi: bu nima, normal holat qanday va muammo bo'lsa nima qilish kerak.",
    normal: "Esc yoki tashqariga bosish oynani yopadi. Barcha tushuntirishlar — «Yordam» sahifasida.",
  },

  /* ── Korxonalar ── */
  "tenant:status": {
    title: "Korxona holati", group: "korxona",
    what: "«Ishga tushirilmagan» (PROVISIONING) — baza tayyor, lekin serverda dastur hali yoqilmagan. «Faol» (ACTIVE) — ishlayapti. «To'xtatilgan» (SUSPENDED) — xodimlar kira olmaydi, ma'lumot saqlangan. «Arxiv» (ARCHIVED) — yopilgan korxona, IT kirishi ham o'chiq.",
    normal: "Pul to'layotgan mijozlar «Faol».",
    steps: ["«Ishga tushirilmagan» — korxona sahifasida «Serverda ishga tushirish».", "«To'xtatilgan» — to'lov qilinsa «Qayta yoqish»."],
    keywords: "PROVISIONING ACTIVE SUSPENDED ARCHIVED",
  },
  "tenant:check": {
    title: "Tekshiruv ustuni (ERP / Baza / ECO)", group: "korxona",
    what: "Sahifa ochilganda har korxona jonli tekshiriladi. ERP — sayt javob berdimi va necha millisekundda (ms; 1000 ms = 1 soniya). Baza — ma'lumotlar bazasiga ulanish bo'ldimi. ECO — mobil ilova serveri (sozlangan bo'lsa).",
    normal: "Uchchalasi yashil, ERP 1000 ms dan kam.",
    steps: ["ERP qizil — «Server va xizmatlar» da `insof-erp@<slug>` xizmatini qayta ishga tushiring.", "Baza qizil — PostgreSQL ishlayaptimi tekshiring (monitoring sahifasi).", "Kulrang «—» — tekshirilmagan yoki sozlanmagan."],
    keywords: "ms latency",
  },
  "tenant:columns": {
    title: "Korxonalar jadvali ustunlari", group: "korxona",
    what: "Xodim — faol foydalanuvchilar (qavsda 24 soatda kirganlar). Zayavka — bugun / shu oy. Aylanma — shu oydagi buyurtmalar summasi. Baza — korxona bazasi hajmi. Oxirgi faollik — korxonada kimdir oxirgi marta biror amal qilgan vaqt. «:3101» — korxona dasturining ichki porti.",
    normal: "Faol korxonada oxirgi faollik ish kunida bir necha soatdan eski emas.",
    steps: ["Faollik bir necha kundan beri yo'q — mijoz bilan bog'laning yoki sayt ishlayotganini tekshiring."],
  },
  "tenant:port": {
    title: "Port", group: "korxona",
    what: "Port — server ichidagi «eshik raqami». Har korxona dasturi o'z portida (3101, 3102…) faqat ichkaridan tinglaydi; internetdan kelgan so'rovni nginx domen bo'yicha shu portga yo'naltiradi.",
    normal: "Port yangi korxonaga avtomatik beriladi, o'zgartirish shart emas.",
  },
  "tenant:db": {
    title: "Baza nomi", group: "korxona",
    what: "Har korxonaning alohida PostgreSQL bazasi bor (`insof_t_<slug>`). Bir korxona ma'lumoti boshqasiga aralashmaydi.",
    normal: "Hajmi asta o'sadi; keskin o'sish — katta import yoki xato.",
  },
  "tenant:version": {
    title: "Versiya", group: "korxona",
    what: "Korxona dasturi hozir qaysi kod versiyasida (reliz commit'i) ishlayapti — `/api/health` javobidan.",
    normal: "Barcha korxonalarda bir xil, joriy reliz bilan teng.",
    steps: ["Boshqalardan farq qilsa («versiya eski») — deploy'dan keyin shu xizmat qayta ishga tushmagan. Uni «Qayta ishga tushirish» bilan yangilang."],
  },
  "tenant:lasterr": {
    title: "Oxirgi xato", group: "korxona",
    what: "Shu korxona tekshiruvlaridan (veb, baza, xizmat) oxirgi xato matni.",
    normal: "Bo'sh «—».",
    steps: ["Matnni o'qing; tushunarsiz bo'lsa — «Loglar» da `insof-erp@<slug>` ni oching."],
  },
  "tenant:refresh": {
    title: "Yangilash / Tekshirish", group: "korxona",
    action: {
      does: "Korxona(lar)ning sayti, bazasi va ECO'si hozir qayta so'raladi va statistika yangilanadi. Serverda hech narsa o'zgarmaydi.",
      risk: "Xavfsiz, hech narsani o'zgartirmaydi.",
      level: "safe",
      duration: "1–5 soniya (ko'p korxona bo'lsa ko'proq)",
      use: "Biror narsani tuzatgandan keyin yoki ma'lumot eskirgan tuyulsa.",
    },
    what: "Jonli tekshiruvni qayta bajaradi.",
  },
  "tenant:sso": {
    title: "Kirish (IT)", group: "korxona",
    what: "Korxona ERP'siga parolsiz, IT xodimi sifatida kirish (SSO — bir marta kirish). Muammoni joyida ko'rish yoki direktorga yordam berish uchun.",
    action: {
      does: "Panel 60 soniyalik, bir martalik imzolangan chipta yaratadi va yangi oynada korxona saytiga yuboradi. Korxonada `it.<loginingiz>` hisobi ochiladi (direktor huquqi bilan, o'z paroli yo'q).",
      risk: "Ichkarida direktor huquqi bor — o'chirish, tahrirlash amallarida ehtiyot bo'ling. Kirish IT jurnaliga va korxonaning audit jurnaliga yoziladi: IT hisobi xodimlar ro'yxatida ko'rinmaydi, lekin direktor audit jurnalida kirish yozuvini ko'rishi mumkin.",
      level: "low",
      duration: "2–3 soniya",
      use: "Mijoz muammosini o'z ko'zingiz bilan ko'rish yoki sozlashda yordam berish.",
      avoid: "Sababsiz kirmang. Domen ulanmagan yoki korxona arxivda bo'lsa tugma o'chiq.",
    },
    keywords: "sso kirish it",
  },
  "tenant:suspend": {
    title: "Korxonani to'xtatish", group: "korxona",
    what: "Masalan, to'lov qilinmaganda korxonaning ishlashini vaqtincha to'xtatish.",
    action: {
      does: "Korxona bazasida «to'xtatilgan» belgisi qo'yiladi: barcha xodimlar veb va mobil ilovadan darhol chiqariladi, qayta kira olmaydi. Sabab jurnalga yoziladi.",
      risk: "Korxona ishi to'xtaydi (zayavka, kassa, haydovchilar). Ma'lumot o'chmaydi. IT kirishi (SSO) ishlayveradi.",
      level: "high",
      duration: "Darhol",
      use: "Shartnoma bo'yicha to'lov muddati o'tganda yoki mijoz so'raganda.",
      avoid: "Mijozni oldindan ogohlantirmasdan, ish kuni o'rtasida.",
    },
    keywords: "suspend to'xtatish",
  },
  "tenant:resume": {
    title: "Qayta yoqish", group: "korxona",
    what: "To'xtatilgan korxonani yana ishlatish.",
    action: {
      does: "«To'xtatilgan» belgisi olib tashlanadi; xodimlar yana login/parol bilan kira oladi.",
      risk: "Xavfsiz.",
      level: "safe",
      duration: "Darhol",
      use: "To'lov qilinganda.",
    },
  },
  "tenant:director": {
    title: "Direktor login/paroli", group: "korxona",
    what: "Korxonaning bosh foydalanuvchisi — direktor. U boshqa xodimlarga o'zi login beradi.",
    action: {
      does: "Shu login bilan direktor bo'lmasa — yangisi ochiladi; bor bo'lsa — paroli almashtiriladi va uning barcha eski sessiyalari (ochiq qurilmalari) tugaydi. Jurnalga yoziladi (parol yozilmaydi).",
      risk: "Direktor barcha qurilmalarda qayta kirishi kerak bo'ladi.",
      level: "low",
      duration: "1–2 soniya",
      use: "Direktor parolni unutganda yoki direktor almashganda.",
    },
    steps: ["Yangi parolni xavfsiz yo'l bilan (shaxsan yoki telefon orqali) bering.", "Direktorga kirgach parolni o'zi almashtirishini ayting."],
    keywords: "parol tiklash direktor",
  },
  "tenant:edit": {
    title: "Korxona ma'lumotlari", group: "korxona",
    what: "Nomi, domeni, tarifi, mas'ul shaxs va ECO manzilini tahrirlash. Qisqa nom (slug) va port o'zgarmaydi.",
    normal: "Domen o'zgarsa — DNS'ni yangi domenga yo'naltiring va «Serverda qayta sozlash» ni bosing.",
  },
  "tenant:tech": {
    title: "Texnik ma'lumot", group: "korxona",
    what: "Ichki manzil — server ichidagi `127.0.0.1:<port>`. `.env` fayl — korxona kalitlari saqlanadigan fayl. systemd — korxona dasturining xizmat nomi (`insof-erp@<slug>`).",
    normal: "Bu ma'lumot serverda qo'lda ishlash uchun kerak.",
  },
  "tenant:journal": {
    title: "Korxona jurnali", group: "korxona",
    what: "Shu korxona bo'yicha IT jamoasi amallari: yaratildi, to'xtatildi, direktor paroli berildi, IT kirdi…",
    normal: "Faqat tanish amallar.",
  },
  "tenant:new-btn": {
    title: "Yangi korxona", group: "korxona",
    what: "Yangi mijoz uchun alohida baza va direktor hisobi bilan korxona ochish formasiga o'tadi.",
  },

  /* ── Yangi korxona formasi ── */
  "form:name": {
    title: "Korxona nomi", group: "korxona",
    what: "Ro'yxatlarda va hujjatlarda ko'rinadigan to'liq nom, masalan «Sharq Beton MChJ». Keyin o'zgartirish mumkin.",
  },
  "form:slug": {
    title: "Qisqa nom (slug)", group: "korxona",
    what: "Korxonaning texnik nomi: bazada (`insof_t_<slug>`), xizmat nomida va odatda subdomenda ishlatiladi.",
    normal: "Faqat lotin kichik harf, raqam va chiziqcha; harf bilan boshlanadi; 2–30 belgi. Masalan: `sharq`, `beton-2`. admin, www, api, app, eco, mail, control, static, test band.",
    steps: ["KEYIN O'ZGARTIRIB BO'LMAYDI — o'ylab tanlang."],
  },
  "form:domain": {
    title: "Domen va DNS", group: "korxona",
    what: "Domen — saytning internetdagi manzili (masalan `sharq.insof-erp.uz`). DNS — domen nomini server IP manziliga bog'lovchi «telefon kitobi».",
    normal: "Domen nomi panel sozlamasidagi ruxsat etilgan ro'yxatda bo'lishi kerak (odatda `*.insof-erp.uz`).",
    steps: ["Domen sotib olingan joyning (DNS provayder) paneliga kiring.", "A-yozuv qo'shing: nom — subdomen (masalan `sharq`), qiymat — server IP manzili.", "5 daqiqadan 1 soatgacha kuting. Tekshirish: `nslookup sharq.insof-erp.uz` server IP'ini qaytarishi kerak.", "Shundan keyin «Serverda ishga tushirish» — SSL ham o'zi olinadi."],
    keywords: "dns a-record a yozuv domen",
  },
  "form:plan": {
    title: "Tarif", group: "korxona",
    what: "Standart, Pro yoki Sinov (trial) — hisob-kitob va hisobot uchun belgi. Hozircha imkoniyatlarni cheklamaydi.",
  },
  "form:eco": {
    title: "ECO API manzili", group: "korxona",
    what: "Insof ECO mobil ilovasi serverining manzili. Kiritilsa, monitoring uning `/v1/health` manzilini tekshirib turadi. Ixtiyoriy.",
  },
  "form:director": {
    title: "Direktor hisobi", group: "korxona",
    what: "Korxonaning birinchi foydalanuvchisi. Direktor kirgach xodimlarga o'zi login/parol beradi (Sozlamalar → Foydalanuvchilar).",
    normal: "Parol kamida talablarga mos (maydon ostida yozilgan).",
  },
  "form:created": {
    title: "Yaratilganda nima bo'ladi", group: "korxona",
    what: "1) panel bazasida korxona yozuvi («Ishga tushirilmagan») va bo'sh port; 2) PostgreSQL'da `insof_t_<slug>` bazasi; 3) bazada barcha jadvallar (migratsiya); 4) direktor hisobi; 5) `tenants/<slug>.env` kalitlar fayli.",
    normal: "~30 soniya davom etadi. Keyin korxona sahifasida «Serverda ishga tushirish» tugmasi chiqadi — u dasturni, nginx'ni va SSL'ni sozlaydi.",
    keywords: "provisioning yaratish port",
  },

  /* ── Monitoring: server ko'rsatkichlari ── */
  "mon:cpu": {
    title: "CPU (protsessor)", group: "server",
    what: "CPU — serverning «miyasi», hisob-kitobni bajaradi. Foiz — u qanchalik band.",
    normal: "Odatda 5–40%. Karta 75% dan sariq, 90% dan qizil bo'ladi. Hodisa CPU 3 marta ketma-ket (45 soniya) 85% dan oshsa ochiladi, 95% — nosoz.",
    steps: ["Qisqa sakrash (zaxira, deploy vaqtida) — normal.", "Uzoq yuqori bo'lsa — «Baza» sahifasida uzoq so'rovlarni, «Trafik» da g'ayrioddiy ko'p so'rovni qidiring.", "Aniq bir korxona sababchi bo'lsa — uning xizmatini qayta ishga tushirish mumkin (ish vaqtidan tashqarida)."],
    keywords: "cpu protsessor",
  },
  "mon:ram": {
    title: "RAM (xotira) va swap", group: "server",
    what: "RAM — ishlayotgan dasturlar uchun tezkor xotira. Swap — RAM yetmaganda diskdan olinadigan sekin «zaxira xotira».",
    normal: "RAM 85% dan kam (karta 80% dan sariq). Swap 0 yoki juda kam.",
    steps: ["85% dan oshsa — qaysi xizmat ko'p xotira olayotganini dasturchi tekshirsin (`ps aux --sort=-rss | head`).", "Swap doim ishlatilsa — server sekinlashadi; RAM'ni oshirish yoki xizmatni qayta ishga tushirish kerak.", "95% — dasturlar to'satdan o'chishi mumkin (OOM)."],
    keywords: "ram xotira memory swap oom",
  },
  "mon:disk": {
    title: "Disk", group: "server",
    what: "Fayllar, bazalar, zaxiralar va loglar saqlanadigan joy.",
    normal: "80% dan kam. 80% — ogohlantirish, 90% — nosoz: disk to'lsa baza yozolmaydi va hamma korxona to'xtaydi.",
    steps: ["«Tizim» sahifasida «Disk: eng katta papkalar» ni ko'ring.", "«Eski relizlarni o'chirish» va «Jurnalni tozalash (14 kun)».", "Zaxiralar ko'p joy olsa — saqlash muddatini (KEEP_DAYS) kamaytirish yoki diskni kattalashtirish."],
    keywords: "disk joy to'la",
  },
  "mon:load": {
    title: "Load (yuklama)", group: "server",
    what: "Load — bir vaqtda ishlayotgan yoki CPU'ni kutayotgan jarayonlar soni (1, 5 va 15 daqiqa o'rtachasi). Uni yadrolar soniga bo'lib qarang: 4 yadroli serverda load 4 — to'liq band, 8 — har yadroga 2 ta navbat.",
    normal: "Load / yadro 1 dan kam. 1.5 dan — ogohlantirish, 3 dan — nosoz (server juda sekin javob beradi).",
    steps: ["CPU ham yuqori bo'lsa — CPU kartasidagi ko'rsatmaga qarang.", "CPU past, load yuqori — disk sekin (zaxira, katta VACUUM). Ular tugashini kuting."],
    keywords: "load average yadro core",
  },
  "mon:net": {
    title: "Tarmoq", group: "server",
    what: "↓ — serverga kelayotgan, ↑ — serverdan ketayotgan ma'lumot tezligi (sekundiga bayt).",
    normal: "Ish vaqtida bir necha yuz KB/s — bir necha MB/s. Kechasi zaxira masofaga ketganda ↑ ko'tariladi.",
    steps: ["Tushunarsiz katta ↓ — kimdir saytga hujum qilayotgan bo'lishi mumkin; «Trafik» sahifasida eng faol IP'larni ko'ring."],
  },
  "mon:uptime": {
    title: "Ishlash vaqti (uptime)", group: "server",
    what: "Server oxirgi qayta yuklangandan beri qancha vaqt uzluksiz ishlayapti. Ostida — agentdan oxirgi signal.",
    normal: "Kunlar yoki haftalar. To'satdan kichik bo'lib qolsa — server kutilmaganda qayta yuklangan (elektr, provayder).",
  },
  "mon:snapshot": {
    title: "Surat vaqti", group: "server",
    what: "Agent server ko'rsatkichlarini oxirgi marta qachon yozgani. Har 15 soniyada yangilanadi.",
    normal: "«hozirgina». 2 daqiqadan eski bo'lsa qizil — agent jim.",
    steps: ["Agent holati «?» sidagi buyruqlar bilan tekshiring."],
  },
  "mon:services": {
    title: "Xizmatlar", group: "xizmat",
    what: "Xizmat (systemd unit) — serverda doim ishlab turadigan dastur: har korxona (`insof-erp@<slug>`), IT panel (`insof-control`), ECO API (`insof-eco`), nginx, PostgreSQL. systemd — ularni yoqib-o'chiradigan va yiqilsa qayta ko'taradigan Linux qismi.",
    normal: "Hammasi yashil «Ishlayapti».",
    steps: ["Har karta yonidagi «?» shu xizmat uchun aniq ko'rsatma beradi."],
  },
  "mon:status": {
    title: "Holat ranglari", group: "xizmat",
    what: "Yashil «Ishlayapti» (OK) — hammasi joyida. Sariq «Ogohlantirish» (WARN) — chegaraga yaqin, kuzating. Qizil «Nosoz» (CRIT) — ishlamayapti yoki chegaradan oshgan, tez tuzating. Kulrang «Noma'lum» (UNKNOWN) — tekshirib bo'lmadi (vosita yo'q yoki huquq yetmadi) — bu xato emas.",
    normal: "Hammasi yashil; bir-ikki kulrang bo'lishi mumkin.",
    keywords: "OK WARN CRIT UNKNOWN rang",
  },
  "mon:latency": {
    title: "Javob vaqti (ms)", group: "xizmat",
    what: "Xizmat tekshiruvga qancha millisekundda javob bergani (1000 ms = 1 soniya).",
    normal: "Odatda 5–300 ms. 2000 ms dan oshsa — «sekin» ogohlantirish.",
    steps: ["Doim sekin bo'lsa — CPU/xotira va «Baza» dagi uzoq so'rovlarni tekshiring."],
  },
  "mon:changed": {
    title: "«holatda» va «tekshirildi»", group: "xizmat",
    what: "«holatda» — xizmat hozirgi rangida qancha vaqtdan beri turibdi. «tekshirildi» — oxirgi tekshiruv vaqti.",
    normal: "«tekshirildi» bir necha soniya oldin.",
  },
  "mon:tenants": {
    title: "Korxonalar (monitoring)", group: "xizmat",
    what: "Har korxona uchun uchta tekshiruv: Veb — sayt `/api/health` ga javob beradimi (ms). Baza — korxona bazasi bormi. Xizmat — `insof-erp@<slug>` dasturi yoqilganmi. Versiya — qaysi reliz ishlayapti.",
    normal: "Uchala ustun yashil, versiya hammasida bir xil.",
    steps: ["Veb qizil, Xizmat yashil — dastur osilib qolgan: qayta ishga tushiring.", "Xizmat qizil — dastur yiqilgan: qayta ishga tushiring, bo'lmasa «Loglar».", "Baza qizil — PostgreSQL yoki baza yo'qolgan: darhol dasturchiga."],
  },
  "mon:ssl": {
    title: "SSL sertifikatlari", group: "xizmat",
    what: "Har domen sertifikati muddati tugashiga necha kun qolgani. Muddat o'tsa brauzer «Xavfli sayt» deydi va mijozlar kira olmaydi.",
    normal: "21 kundan ko'p qolgan. certbot 30 kun qolganda o'zi yangilaydi. 21 kundan kam — sariq, 7 kundan kam — qizil.",
    steps: ["7 kundan kam bo'lsa — «Yangilash» (RENEW_CERT).", "«ulanib bo'lmadi» — domen DNS'i hali ulanmagan yoki 443 port yopiq."],
    keywords: "ssl https sertifikat",
  },
  "mon:backup": {
    title: "Zaxira nusxa (monitoring)", group: "xizmat",
    what: "Oxirgi tungi zaxira qachon olingani. Agent `/var/backups/insof` dagi oxirgi papkani, `SHA256SUMS` faylini (nusxa buzilmaganini tekshirish uchun nazorat yig'indisi) va zaxira logini tekshiradi.",
    normal: "24 soatdan yangi. 26 soatdan eski — nosoz.",
    steps: ["Eski bo'lsa — «Zaxira olish».", "Logda xato bo'lsa — «Zaxira» sahifasida «Oxirgi zaxira jarayoni» ni o'qing."],
    keywords: "backup sha256sums",
  },
  "mon:incidents": {
    title: "Ochiq hodisalar (qisqa)", group: "hodisa",
    what: "Eng muhim 6 ta hal qilinmagan muammo. To'liq ro'yxat — «Hodisalar».",
    normal: "«Ochiq hodisa yo'q».",
  },
  "conn:live": {
    title: "Jonli ulanish belgisi", group: "umumiy",
    what: "Sahifa serverdan yangilanishlarni qanday olayotgani. «Jonli» — darhol keladi. «Har 5 s yangilanadi» — zaxira usul. «Aloqa yo'q» — internet yoki panel bilan aloqa uzilgan. «Sessiya tugadi» — qayta kiring.",
    normal: "Yashil «Jonli».",
  },

  /* ── Hodisalar ── */
  "inc:severity": {
    title: "Hodisa darajasi", group: "hodisa",
    what: "Kritik (CRITICAL) — korxona(lar) ishlamayapti yoki buzib kirish belgisi: darhol, 15 daqiqa ichida. Yuqori (HIGH) — jiddiy xavf: 1 soat ichida. O'rta (MEDIUM) — shu kuni. Past (LOW) — hafta ichida. Ma'lumot (INFO) — shunchaki xabar.",
    normal: "Kritik va Yuqori yo'q.",
    keywords: "CRITICAL HIGH MEDIUM LOW INFO daraja",
  },
  "inc:status": {
    title: "Hodisa holati", group: "hodisa",
    what: "Ochiq (OPEN) — yangi, hech kim ko'rmagan. Ko'rildi (ACKED) — kimdir «Ko'rdim» bosgan, ustida ishlanmoqda. Yopilgan (RESOLVED) — muammo ketgan (o'zi yoki qo'lda yopilgan).",
    normal: "Ochiq hodisa uzoq turmaydi.",
    keywords: "OPEN ACKED RESOLVED",
  },
  "inc:source": {
    title: "Manba", group: "hodisa",
    what: "Hodisani kim topdi: Monitoring (agent tekshiruvlari — sayt, disk, xotira…), Xavfsizlik skaneri (SSH, firewall, portlar…), AI tahlil (Claude tavsiyasi).",
  },
  "inc:category": {
    title: "Toifa", group: "hodisa",
    what: "Ishlash — biror narsa javob bermayapti. Unumdorlik — sekin yoki yuklama yuqori. Xavfsizlik — hujum yoki zaif joy. Zaxira — nusxa muammosi. Sertifikat — SSL. Sozlama — noto'g'ri sozlangan. Yangilanish — dastur/tizim yangilanishi kerak.",
  },
  "inc:count": {
    title: "Takror, birinchi va oxirgi ko'rilgan vaqt", group: "hodisa",
    what: "Bir xil muammo uchun bitta hodisa ochiladi. Agent uni har safar yana ko'rganda «Takror» soni (×N) oshadi va «oxirgi marta ko'rildi» vaqti yangilanadi. «Birinchi marta aniqlandi» — muammo boshlangan vaqt.",
    normal: "Takror katta va oxirgi vaqt yangi — muammo hali davom etyapti.",
  },
  "inc:ack": {
    title: "Ko'rdim", group: "hodisa",
    what: "Hodisani «Ko'rildi» holatiga o'tkazadi — jamoaga «men bilaman, ustida ishlayapman» degani.",
    action: {
      does: "Holat OPEN → ACKED, kim va qachon ko'rgani yoziladi. Serverda hech narsa o'zgarmaydi.",
      risk: "Xavfsiz.",
      level: "safe",
      duration: "Darhol",
      use: "Hodisani o'qib, tuzatishni boshlaganingizda.",
    },
  },
  "inc:resolve": {
    title: "Hodisani qo'lda yopish", group: "hodisa",
    what: "Muammo hal bo'lganini qo'lda belgilash (izoh bilan).",
    action: {
      does: "Holat RESOLVED bo'ladi, izohingiz va ismingiz yoziladi. Serverda hech narsa o'zgarmaydi.",
      risk: "Muammo aslida hal bo'lmagan bo'lsa, agent uni yana ko'rib yangi hodisa ochadi.",
      level: "safe",
      duration: "Darhol",
      use: "Asosan AI va xavfsizlik hodisalari uchun, siz qo'lda tuzatgandan keyin. Monitoring hodisalari 2 ta muvaffaqiyatli tekshiruvdan keyin o'zi yopiladi.",
    },
  },
  "inc:auto": {
    title: "Avtomatik yopilish va Telegram", group: "hodisa",
    what: "Monitoring hodisasi tekshiruv ketma-ket 2 marta yashil chiqsa o'zi yopiladi. «Noma'lum» natija hodisani na ochadi, na yopadi. Xavfsizlik hodisasi 2 skanerdan keyin yopiladi.",
    normal: "Telegram'ga faqat yangi Yuqori/Kritik hodisa (kamida 2 marta ko'rilgan — qayta yoqish paytidagi bir martalik xato emas) va uning yopilishi haqida xabar keladi. Soatiga 30 tadan ko'p emas, bir hodisa uchun bir marta.",
    keywords: "telegram xabar auto resolve",
  },
  "inc:fix": {
    title: "Tuzatish tugmalari", group: "hodisa",
    what: "Tizim shu muammo uchun tavsiya qilgan xavfsiz amallar (masalan IP bloklash, xizmatni qayta yoqish). Bosilganda tasdiq oynasi chiqadi, keyin agent bajaradi.",
    normal: "Har tugma yonidagi «?» uning xavfini aytadi.",
  },
  "inc:timeline": {
    title: "Vaqt chizig'i", group: "hodisa",
    what: "Hodisa tarixi tartib bilan: aniqlandi, Telegram yuborildi, kim ko'rdi, qaysi amal so'raldi va natijasi, yopildi.",
  },
  "inc:detail": {
    title: "Tafsilot", group: "hodisa",
    what: "Agent yozgan texnik ma'lumot (JSON): raqamlar, IP'lar, xato matni. Sirlar yozilmaydi.",
    normal: "Dasturchiga muammoni tushuntirishda shu matnni yuboring.",
  },
  "inc:filters": {
    title: "Filtrlar", group: "hodisa",
    what: "Holat, daraja, toifa, manba va korxona bo'yicha saralash. Tanlov manzil satrida saqlanadi — havolani jamoaga yuborsangiz ular ham aynan shu ro'yxatni ko'radi.",
  },

  /* ── Amallar jurnali ── */
  "act:status": {
    title: "Amal holati", group: "amal",
    what: "Navbatda (PENDING) — agent hali olmagan (odatda 3 soniya ichida oladi). Bajarilmoqda (RUNNING) — ishlayapti. Bajarildi (DONE) — muvaffaqiyatli. Xato (FAILED) — bajarildi, lekin xato bilan tugadi. Rad etildi (REJECTED) — agent bajarmadi: amal yoki parametr ruxsat etilmagan yoki xavfli amal navbatda 10 daqiqadan ko'p turib muddati o'tgan. Bekor qilindi (CANCELLED) — superadmin uni navbatdan olgan.",
    normal: "Ko'pchilik «Bajarildi».",
    steps: ["«Navbatda» uzoq tursa — agent jim (agent holatini tekshiring); keraksiz bo'lsa «Navbatdan olish».", "«Xato» — «Natija» ni o'qing.", "«Rad etildi» — sabab natijada: noto'g'ri IP/xizmat nomi, oq ro'yxatda yo'q amal, test rejimi yoki «muddati o'tdi» (qayta so'rang)."],
    keywords: "PENDING RUNNING DONE FAILED REJECTED CANCELLED muddati o'tdi",
  },
  "act:cancel": {
    title: "Navbatdan olish", group: "amal",
    what: "Hali agent olmagan (Navbatda) amalni bekor qiladi — u bajarilmaydi, holati «Bekor qilindi» bo'ladi, jurnalga kim olgani yoziladi. Bajarilayotgan amalni to'xtatib bo'lmaydi.",
    normal: "Agent ishlayotganda amal 3 soniyada olinadi — tugma odatda faqat agent jim bo'lganda kerak bo'ladi.",
    steps: ["Agent to'xtab turgan paytda qo'yilgan keraksiz amallarni (masalan qayta yuklash) shu tugma bilan olib tashlang — agent qayta ishga tushganda kutilmaganda bajarilmasin.", "Xavfli amallar baribir 10 daqiqadan keyin avtomatik rad etiladi («muddati o'tdi»)."],
    keywords: "bekor qilish cancel navbat PENDING CANCELLED",
  },
  "act:output": {
    title: "Natija (output)", group: "amal",
    what: "Agent bajargan buyruqning ekranga chiqargan matni (oxirgi ~8 KB). Parol, token va kalitlar avtomatik yashiriladi.",
    normal: "Bajarilgan amalda qisqa muvaffaqiyat matni.",
    steps: ["Xatoni tushunmasangiz — shu matnni nusxalab dasturchiga yuboring."],
  },
  "act:timing": {
    title: "Kim, kutish va bajarilish", group: "amal",
    what: "Kim — amalni so'ragan superadmin («agent (avtomatik)» — tizimning o'zi). Kutish — navbatda qancha turgani. Bajarilish — qancha vaqt ishlagani.",
    normal: "Kutish bir necha soniya.",
  },

  /* ── Xavfsizlik ── */
  "sec:grade": {
    title: "Baho (A–F)", group: "xavfsizlik",
    what: "AI bergan umumiy xavfsizlik bahosi. A — juda yaxshi, B — yaxshi, C — kamchiliklar bor, D va E — jiddiy xavf, F — xavfli (buzib kirish belgisi yoki ochiq eshiklar).",
    normal: "A yoki B — oylik tekshiruv yetarli.",
    steps: ["C — hafta ichida tavsiyalarni bajaring.", "D/E/F — shu kuni choralar ko'ring: tavsiyalarni yuqoridan boshlang."],
    keywords: "baho grade",
  },
  "sec:ai": {
    title: "AI tahlil", group: "xavfsizlik",
    what: "Claude sun'iy intellekti barcha topilmalarni o'qib, qisqa xulosa va ustuvor tavsiyalar (nega xavfli, nima qilish kerak) yozadi. Har 6 soatda o'zi ishlaydi.",
    normal: "Yuboriladi: ochiq hodisalar, tekshiruv natijalari, CPU/xotira/disk foizlari, korxonalar soni. Yuborilmaydi: parollar, kalitlar, tokenlar, telefon va e-pochtalar (yashiriladi). IP manzillar qoladi.",
    steps: ["Tahlil uchun serverdagi `control.env` da `ANTHROPIC_API_KEY` bo'lishi kerak; bo'lmasa skaner baribir ishlaydi, faqat AI hisobot yo'q.", "Har tahlil kichik API to'lovi (bir necha sent)."],
    keywords: "ai claude anthropic",
  },
  "sec:recs": {
    title: "Tavsiyalar", group: "xavfsizlik",
    what: "AI topgan muammolar, og'irligi bo'yicha. «Nega xavfli» — oqibati. «Nima qilish kerak» — yechim. «Tuzatish» tugmasi — agar yechimni panel o'zi bajara olsa.",
  },
  "sec:incidents": {
    title: "Xavfsizlik hodisalari", group: "xavfsizlik",
    what: "Skaner va AI ochgan hal qilinmagan muammolar, toifa bo'yicha. Har qator yonidagi «?» shu topilma uchun oddiy ko'rsatma beradi.",
    normal: "Ro'yxat bo'sh.",
  },
  "sec:blocked": {
    title: "Bloklangan IP'lar", group: "xavfsizlik",
    what: "Firewall'da (ufw) bloklangan manzillar: qachon va kim blokladi, qaysi hodisa sababli.",
    normal: "Bir nechta hujumchi IP — normal.",
    steps: ["Xato bloklangan bo'lsa — «Blokdan chiqarish».", "Serverga o'zingiz kira olmay qolsangiz — server provayderi konsoli orqali kiring va `sudo ufw delete deny from <ip>`."],
    keywords: "ufw blok",
  },
  "sec:history": {
    title: "Hisobotlar tarixi", group: "xavfsizlik",
    what: "Oxirgi 20 ta AI hisobot: baho, sana, qo'lda yoki rejali, tavsiyalar soni. Baho yaxshilanib borayotganini kuzatish uchun.",
  },
  "sec:ssh": {
    title: "SSH, parol va kalit", group: "xavfsizlik",
    what: "SSH — serverga masofadan buyruq yozish uchun kirish yo'li. Parol bilan kirishni internetdagi botlar kun bo'yi taxmin qilib ko'radi. Kalit (fayl) bilan kirish deyarli buzib bo'lmaydi.",
    normal: "Faqat kalit bilan kirish, root bilan kirish yopiq, fail2ban yoqilgan.",
    steps: ["Avval kompyuteringizdan kalit bilan kira olishingizni tekshiring (`ssh-copy-id` bilan qo'shiladi).", "Keyin `/etc/ssh/sshd_config` da `PasswordAuthentication no` va `PermitRootLogin no`, so'ng `sudo sshd -t && sudo systemctl reload ssh`.", "Kalit ishlashini tekshirmasdan parolni o'chirmang — serverdan qulflanib qolasiz."],
    keywords: "ssh parol kalit root",
  },
  "sec:ufw": {
    title: "Firewall (ufw)", group: "xavfsizlik",
    what: "Firewall — server oldidagi «darvoza»: faqat ruxsat etilgan eshiklardan (22 — SSH, 80/443 — saytlar) kirish mumkin. ufw — Ubuntu'dagi oddiy firewall dasturi.",
    normal: "Yoqilgan (active), faqat 22, 80, 443 ochiq.",
    steps: ["Avval SSH'ni ruxsat eting (aks holda o'zingiz qulflanasiz): `sudo ufw allow 22/tcp`", "`sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`", "`sudo ufw enable` va `sudo ufw status`"],
    keywords: "ufw firewall port",
  },
  "sec:fail2ban": {
    title: "fail2ban", group: "xavfsizlik",
    what: "fail2ban — SSH'da ko'p marta noto'g'ri parol kiritgan IP'ni avtomatik vaqtincha bloklaydigan qorovul dastur.",
    normal: "Ishlayapti (active).",
    steps: ["`sudo apt install -y fail2ban`", "`printf '[sshd]\\nenabled = true\\nmaxretry = 5\\nfindtime = 10m\\nbantime = 1h\\n' | sudo tee /etc/fail2ban/jail.d/sshd.local`", "`sudo systemctl enable --now fail2ban && sudo fail2ban-client status sshd`"],
    keywords: "fail2ban brute force",
  },

  /* ── IT jamoasi va jurnal ── */
  "adm:new": {
    title: "Yangi superadmin qo'shish", group: "jamoa",
    what: "IT panelga yangi odam qo'shish. U barcha korxonalarga to'liq kirish huquqini oladi.",
    action: {
      does: "Panel bazasida yangi superadmin ochiladi, jurnalga yoziladi. Xavfsizlik skaneri ham yangi superadmin haqida ogohlantiradi.",
      risk: "Bu odam hamma narsani (korxonalar, server tugmalari) boshqara oladi — faqat ishonchli odamga bering.",
      level: "medium",
      duration: "Darhol",
      use: "Jamoaga yangi IT xodimi kelganda.",
    },
    steps: ["F.I.O., login va kuchli parol kiriting.", "Parolni shaxsan bering; birinchi kirishda «Mening parolim» orqali almashtirsin."],
  },
  "adm:table": {
    title: "IT jamoasi ustunlari", group: "jamoa",
    what: "Login — panelga kirish nomi. Holat — «Faol» kira oladi, «Bloklangan» kira olmaydi. Oxirgi kirish — panelga oxirgi marta qachon kirgan.",
    normal: "Uzoq vaqt kirmagan hisoblarni bloklab qo'ying.",
  },
  "adm:toggle": {
    title: "Bloklash / Yoqish", group: "jamoa",
    what: "Superadminning panelga kirishini to'xtatish yoki qaytarish.",
    action: {
      does: "Hisob faolligi o'zgaradi, jurnalga yoziladi. Bloklanganda u keyingi so'rovdayoq paneldan chiqariladi.",
      risk: "Xavfsiz. O'zingizni bloklab bo'lmaydi.",
      level: "safe",
      duration: "Darhol",
      use: "Xodim ishdan ketganda yoki hisob o'g'irlangan deb gumon qilinganda.",
    },
  },
  "adm:eco": {
    title: "Insof ECO ilovasi orqali kirish", group: "jamoa",
    what: "Panelga login/parol o'rniga Insof ECO ilovasidagi telefon raqami va ilova paroli bilan kirish. Hisobni faqat o'zingiz, joriy panel parolingiz bilan ulaysiz.",
    normal: "Ulangan bo'lsa IT jamoasi ro'yxatida loginingiz yonida «ECO» belgisi turadi. Har kirish jurnalga yoziladi.",
    steps: ["ECO paroli kuchli bo'lsin — u endi panel kaliti ham.", "Telefon yo'qolsa — shu yerda ulanishni uzing yoki ECO parolini almashtiring.", "ECO serveri ishlamasa — oddiy login/parol bilan kiring."],
    keywords: "eco telefon kirish",
  },
  "adm:password": {
    title: "Mening parolim", group: "jamoa",
    what: "O'z parolingizni almashtirish (joriy parol kerak).",
    normal: "Parolni 3–6 oyda bir almashtiring, boshqa joyda ishlatmang.",
  },
  "adm:reset": {
    title: "Parolni unutsangiz (server orqali)", group: "jamoa",
    what: "Panelga hech kim kira olmasa yoki superadmin parolini unutsa, parol serverda buyruq bilan o'rnatiladi.",
    steps: ["SSH orqali serverga kiring: `cd /var/www/insof-erp/current`", "`CONTROL_ENV_FILE=/var/www/insof-erp/control.env npm run control:admin -- <login> \"F.I.O.\"`", "Parolni ekran so'raydi (yozilganda ko'rinmaydi). Login mavjud bo'lsa — paroli almashtiriladi va eski sessiyalari tugaydi."],
    keywords: "control:admin parol tiklash",
  },
  "jur:columns": {
    title: "Jurnal ustunlari", group: "jamoa",
    what: "Vaqt — amal sanasi. Kim — superadmin («skript» — serverdagi buyruq). Amal — nima qilingan. Korxona — qaysi korxonada. Tafsilot — qo'shimcha (sabab, domen…). IP — qaysi internet manzildan.",
  },
  "jur:events": {
    title: "Jurnal amallari", group: "jamoa",
    what: "Korxona yaratildi/o'zgardi/to'xtatildi/qayta yoqildi; Direktor login/paroli berildi; Korxonaga kirdi (SSO); Panelga kirdi; Superadmin qo'shildi/bloklandi/paroli almashdi; Serverga amal so'rovi (agent); Hodisa ko'rildi/yopildi.",
    normal: "Notanish IP yoki tunda kirish — shubhali.",
  },

  /* ── Baza va trafik ── */
  "db:databases": {
    title: "Bazalar jadvali", group: "baza",
    what: "Hajm va o'sish (1 va 7 kun). Ulanish — hozir nechta dastur ulangan. Cache hit — ma'lumotning necha foizi tezkor xotiradan o'qildi (yuqori — yaxshi). O'lik qator — o'chirilgan, lekin hali tozalanmagan qatorlar. Deadlock — ikki so'rov bir-birini kutib qolgan holat.",
    normal: "Cache hit 99% ga yaqin, o'lik qator 20% dan kam, deadlock 0.",
    steps: ["Cache hit 90% dan past — server xotirasi bazaga yetmayapti.", "O'lik qator ko'p — «VACUUM»."],
    keywords: "cache hit dead tuples deadlock",
  },
  "db:connections": {
    title: "Ulanishlar", group: "baza",
    what: "active — hozir so'rov bajaryapti. idle — bo'sh kutib turibdi (normal). idle in transaction — tranzaksiyani ochiq qoldirib kutyapti (uzoq tursa jadvallarni bloklaydi).",
    normal: "Jami ulanishlar `max_connections` ning 80% dan kam; idle in transaction qisqa.",
  },
  "db:long": {
    title: "Uzoq so'rovlar va bloklar", group: "baza",
    what: "30 soniyadan uzoq ishlayotgan so'rovlar, uzoq tranzaksiyalar va boshqasini kutib qolgan (bloklangan) so'rovlar.",
    normal: "Ro'yxat bo'sh. Monitoring 5 daqiqadan uzoq so'rovni ogohlantirish, 30 daqiqadan uzog'ini nosoz deb hisoblaydi.",
    steps: ["Hisobot yoki eksport bo'lsa — biroz kuting.", "Osilib qolgan bo'lsa — «Bekor qilish».", "10 daqiqadan ortiq «idle in transaction» — «Ulanishni uzish»."],
  },
  "db:tables": {
    title: "Eng katta jadvallar", group: "baza",
    what: "Har bazadagi eng ko'p joy egallagan jadvallar: hajm, qatorlar soni (taxminiy), o'lik qatorlar va oxirgi avtomatik tozalash (autovacuum) vaqti.",
  },
  "db:statements": {
    title: "Eng og'ir so'rovlar", group: "baza",
    what: "pg_stat_statements — Postgres'ning qaysi so'rov qancha vaqt olganini hisoblaydigan qo'shimchasi. Bu yerda jami vaqt bo'yicha top 10. So'rov ichidagi qiymatlar yashirilgan.",
    normal: "Qo'shimcha yoqilmagan bo'lsa bo'sh — u ixtiyoriy (yoqish Postgres'ni qayta ishga tushiradi, 5–10 s uzilish; PLATFORMA.md).",
  },
  "tr:minutes": {
    title: "So'nggi 60 daqiqa", group: "baza",
    what: "Har daqiqadagi so'rovlar soni va ulardan nechtasi 5xx bilan tugagani. 5xx — server xatosi (dastur ishlamadi), 4xx — foydalanuvchi xatosi (sahifa topilmadi, kirish yo'q), 429 — juda ko'p so'rov (tezlik cheklovi).",
    normal: "5xx deyarli 0.",
    keywords: "5xx 4xx 429",
  },
  "tr:upstream": {
    title: "Upstream xatolari", group: "baza",
    what: "Upstream — nginx orqasidagi dastur (korxona sayti). Xato — nginx unga ulana olmadi: dastur o'chiq («Connection refused») yoki javob bermadi.",
    normal: "Yo'q.",
    steps: ["Shu domen xizmatini «Qayta ishga tushirish».", "Deploy paytida bir necha xato — normal."],
  },
  "tr:domains": {
    title: "Domenlar", group: "baza",
    what: "Har sayt bo'yicha so'rovlar soni (daqiqasiga), xato ulushlari va o'rtacha javob vaqti.",
    normal: "5xx 1% dan kam, o'rtacha javob 0.5 soniyadan kam.",
  },
  "tr:ips": {
    title: "Eng faol IP'lar", group: "baza",
    what: "Oxirgi 60 daqiqada eng ko'p so'rov yuborgan manzillar. Ofis (ko'p xodim bitta IP orqali) yoki mobil operator ham ko'p so'rov yuboradi — bu normal.",
    steps: ["Ko'p 4xx/429 va notanish IP — skaner yoki bot bo'lishi mumkin.", "Bloklashdan oldin IP o'zingizniki/mijozniki emasligini tekshiring."],
  },
  "tr:slow": {
    title: "Eng sekin yo'llar", group: "baza",
    what: "Qaysi sahifa yoki API eng sekin javob beryapti (o'rtacha va eng uzoq). Raqamli id'lar `:id` ga guruhlangan.",
    normal: "1 soniyadan kam.",
    steps: ["Doim sekin yo'lni dasturchiga ayting — kodni tezlashtirish kerak."],
  },
  "tr:limit": {
    title: "Tezlik cheklovi (limit_req)", group: "baza",
    what: "nginx bitta IP'dan juda ko'p so'rovni cheklaydi: insof_auth — login sahifasi (parol taxminiga qarshi), insof_pub — ochiq API, insof_ai — AI so'rovlari.",
    normal: "Kam son. Ko'p bo'lsa — kimdir login taxmin qilyapti yoki ilova xato tsiklda.",
  },

  /* ── Zaxira va tizim ── */
  "zx:remote": {
    title: "Masofadagi nusxa", group: "zaxira",
    what: "Zaxiraning server tashqarisidagi (bulutdagi) nusxasi. Server butunlay buzilsa yoki o'g'irlansa ham ma'lumot qoladi. rclone — nusxalarni bulutga yuboruvchi dastur.",
    normal: "«Ulanish bor», oxirgi nusxa masofada ham bor.",
    steps: ["Xato bo'lsa — rclone sozlamasi yoki bulut paroli eskirgan: dasturchi `rclone config` bilan yangilasin."],
    keywords: "rclone offsite bulut",
  },
  "zx:disk": {
    title: "Disk va prognoz", group: "zaxira",
    what: "Zaxiralar joylashgan diskda qancha joy bor va o'sish tezligiga qarab necha kunda to'lishi.",
    normal: "14 kundan ko'p. 14 kundan kam — ogohlantirish, 3 kundan kam — nosoz.",
    steps: ["Eski relizlarni va jurnalni tozalang («Tizim» sahifasi).", "Saqlash muddatini (KEEP_DAYS) kamaytiring yoki diskni kattalashtiring."],
  },
  "zx:copies": {
    title: "Mahalliy nusxalar", group: "zaxira",
    what: "Serverdagi har kunlik zaxira papkasi: hajmi, fayllar, SHA256SUMS bormi va masofaga yuborilganmi. SHA256SUMS — har faylning «barmoq izi»: nusxa buzilmaganini tekshirishga imkon beradi.",
    normal: "Har kun uchun bitta, hammasida SHA256SUMS ✓.",
    keywords: "sha256sums nusxa",
  },
  "zx:runs": {
    title: "Oxirgi zaxira va tiklash sinovi", group: "zaxira",
    what: "Zaxira va tiklash sinovi loglarining oxirgi qatorlari va natijasi (OK / Xato).",
    normal: "Ikkalasi OK. Tiklash sinovi 8 kundan eski bo'lmasin.",
    steps: ["Xato bo'lsa — log oxiridagi qatorni o'qing va dasturchiga yuboring."],
  },
  "srv:system": {
    title: "Tizim", group: "zaxira",
    what: "Operatsion tizim (OS), yadro (kernel — tizimning markaziy qismi), ishlash vaqti va qachon yoqilgani.",
  },
  "srv:reboot": {
    title: "Qayta yuklash kerakmi", group: "zaxira",
    what: "Yadro yoki muhim kutubxona yangilangandan keyin yangilik kuchga kirishi uchun serverni qayta yuklash kerak.",
    normal: "«Kerak emas».",
    steps: ["Kerak bo'lsa — kechasiga (masalan 03:00) rejalashtiring.", "Mijozlarni oldindan ogohlantiring — 1–3 daqiqa uzilish."],
    keywords: "reboot-required",
  },
  "srv:updates": {
    title: "Yangilanishlar (apt)", group: "zaxira",
    what: "apt — Ubuntu'ning dastur o'rnatuvchisi. Bu yerda kutilayotgan yangilanishlar, alohida — xavfsizlik yangilanishlari.",
    normal: "Xavfsizlik yangilanishlari 0 (avtomatik qo'yiladi).",
    steps: ["Panel apt upgrade qilmaydi (xavfli). Rejali vaqtda SSH orqali: `sudo apt update && sudo apt upgrade`", "Keyin kerak bo'lsa — qayta yuklash."],
    keywords: "apt upgrade",
  },
  "srv:unattended": {
    title: "Avtomatik xavfsizlik yangilanishlari", group: "zaxira",
    what: "unattended-upgrades — xavfsizlik yangilanishlarini har kuni o'zi o'rnatadigan Ubuntu xizmati.",
    normal: "«Yoqilgan».",
    steps: ["O'chiq bo'lsa: `sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`"],
  },
  "srv:dirs": {
    title: "Disk: eng katta papkalar", group: "zaxira",
    what: "Diskni nima to'ldiryapti: relizlar, zaxiralar, jurnal, yuklangan fayllar (uploads), loglar.",
    normal: "Hech biri keskin o'smayapti.",
  },
  "srv:releases": {
    title: "Relizlar (diskda)", group: "zaxira",
    what: "Serverdagi dastur versiyalari papkalari. Eng yangi 3 ta va joriy (current) — orqaga qaytarish uchun saqlanadi.",
  },

  /* ── Relizlar va loglar ── */
  "rel:current": {
    title: "Joriy reliz", group: "reliz",
    what: "Serverda hozir ishlayotgan dastur versiyasi (commit — koddagi bitta saqlangan o'zgarish, uning qisqa kodi).",
    normal: "Deploy va qaytarish tugmalari shu yerda.",
  },
  "rel:versions": {
    title: "Xizmatlar versiyasi", group: "reliz",
    what: "Har jarayon (korxona, panel) qaysi versiyada ishlayapti va u joriy reliz bilan mosmi.",
    normal: "Hammasi mos.",
    steps: ["Mos bo'lmasa — o'sha xizmatni «Qayta ishga tushirish»."],
  },
  "rel:commits": {
    title: "Yangi commitlar", group: "reliz",
    what: "GitHub'da bor, lekin serverga hali o'rnatilmagan o'zgarishlar ro'yxati. Agent har 5 daqiqada tekshiradi.",
    normal: "Dasturchi bilan kelishilgan holda deploy qilinadi.",
  },
  "rel:history": {
    title: "Deploy tarixi", group: "reliz",
    what: "Kim, qachon, qaysi versiyani o'rnatdi va natija (log oxiri).",
  },
  "log:source": {
    title: "Log manbai", group: "reliz",
    what: "Qaysi dasturning logini o'qish: korxona (`insof-erp@<slug>`), panel (`insof-control`), ECO, agent, nginx, yoki fayllar: nginx xato/kirish logi, zaxira, tiklash sinovi, deploy.",
  },
  "log:priority": {
    title: "Daraja", group: "reliz",
    what: "Qaysi muhimlikdagi yozuvlar: «Xatolar» — faqat xatolar (eng foydali), «Ogohlantirish» — xato + ogohlantirish, «Hammasi» — barcha qatorlar.",
  },
  "log:filter": {
    title: "Filtr", group: "reliz",
    what: "Faqat shu so'z bor qatorlar (oddiy matn, masalan «error» yoki IP).",
  },
} satisfies Record<string, HelpTopic>;

/* ═════════════════════════ Atamalar lug'ati ═════════════════════════ */

const TERMS = {
  "term:cpu": { title: "CPU", what: "Protsessor — serverning hisob-kitob qiluvchi «miyasi». Yadro (core) — uning alohida ishchi qismi; 4 yadro = bir vaqtda 4 ish." },
  "term:ram": { title: "RAM", what: "Tezkor xotira: ishlayotgan dasturlar shu yerda turadi. Server o'chsa tozalanadi." },
  "term:swap": { title: "Swap", what: "RAM yetmaganda diskdan olinadigan sekin qo'shimcha xotira. Ko'p ishlatilsa server sekinlashadi." },
  "term:load": { title: "Load", what: "CPU'da ishlayotgan va navbat kutayotgan jarayonlar soni. Yadro soniga bo'lib baholanadi: 1 dan kichik — yaxshi." },
  "term:nginx": { title: "nginx", what: "Veb-server: internetdan kelgan so'rovni domen bo'yicha kerakli korxona dasturiga yo'naltiradi va SSL (https) ni ta'minlaydi." },
  "term:systemd": { title: "systemd", what: "Linux'ning xizmatlarni boshqaruvchi qismi: dasturlarni yoqadi, o'chiradi va yiqilsa qayta ko'taradi. «unit» — u boshqaradigan bitta xizmat." },
  "term:ssl": { title: "SSL / TLS", what: "Sayt bilan brauzer orasidagi ma'lumotni shifrlash. Sertifikat — saytning «pasporti»; muddati o'tsa brauzer saytni xavfli deydi." },
  "term:dns": { title: "DNS", what: "Domen nomini (sharq.insof-erp.uz) server IP manziliga aylantiruvchi «telefon kitobi». A-yozuv — nom → IPv4 bog'lanishi." },
  "term:postgres": { title: "PostgreSQL", what: "Barcha korxona ma'lumotlari saqlanadigan baza dasturi. Har korxonaning alohida bazasi bor." },
  "term:port": { title: "Port", what: "Server ichidagi «eshik raqami»: 443 — https, 22 — SSH, 3101+ — korxona dasturlari (faqat ichkaridan)." },
  "term:ssh": { title: "SSH", what: "Serverga masofadan xavfsiz kirib, buyruq yozish usuli. Kalit bilan kirish paroldan ancha xavfsiz." },
  "term:ufw": { title: "ufw (firewall)", what: "Serverga qaysi portlar orqali kirish mumkinligini belgilovchi «darvoza» dasturi." },
  "term:fail2ban": { title: "fail2ban", what: "Ko'p marta noto'g'ri parol kiritgan IP'larni avtomatik vaqtincha bloklovchi dastur." },
  "term:agent": { title: "insof-agent", what: "Serverda ishlovchi yordamchi: ko'rsatkichlarni yig'adi, tekshiradi va paneldagi tugmalar buyruqlarini xavfsiz ro'yxat bo'yicha bajaradi." },
  "term:ip": { title: "IP manzil", what: "Internetdagi qurilmaning raqamli manzili, masalan 203.0.113.7. Bir ofis yoki mobil operator ortida ko'p odam bitta IP'da bo'lishi mumkin." },
  "term:sudo": { title: "sudo", what: "Buyruqni administrator (root) huquqi bilan bajarish. Agent faqat oldindan ruxsat etilgan bir nechta sudo buyrug'ini ishlata oladi." },
  "term:journald": { title: "journald / log", what: "Log — dasturlarning ish kundaligi. journald — Linux'ning barcha xizmatlar loglarini yig'uvchi ombori (`journalctl` bilan o'qiladi)." },
  "term:deploy": { title: "Deploy / reliz", what: "Deploy — yangi dastur versiyasini serverga o'rnatish. Reliz — o'rnatilgan bitta versiya." },
  "term:health": { title: "/api/health", what: "Har dasturning «tirikmisan?» manzili. Agent unga har 15 soniyada so'rov yuboradi; 200 javobi — ishlayapti." },
  "term:5xx": { title: "HTTP kodlari (2xx/4xx/5xx)", what: "200 — muvaffaqiyat. 4xx — so'rov xato (404 — topilmadi, 429 — juda ko'p so'rov). 5xx — server xatosi (502 — dastur javob bermadi)." },
  "term:migration": { title: "Migratsiya", what: "Baza tuzilishini (jadvallar, ustunlar) yangi versiyaga moslab o'zgartirish. Odatda orqaga qaytarilmaydi." },
  "term:telegram": { title: "Telegram ogohlantirish", what: "Jiddiy (Yuqori/Kritik) hodisa ochilganda va yopilganda IT guruhiga avtomatik xabar. Serverdagi `ALERT_TG_BOT_TOKEN` va `ALERT_TG_CHAT_ID` bilan sozlanadi." },
} satisfies Record<string, { title: string; what: string }>;

/* ═════════════════════════ Yig'ma lug'at ═════════════════════════ */

export type ActionTopicId = `action:${ActionType}`;
export type HelpTopicId = keyof typeof BASE | keyof typeof TERMS | ActionTopicId;

const actionEntries = Object.fromEntries(
  ACTION_TYPES.map((t) => [`action:${t}`, { ...ACTION_HELP[t], group: "amal" as const }]),
) as Record<ActionTopicId, HelpTopic>;

const termEntries = Object.fromEntries(
  Object.entries(TERMS).map(([k, v]) => [k, { ...v, group: "atama" as const }]),
) as Record<keyof typeof TERMS, HelpTopic>;

export const HELP: Record<HelpTopicId, HelpTopic> = { ...(BASE as Record<keyof typeof BASE, HelpTopic>), ...termEntries, ...actionEntries };

export const helpTopic = (id: string): HelpTopic | null => (Object.prototype.hasOwnProperty.call(HELP, id) ? HELP[id as HelpTopicId] : null);
export const actionHelpId = (type: string): HelpTopicId | null => (Object.prototype.hasOwnProperty.call(HELP, `action:${type}`) ? (`action:${type}` as HelpTopicId) : null);

/* ═════════════════════════ Tekshiruv / hodisa kalitlari bo'yicha yordam ═════════════════════════ */

type CheckHelp = Omit<HelpTopic, "group" | "check">;
const ch = (h: CheckHelp): HelpTopic => ({ ...h, group: "tekshiruv", check: true });

const AGENT_STEPS = ["SSH orqali serverga kiring.", "Holat: `sudo systemctl status insof-agent`", "Oxirgi xatolar: `journalctl -u insof-agent -n 50`", "Qayta yoqish: `sudo systemctl restart insof-agent`"];

/** Xavfsizlik moduli topilmalari (`security:<nom>`) — oddiy tilda. */
const SECURITY_HELP: Record<string, CheckHelp> = {
  scan: {
    title: "Xavfsizlik skaneri (umumiy)",
    what: "Barcha xavfsizlik tekshiruvlarining yig'ma natijasi: nechta tekshiruv o'tdi va nechta muammo topildi.",
    why: "Skaner ishlamasa, hujum yoki zaif sozlama sezilmay qoladi.",
    steps: ["«Xavfsizlik skanerini ishga tushirish» bilan qayta tekshiring.", "«modul hali o'rnatilmagan» — serverdagi kod eski: deploy kerak.", "«yuklanmadi» — agent logini o'qing: `journalctl -u insof-agent -n 80`"],
  },
  ssh: {
    title: "SSH tekshiruvi",
    what: "SSH loglarini (kirishlar va xato urinishlar) o'qib bo'lmadi — tekshiruv xato bilan tugadi yoki vaqtida tugamadi.",
    why: "Parol taxmini yoki begona kirish sezilmay qolishi mumkin.",
    steps: ["Agentga jurnal o'qish huquqi: `sudo usermod -aG systemd-journal,adm deploy && sudo systemctl restart insof-agent`", "Qayta: «Xavfsizlik skanerini ishga tushirish».", "Sabab hodisa tafsilotida (`reason`)."],
  },
  secrets: {
    title: "Sir fayllari tekshiruvi",
    what: "Kalit fayllarining (`control.env`, `tenants/*.env`) huquqlarini tekshirib bo'lmadi.",
    why: "Ochiq qolgan kalit fayli sezilmay qolishi mumkin.",
    steps: ["Sabab tafsilotda (`reason`).", "Fayllar joyidaligini tekshiring: `ls -l /var/www/insof-erp/control.env /var/www/insof-erp/tenants/`", "Qayta skaner."],
  },
  nginx: {
    title: "nginx loglari tekshiruvi",
    what: "nginx kirish logini (`/var/log/nginx/access.log`) o'qib bo'lmadi — skanerlar va xatolar sanalmadi.",
    why: "Saytga hujum yoki ko'p xato sezilmay qoladi.",
    steps: ["Agentni `adm` guruhiga qo'shing: `sudo usermod -aG adm deploy && sudo systemctl restart insof-agent`", "Qayta skaner."],
  },
  "ssh-bruteforce": {
    title: "SSH parol taxmini (brute force)",
    what: "Bir yoki bir nechta IP'dan serverga SSH orqali parol taxmin qilib kirishga urinishlar bo'lyapti (bir IP'dan soatiga 10 tadan ko'p xato).",
    why: "Parol topilsa, hujumchi butun serverni — barcha korxonalar ma'lumotini — qo'lga oladi.",
    steps: ["Hodisadagi «… ni bloklash» tugmasi bilan IP'ni bloklang (avval o'z IP'ingiz emasligini tekshiring).", "fail2ban o'rnating — keyingi safar o'zi bloklaydi.", "SSH'da parol bilan kirishni o'chiring, faqat kalit qoldiring (Xavfsizlik → «SSH, parol va kalit»)."],
  },
  "ssh-login": {
    title: "SSH orqali kirish",
    what: "Serverga SSH orqali muvaffaqiyatli kirilgan. Yangi IP'dan parol bilan — O'rta; kalit bilan — Past; parol taxmin qilgan IP'dan kirish — KRITIK (buzib kirilgan bo'lishi mumkin).",
    why: "Begona odam kirgan bo'lsa, u hamma narsani o'zgartira oladi.",
    steps: ["Bu siz yoki jamoangiz bo'lsa — hodisani izoh bilan yoping.", "Notanish bo'lsa — darhol: `last -n 20` va `sudo lastb | head` bilan kim kirganini ko'ring.", "Barcha server parollarini almashtiring va `~/.ssh/authorized_keys` dagi notanish kalitlarni o'chiring.", "IP'ni bloklang va dasturchi bilan serverni tekshiring."],
  },
  "sshd-config": {
    title: "SSH sozlamasi zaif",
    what: "SSH sozlamasida xavfli qiymat bor: root bilan kirish ochiq (Yuqori), parol bilan kirish yoqilgan (O'rta) yoki urinishlar soni cheklanmagan (Past).",
    why: "Zaif sozlama parol taxminini osonlashtiradi.",
    steps: ["Avval kalit bilan kira olishingizni tekshiring.", "`/etc/ssh/sshd_config` da: `PermitRootLogin no`, `PasswordAuthentication no`, `MaxAuthTries 3`", "`sudo sshd -t && sudo systemctl reload ssh`", "Batafsil: docs/server-xavfsizlik.md 3.2."],
  },
  firewall: {
    title: "Firewall (ufw) o'chiq",
    what: "Server firewall'i yoqilmagan — ichki portlar internetga ochiq bo'lishi mumkin.",
    why: "Baza yoki ichki dasturlar portiga tashqaridan to'g'ridan-to'g'ri ulanish mumkin bo'ladi.",
    steps: ["Avval SSH'ni ruxsat eting: `sudo ufw allow 22/tcp`", "`sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`", "`sudo ufw enable` → `sudo ufw status`", "«tekshirib bo'lmadi» bo'lsa — agentga `ufw status` huquqi kerak (server-xavfsizlik.md 6.2)."],
  },
  fail2ban: {
    title: "fail2ban yo'q",
    what: "Parol taxmin qiluvchi IP'larni avtomatik bloklaydigan fail2ban o'rnatilmagan yoki ishlamayapti.",
    why: "Har hujumni qo'lda bloklashga to'g'ri keladi.",
    steps: ["`sudo apt install -y fail2ban`", "`printf '[sshd]\\nenabled = true\\nmaxretry = 5\\nfindtime = 10m\\nbantime = 1h\\n' | sudo tee /etc/fail2ban/jail.d/sshd.local`", "`sudo systemctl enable --now fail2ban`"],
  },
  "open-ports": {
    title: "Ortiqcha ochiq port",
    what: "Internetga 22/80/443 dan boshqa port ochiq (masalan baza 5432 yoki korxona dasturi 3101 to'g'ridan-to'g'ri).",
    why: "Ichki xizmatga nginx va himoyani chetlab ulanish mumkin.",
    steps: ["Qaysi dastur: `sudo ss -tlnp`", "Dastur faqat `127.0.0.1` da tinglashi kerak; yoki `sudo ufw deny <port>`.", "Batafsil: docs/server-xavfsizlik.md 3.1."],
  },
  "secret-perms": {
    title: "Sir fayllari ochiq",
    what: "Parol/kalit fayllari (`control.env`, `tenants/*.env`…) boshqa foydalanuvchilar o'qiy oladigan holatda.",
    why: "Serverdagi boshqa jarayon buzilsa, barcha kalitlarni o'qib oladi.",
    steps: ["Hodisadagi «Maxfiy fayllar huquqini tuzatish (600)» tugmasini bosing.", "Keyin «Xavfsizlik skanerini ishga tushirish» — topilma yo'qolishi kerak."],
  },
  "root-env": {
    title: "Ildizda eski .env fayli",
    what: "Loyiha papkasida eski umumiy `.env` fayl qolgan — ko'p korxonali platformaga o'tish tugamagan.",
    why: "Eski kalitlar har jarayonga yuklanishi mumkin.",
    steps: ["`cd /var/www/insof-erp && mv .env .env.pre-platform`", "Keyin uni xavfsiz joyga ko'chirib o'chiring (PLATFORMA.md 7-qadam)."],
  },
  "tenant-secrets": {
    title: "Korxona kalitlari zaif",
    what: "Biror korxona `.env` faylida `AUTH_SECRET` (sessiya kaliti) yo'q yoki 32 belgidan qisqa, yoki korxona faylida panelning `CONTROL_SECRET` i bor.",
    why: "Qisqa kalit bilan sessiyani soxtalashtirish osonroq; panel kaliti korxonada bo'lsa — bitta korxona buzilsa hammasiga yo'l ochiladi.",
    steps: ["Yangi kalit: `openssl rand -hex 32`", "`tenants/<slug>.env` da `AUTH_SECRET=` ni almashtiring, `CONTROL_SECRET` qatorini o'chiring.", "Korxona xizmatini qayta ishga tushiring (foydalanuvchilar qayta kiradi).", "Batafsil: server-xavfsizlik.md 3.5."],
  },
  "http-headers": {
    title: "Xavfsizlik sarlavhalari yo'q",
    what: "Sayt javobida HSTS, CSP yoki X-Content-Type-Options kabi himoya sarlavhalari yo'q.",
    why: "Ular brauzerni ba'zi hujumlardan (soxta https, begona skript) himoya qiladi.",
    steps: ["nginx sozlamasiga sarlavhalarni qo'shing (server-xavfsizlik.md 3.4).", "So'ng «Nginx reload» tugmasi."],
  },
  "nginx-scanners": {
    title: "Sayt skanerlari",
    what: "Botlar saytda `/.env`, `/wp-admin`, `/.git` kabi yashirin fayllarni qidirmoqda.",
    why: "Odatda zararsiz avtomatik botlar, lekin zaif joy topilsa foydalanishi mumkin.",
    steps: ["Bir IP ko'p urinsa — «Bloklash» tugmasi.", "Bizda bunday fayllar ochiq emas — boshqa chora shart emas."],
  },
  "nginx-errors": {
    title: "Saytda ko'p xato (5xx / 429)",
    what: "Oxirgi so'rovlarning 5% dan ko'pi server xatosi (5xx) bilan tugagan, yoki tezlik cheklovi (429) ko'p ishlagan.",
    why: "Mijozlar sahifa o'rniga xato ko'ryapti.",
    steps: ["«Server va xizmatlar» da qaysi xizmat qizil — qayta ishga tushiring.", "«Trafik» da qaysi domen va yo'l xato beryapti.", "429 ko'p — bitta IP juda ko'p so'rov yuboryapti: tekshirib bloklang."],
  },
  "app-tenants": {
    title: "Korxonalar telemetriyasi",
    what: "Korxona bazalarini (faqat o'qib) va loglarini tekshirish umumiy holati.",
    why: "Ilova ichidagi shubhali harakatlarni (yangi direktorlar, login qulflari) sezish uchun.",
    steps: ["«tekshirib bo'lmadi» — agentga korxona bazalariga ulanish kerak (`TENANT_DATABASE_URL`)."],
  },
  "app-privileges": {
    title: "Korxonada yangi yuqori huquqlar",
    what: "So'nggi 24 soatda korxonada yangi direktor/IT hisobi ochilgan yoki kimningdir roli ko'tarilgan (O'rta), yoki ko'p ruxsat/parol o'zgargan (Past).",
    why: "Begona odam o'ziga direktor huquqini olgan bo'lishi mumkin.",
    steps: ["Tafsilotdan qaysi korxona va hisob ekanini ko'ring.", "Direktordan bu o'zgarishni o'zi qilganini so'rang.", "Bilmasa — «Kirish (IT)» orqali hisobni bloklang va direktor parolini almashtiring."],
  },
  "app-logins": {
    title: "ERP login qulflari",
    what: "Korxona saytida ko'p noto'g'ri parol tufayli login yoki IP qulflangan.",
    why: "Kimdir xodim parolini taxmin qilyapti.",
    steps: ["Bir IP bo'lsa — tavsiya etilgan «Bloklash».", "Xodim o'zi parolni unutgan bo'lishi ham mumkin — direktor bilan aniqlang."],
  },
  "control-activity": {
    title: "IT paneldagi g'ayrioddiy faollik",
    what: "Panelda yangi superadmin, parol almashuvi, login qulfi yoki ish vaqtidan (08:00–20:00) tashqari kirish/SSO bo'lgan.",
    why: "Panel hisobi o'g'irlangan bo'lsa — barcha korxonalar xavf ostida.",
    steps: ["«Jurnal» sahifasida kim, qachon, qaysi IP'dan.", "Siz bo'lmasangiz — o'sha superadminni bloklang, parollarni almashtiring."],
  },
  "os-updates": {
    title: "Tizim xavfsizlik yangilanishlari",
    what: "Ubuntu uchun xavfsizlik yangilanishlari kutilmoqda (openssl, openssh, kernel yoki 10 tadan ko'p — Yuqori).",
    why: "Ma'lum zaif joylar orqali serverni buzish mumkin.",
    steps: ["Avtomatik yangilanishlar yoqilganini tekshiring («Tizim» sahifasi).", "Rejali vaqtda SSH orqali: `sudo apt update && sudo apt upgrade`", "Keyin «Qayta yuklash kerak» chiqsa — kechasiga rejalashtiring."],
  },
  "reboot-required": {
    title: "Qayta yuklash kutilmoqda",
    what: "Yadro yoki kutubxona yangilangan — kuchga kirishi uchun serverni qayta yuklash kerak.",
    why: "Qayta yuklanmaguncha eski (zaif) versiya ishlayveradi.",
    steps: ["«Tizim» sahifasida «Serverni qayta yuklash» → kechki vaqtni tanlang (masalan 03:00)."],
  },
  "npm-audit": {
    title: "Dastur kutubxonalarida zaiflik",
    what: "Loyihada ishlatilgan npm paketlarida ma'lum xavfsizlik zaifliklari topilgan.",
    why: "Zaif paket orqali saytga hujum qilish mumkin.",
    steps: ["Dasturchiga ayting: `npm audit` va paketlarni yangilash, keyin deploy.", "Server tomonidan tugma bilan tuzatib bo'lmaydi."],
  },
  "npm-accepted-risk": {
    title: "Qabul qilingan xavf (sharp)",
    what: "`sharp` rasm kutubxonasining eski versiyasi ataylab qoldirilgan (server protsessori yangisini qo'llamaydi).",
    why: "Xavf ma'lum va yumshatilgan; eslatma sifatida turadi.",
    steps: ["Hech narsa qilish shart emas. Server almashtirilganda dasturchi `sharp` ni yangilaydi."],
  },
};

const SERVICE_NAMES: [RegExp, string][] = [
  [/^insof-control$/, "IT panel"],
  [/^insof-eco$/, "ECO API (mobil ilova serveri)"],
  [/^insof-agent$/, "Monitoring agenti"],
  [/^nginx$/, "nginx (veb-server)"],
  [/^postgresql/, "PostgreSQL (baza)"],
];

function unitHelp(unit: string): HelpTopic {
  const erp = /^insof-erp@(.+)$/.exec(unit);
  if (erp) {
    const slug = erp[1];
    return ch({
      title: `Korxona xizmati: ${slug}`,
      what: `\`insof-erp@${slug}\` — «${slug}» korxonasining ERP dasturi. U ishlamasa shu korxona sayti va mobil ilovasi ochilmaydi.`,
      why: "Xodimlar zayavka, kassa, ombor bilan ishlay olmaydi.",
      normal: "Yashil «Ishlayapti» (active).",
      steps: ["«Qayta ishga tushirish» tugmasi (korxona qisqa nomini yozib tasdiqlaysiz).", "1 daqiqadan keyin yashil bo'lmasa — «Loglar» → `insof-erp@" + slug + "` → «Xatolar».", "Serverda: `sudo systemctl status insof-erp@" + slug + "` va `journalctl -u insof-erp@" + slug + " -n 80`", "«restart oshgan» (sariq) — dastur o'zi yiqilib-turyapti: logdagi xatoni dasturchiga yuboring."],
    });
  }
  if (unit === "insof-control") return ch({
    title: "IT panel xizmati (insof-control)",
    what: "`insof-control` — siz hozir ishlatayotgan IT panelning o'zi.",
    why: "U to'xtasa panel ochilmaydi (korxonalar saytlari ishlayveradi).",
    normal: "Yashil.",
    steps: ["«Qayta ishga tushirish» — panel 5–30 s ochilmaydi, keyin sahifani yangilang.", "Serverda: `sudo systemctl status insof-control`"],
  });
  if (unit === "insof-eco") return ch({
    title: "ECO API xizmati (insof-eco)",
    what: "`insof-eco` — Insof ECO mobil ilovasining serveri.",
    why: "U ishlamasa mobil ilova ma'lumot ololmaydi.",
    normal: "Yashil.",
    steps: ["«Qayta ishga tushirish».", "Serverda: `sudo systemctl status insof-eco` va `journalctl -u insof-eco -n 80`"],
  });
  if (unit === "nginx") return ch({
    title: "nginx (veb-server)",
    what: "nginx — internetdan kelgan so'rovlarni korxona dasturlariga yo'naltiruvchi veb-server. U to'xtasa BARCHA saytlar ochilmaydi.",
    why: "Hamma korxona bir vaqtda to'xtaydi.",
    normal: "Yashil.",
    steps: ["Serverda sozlamani tekshiring: `sudo nginx -t`", "Xato yo'q bo'lsa: `sudo systemctl restart nginx`", "Sozlamada xato bo'lsa — oxirgi o'zgartirilgan faylni (`/etc/nginx/sites-enabled/`) dasturchi tuzatsin.", "Panelda «Nginx reload» faqat sozlamani qayta o'qitadi — to'xtagan nginx'ni ko'tarmaydi."],
  });
  if (/^postgresql/.test(unit)) return ch({
    title: "PostgreSQL (baza) xizmati",
    what: `\`${unit}\` — barcha korxonalar ma'lumotlari saqlanadigan baza dasturi.`,
    why: "U to'xtasa BARCHA korxonalar va panel ishlamaydi.",
    normal: "Yashil.",
    steps: ["Disk to'lmaganini tekshiring (Disk kartasi) — eng ko'p sabab shu.", "Serverda: `sudo systemctl status " + unit + "` va `sudo journalctl -u " + unit + " -n 80`", "Qayta yoqish: `sudo systemctl restart " + unit + "` (5–10 s uzilish).", "Ko'tarilmasa — darhol dasturchi bilan bog'laning, hech narsani o'chirmang."],
  });
  if (unit === "insof-agent") return ch({ title: "Monitoring agenti xizmati", what: "`insof-agent` — ko'rsatkichlarni yig'uvchi va tugmalarni bajaruvchi dastur.", why: "U ishlamasa panel ma'lumoti eskiradi va tugmalar bajarilmaydi.", steps: AGENT_STEPS });
  const name = SERVICE_NAMES.find(([re]) => re.test(unit))?.[1] ?? unit;
  return ch({
    title: `Xizmat: ${name}`,
    what: `\`${unit}\` — serverda doim ishlab turishi kerak bo'lgan dastur (systemd xizmati).`,
    why: "Xizmat to'xtasa unga bog'liq qism ishlamaydi.",
    steps: ["Serverda: `sudo systemctl status " + unit + "`", "Xato: `journalctl -u " + unit + " -n 80`", "Qayta yoqish: `sudo systemctl restart " + unit + "`"],
  });
}

const FALLBACK: HelpTopic = ch({
  title: "Tekshiruv natijasi",
  what: "Agentning tekshiruvi muammo topgan. Bu kalit uchun maxsus tushuntirish hali yozilmagan.",
  why: "Sariq yoki qizil bo'lsa — biror narsa chegaradan oshgan yoki ishlamayapti.",
  steps: ["Xabar matnini va «Tafsilot» ni o'qing.", "«Hozir tekshirish» bilan qayta tekshiring.", "Tushunarsiz bo'lsa — hodisa havolasini dasturchiga yuboring."],
});

/**
 * Tekshiruv yoki hodisa kaliti (`ServiceCheck.key` / `Incident.key`) bo'yicha oddiy tildagi yordam:
 * nima bo'ldi, nega muhim, qanday tuzatiladi (panel tugmasi va kerak bo'lsa server buyruqlari).
 * Noma'lum kalit — umumiy yordam (`fallback: true`).
 */
export function helpForCheckKey(key: string): HelpTopic & { fallback?: boolean } {
  const k = key.trim();
  const after = (p: string) => k.slice(p.length);

  if (k.startsWith("unit:")) return unitHelp(after("unit:"));

  if (k.startsWith("http:tenant:")) {
    const slug = after("http:tenant:");
    return ch({
      title: `Korxona sayti javobi: ${slug}`,
      what: `Agent har 15 soniyada «${slug}» korxonasi dasturining \`/api/health\` manziliga so'rov yuboradi. Qizil — javob yo'q yoki 503; sariq — 2 soniyadan sekin yoki «versiya eski» (dastur joriy relizdan eski kodda ishlayapti).`,
      why: "Qizil bo'lsa shu korxona xodimlari tizimga kira olmaydi.",
      normal: "Yashil, 300 ms atrofida, versiya joriy reliz bilan bir xil.",
      steps: ["«Server va xizmatlar» da `insof-erp@" + slug + "` kartasidagi «Qayta ishga tushirish».", "«versiya eski» — deploy'dan keyin shu xizmat yangilanmagan: xuddi shu tugma yechadi.", "Sekin bo'lsa — CPU, xotira va «Baza» dagi uzoq so'rovlarni tekshiring.", "Serverda: `curl -s http://127.0.0.1:<port>/api/health` (port korxona sahifasida)."],
    });
  }
  if (k === "http:control") return ch({
    title: "IT panel javobi",
    what: "IT panel (`insof-control`) `/api/health` manziliga javob bermayapti yoki sekin.",
    why: "Panel ochilmasligi yoki sekin ishlashi mumkin (korxonalar saytlariga ta'sir qilmaydi).",
    normal: "Yashil.",
    steps: ["«Qayta ishga tushirish» → `insof-control`.", "Serverda: `sudo systemctl status insof-control`"],
  });
  if (k === "http:eco") return ch({
    title: "ECO API javobi",
    what: "Insof ECO mobil ilovasi serverining `/v1/health` manzili javob bermayapti yoki sekin. «tekshirilmaydi» — ECO manzili sozlanmagan (bu xato emas).",
    why: "Mobil ilova foydalanuvchilari ma'lumot ololmaydi.",
    normal: "Yashil.",
    steps: ["`insof-eco` xizmatini «Qayta ishga tushirish».", "Serverda: `journalctl -u insof-eco -n 80`"],
  });
  if (k === "db:postgres") return ch({
    title: "PostgreSQL holati",
    what: "Bazaga ulanishlar soni (`max_connections` — ruxsat etilgan maksimum — dan foiz), eng uzun ishlayotgan so'rov va bazalar hajmi tekshiriladi.",
    why: "Ulanishlar tugasa yangi foydalanuvchilar kira olmaydi; uzoq so'rov jadvallarni bloklaydi.",
    normal: "Ulanishlar 80% dan kam, eng uzun so'rov 5 daqiqadan qisqa. 95% yoki 30 daqiqa — nosoz.",
    steps: ["«Baza» sahifasida uzoq so'rovni toping → «Bekor qilish».", "10 daqiqadan ko'p «idle in transaction» — «Ulanishni uzish».", "Ulanishlar doim ko'p — qaysi korxona ko'p ulanayotganini «Ulanishlar baza bo'yicha» da ko'ring va o'sha xizmatni qayta ishga tushiring."],
  });
  if (k.startsWith("db:tenant:")) {
    const slug = after("db:tenant:");
    return ch({
      title: `Korxona bazasi: ${slug}`,
      what: `«${slug}» korxonasining PostgreSQL bazasi topilmadi yoki unga ulanib bo'lmadi.`,
      why: "Baza bo'lmasa korxona umuman ishlamaydi.",
      normal: "Yashil — baza bor.",
      steps: ["PostgreSQL xizmati yashilmi — tekshiring.", "Serverda: `sudo -u postgres psql -lqt | grep " + slug.replace(/-/g, "_") + "`", "Baza yo'q bo'lsa — HECH NARSA QILMANG, darhol dasturchiga: zaxiradan tiklash kerak bo'lishi mumkin."],
    });
  }
  if (k === "db:stats") return ch({
    title: "PostgreSQL statistikasi",
    what: "«Baza» sahifasi uchun yig'iladigan batafsil ma'lumot: uzoq tranzaksiyalar, bloklar, cache hit, o'lik qatorlar.",
    why: "Sekinlik sababini topishga yordam beradi.",
    steps: ["«Baza» sahifasini oching — muammo qatorini toping.", "«tekshirib bo'lmadi» — agentning korxona bazalariga ulanishi (`TENANT_DATABASE_URL`) sozlanmagan."],
  });
  if (k.startsWith("ssl:")) {
    const d = after("ssl:");
    return ch({
      title: `SSL sertifikat: ${d}`,
      what: `\`${d}\` domenining sertifikati muddati tugashiga oz qolgan, muddati o'tgan yoki unga ulanib bo'lmadi. 21 kundan kam — ogohlantirish, 7 kundan kam yoki ishonchsiz — nosoz.`,
      why: "Muddat tugasa brauzer «Xavfli sayt» deydi va mijozlar kira olmaydi.",
      normal: "21 kundan ko'p qolgan (certbot 30 kun qolganda o'zi yangilaydi).",
      steps: ["«SSL yangilash» tugmasi («SSL» deb tasdiqlanadi).", "«ulanib bo'lmadi» — domen DNS'i shu serverga yo'naltirilmagan yoki 443 yopiq: `nslookup " + d + "`", "Serverda: `sudo certbot certificates` va `sudo certbot renew --dry-run`"],
    });
  }
  if (k === "backup:latest") return ch({
    title: "Oxirgi zaxira nusxa",
    what: "Tungi zaxira 26 soatdan eski, `SHA256SUMS` (nusxa butunligini tekshirish fayli) yo'q yoki zaxira logida xato bor.",
    why: "Server buzilsa yoki xato bilan ma'lumot o'chsa, oxirgi kunlar ma'lumoti qaytmaydi.",
    normal: "24 soatdan yangi nusxa, SHA256SUMS bor.",
    steps: ["«Zaxira olish» tugmasi.", "«Zaxira» sahifasida «Oxirgi zaxira jarayoni» logini o'qing.", "«papka yo'q» — `/var/backups/insof` yo'q yoki zaxira sozlamasi (backup.env) boshqa joyni ko'rsatadi.", "Serverda: `tail -n 50 /var/log/insof-backup.log`"],
  });
  if (k === "backup:inventory") return ch({
    title: "Zaxira inventari",
    what: "Zaxira tizimining to'liq holati: nusxa yoki tiklash sinovi xato, sinov 8 kundan eski, masofaga yuborilmagan, SHA yo'q, tugallanmagan `.partial` nusxa yoki disk tez orada to'ladi.",
    why: "Zaxira ishonchsiz bo'lsa kerak paytda yordam bermaydi.",
    steps: ["«Zaxira» sahifasidagi sariq/qizil blokni o'qing.", "Tiklash sinovi eski — «Tiklash sinovi».", "Masofa xatosi — dasturchi `rclone config` ni tekshirsin.", "Disk tez to'lyapti — «Tizim» da eski relizlar va jurnalni tozalang."],
  });
  if (k === "host:cpu") return ch({ ...pick("mon:cpu"), title: "CPU yuklamasi", why: "CPU to'liq band bo'lsa barcha saytlar sekinlashadi." });
  if (k === "host:memory") return ch({ ...pick("mon:ram"), title: "Xotira (RAM)", why: "Xotira tugasa Linux dasturlarni majburan o'chiradi (OOM) — saytlar yiqiladi." });
  if (k === "host:load") return ch({ ...pick("mon:load"), title: "Yuklama (load)", why: "Load yadrolar sonidan ancha katta bo'lsa server javoblari sekinlashadi." });
  if (k === "host:disk") return ch({ ...pick("mon:disk"), title: "Disk joyi", why: "Disk to'lsa baza yozolmaydi — barcha korxonalar to'xtaydi." });
  if (k === "host:reboot") return ch({ ...pick("srv:reboot"), title: "Qayta yuklash kerak", why: "Yangilangan yadro qayta yuklanmaguncha kuchga kirmaydi." });
  if (k === "host:system") return ch({
    title: "Server tizimi",
    what: "Avtomatik xavfsizlik yangilanishlari (unattended-upgrades) o'rnatilmagan yoki o'chiq.",
    why: "Xavfsizlik tuzatishlari o'z vaqtida qo'yilmaydi.",
    steps: ["`sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades`", "«Tizim» sahifasida «Yoqilgan» bo'lishini tekshiring."],
  });
  if (k.startsWith("journal:")) {
    const u = after("journal:");
    return ch({
      title: u === "all" ? "Tizim jurnali" : `Xatolar jurnali: ${u}`,
      what: u === "all" ? "Jurnalni o'qib bo'lmadi (Linux emas yoki huquq yo'q)." : `\`${u}\` xizmati oxirgi 5 daqiqada ko'p xato yozgan: 10 qatordan — ogohlantirish, 50 dan — nosoz.`,
      why: "Ko'p xato — dastur noto'g'ri ishlayapti, foydalanuvchilar xato ko'ryapti.",
      normal: "5 daqiqada 10 tadan kam xato qatori.",
      steps: ["«Loglar» → manba `" + (u === "all" ? "insof-agent" : u) + "` → «Xatolar» → «Yangilash».", "Bir xil xato takrorlansa — matnini dasturchiga yuboring.", "«journalctl xato» — agent `systemd-journal` guruhida emas: `sudo usermod -aG systemd-journal,adm deploy && sudo systemctl restart insof-agent`"],
    });
  }
  if (k.startsWith("agent:")) return ch({
    title: "Agent signali",
    what: "`insof-agent` panelga muntazam «tirikman» signali yuboradi. 60 soniyadan ko'p signal bo'lmasa — «Agent javob bermayapti».",
    why: "Agent jim bo'lsa barcha ko'rsatkichlar eskiradi va tugmalar bajarilmaydi.",
    normal: "Yashil «Agent ishlayapti».",
    steps: AGENT_STEPS,
  });
  if (k.startsWith("security:")) {
    const name = after("security:");
    const h = SECURITY_HELP[name];
    if (h) return ch(h);
  }
  if (k === "traffic:nginx") return ch({
    title: "Nginx trafik",
    what: "Saytlarga kelayotgan so'rovlarning 5% (yoki 20%) dan ko'pi server xatosi (5xx) bilan tugayapti, yoki nginx logini o'qib bo'lmadi.",
    why: "Mijozlar xato sahifasini ko'ryapti.",
    steps: ["«Trafik» sahifasida qaysi domen xato beryapti.", "O'sha korxona xizmatini «Qayta ishga tushirish».", "«o'qishga ruxsat yo'q» — `sudo usermod -aG adm deploy && sudo systemctl restart insof-agent`"],
  });
  if (k.startsWith("traffic:upstream:")) {
    const d = after("traffic:upstream:");
    return ch({
      title: `Upstream xatolari: ${d}`,
      what: `nginx \`${d}\` domeni orqasidagi dasturga ulana olmayapti (5 daqiqada 3 tadan ko'p xato; «Connection refused» — dastur umuman o'chiq).`,
      why: "Shu domen sayti ochilmaydi (502 xato).",
      steps: ["Hodisadagi yoki «Trafik» dagi «Qayta ishga tushirish» tugmasi.", "Yana takrorlansa — «Loglar» da shu korxona xizmati logi."],
    });
  }
  if (k === "release:info") return ch({
    title: "Relizlar holati",
    what: "Agent GitHub'dan yangi o'zgarishlarni olib bo'lmadi (`git fetch`) yoki joriy relizni aniqlay olmadi.",
    why: "Deploy va «versiya eski» tekshiruvi ishonchsiz bo'ladi.",
    steps: ["«Relizlar» sahifasidagi xabarni o'qing.", "Serverda: `cd /var/www/insof-erp && git fetch origin main` — xato bo'lsa GitHub kaliti (deploy key) eskirgan."],
  });
  if (k.startsWith("ai:")) return ch({
    title: "AI tavsiyasi",
    what: "AI xavfsizlik tahlili jiddiy (Yuqori/Kritik) muammoni topgan va hodisa ochgan. «Tafsilot» da «why» — nega xavfli, «fix» — nima qilish kerak.",
    why: "AI bir nechta topilmani birlashtirib xavfni ko'radi.",
    steps: ["Tafsilotdagi «fix» ni o'qing.", "«Tuzatish» tugmasi bo'lsa — ishlating.", "Bajarib bo'lgach hodisani izoh bilan qo'lda yoping (AI hodisalari o'zi yopilmaydi)."],
  });
  return { ...FALLBACK, fallback: true };
}

function pick(id: keyof typeof BASE): CheckHelp {
  const t = BASE[id] as HelpTopic;
  return { title: t.title, what: t.what, normal: t.normal, steps: t.steps, keywords: t.keywords };
}

/** «Yordam» sahifasida ko'rsatiladigan namunaviy kalitlar (har prefiksdan bittadan). */
export const CHECK_KEY_EXAMPLES: string[] = [
  "agent:heartbeat", "host:cpu", "host:memory", "host:load", "host:disk", "host:reboot", "host:system",
  "unit:insof-erp@<slug>", "unit:insof-control", "unit:insof-eco", "unit:nginx", "unit:postgresql@14-main",
  "http:tenant:<slug>", "http:control", "http:eco", "db:postgres", "db:tenant:<slug>", "db:stats",
  "ssl:<domen>", "backup:latest", "backup:inventory", "journal:<xizmat>", "traffic:nginx", "traffic:upstream:<domen>",
  "release:info", "ai:<tavsiya>",
  ...Object.keys(SECURITY_HELP).map((n) => `security:${n}`),
];
export const SECURITY_HELP_NAMES = Object.keys(SECURITY_HELP);
