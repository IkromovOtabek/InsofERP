import { fmtNum } from "@/lib/format";
import { numWords, numWordsRu } from "@/lib/num-words";

/**
 * Ijara shartnomasi matni — sekretarning «Договор аренды нежилого помещения» shabloni bo'yicha (ruscha) va uning
 * o'zbekcha (lotin) nusxasi. Ma'lumot `page.tsx` dan (`ContractData`): bo'sh maydon chop etishda chiziq (____) bo'ladi.
 */

export type ContractLang = "ru" | "uz";

export type ContractData = {
  no: string; date: Date; city: string;
  lessor: {
    person: boolean; name: string; basis: string; address: string; inn: string; bank: string; mfo: string; account: string;
    card: string; phone: string; taxPercent: number;
  };
  tenant: { name: string; rep: string; address: string; inn: string; account: string; mfo: string; phone: string };
  object: { address: string; cadastre: string; area: number | null };
  rent: { daily: boolean; bank: number; cash: number; payDay: number | null; start: Date; end: Date | null; deposit: number; electricity: boolean; elecFixed: number };
  note: string | null;
};

const B = "________________";
const pad2 = (n: number) => String(n).padStart(2, "0");
const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
const dmy = (d: Date) => `${pad2(d.getUTCDate())}.${pad2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
const longRu = (d: Date) => `«${pad2(d.getUTCDate())}» ${RU_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} года`;
const longUz = (d: Date) => `${d.getUTCFullYear()}-yil «${pad2(d.getUTCDate())}» ${UZ_MONTHS[d.getUTCMonth()]}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : B);

type Section = { title: string; items: (string | { head: string; sub: string[] })[] };

/** Ruscha matn — shablondagi bandlar, o'zgaruvchilar ma'lumotdan. */
function ru(d: ContractData): { title: string; subtitle: string; intro: string; sections: Section[]; act1: string; act1Items: string[]; act2: string; act2Items: string[] } {
  const L = d.lessor, T = d.tenant, R = d.rent, O = d.object;
  const total = R.bank + R.cash;
  const lessorIntro = L.person
    ? `Частное лицо, гражданин(ка) Республики Узбекистан ${L.name}${L.basis ? `, ${L.basis}` : ""}, именуемое в дальнейшем «Арендодатель»`
    : `${L.name}${L.basis ? `, ${L.basis}` : ""}, именуемое в дальнейшем «Арендодатель»`;
  const tenantIntro = `${v(T.name)}${T.rep ? `, ${T.rep}` : ""}, именуемое в дальнейшем «Арендатор»`;
  const obj = `${v(O.address)} (кадастровый номер ${v(O.cadastre)}), нежилое коммерческое помещение, общей площадью ${O.area ? fmtNum(O.area, 2) : "___"} кв.м.`;
  const how = R.bank && R.cash ? `по безналичному расчету ${fmtNum(R.bank)} сум и наличными ${fmtNum(R.cash)} сум, всего` : R.cash ? "наличными в сумме" : "по безналичному расчету в сумме";
  const when = R.daily ? "ежедневно" : `ежемесячно, не позднее ${R.payDay ?? "___"}-го числа текущего месяца`;
  const pay: string[] = [
    `Арендатор оплачивает арендную плату ${how} ${fmtNum(total)} (${cap(numWordsRu(total))}) сум, ${when}.`,
    "Указанная в п. 2.1. настоящего Договора сумма арендной платы может пересматриваться Арендодателем не чаще одного раза в три месяца. О принятом решении Арендодатель уведомляет Арендатора в письменной форме.",
    "В случае несогласия Арендатора с изменением размера арендной платы настоящий Договор подлежит расторжению.",
    "Арендатор получает полное право использовать Объект после подписания Сторонами Акта приема-передачи.",
  ];
  if (L.person && L.taxPercent > 0) {
    pay.push(`В сумму арендной платы, указанную в п. 2.1. настоящего Договора, включен налог на доходы физических лиц в размере ${fmtNum(L.taxPercent, 2)}%, подлежащий уплате с дохода Арендодателя. Указанный налог исчисляется и уплачивается Арендатором в бюджет по месту налогового учета Арендодателя.`);
    pay.push(`Арендная плата выплачивается Арендатором путем перечисления денежных средств ${L.card ? "на банковскую карту" : "на банковский счет"} Арендодателя. При этом Арендатор удерживает из суммы арендной платы налог на доходы физических лиц в размере ${fmtNum(L.taxPercent, 2)}% и перечисляет его в бюджет в установленном законодательством порядке.`);
  }
  if (R.electricity) pay.push(R.elecFixed > 0
    ? `Оплата электроэнергии производится Арендатором отдельно от арендной платы в размере ${fmtNum(R.elecFixed)} (${cap(numWordsRu(R.elecFixed))}) сум ежемесячно либо по показаниям счетчика по тарифу, установленному Арендодателем.`
    : "Оплата электроэнергии производится Арендатором отдельно от арендной платы по показаниям счетчика по тарифу, установленному Арендодателем.");
  if (R.deposit > 0) pay.push(`Арендатор вносит залог в размере ${fmtNum(R.deposit)} (${cap(numWordsRu(R.deposit))}) сум. По окончании Договора залог возвращается Арендатору за вычетом задолженности и сумм возмещения ущерба.`);
  pay.push(`Оплата по договору производится с ${dmy(R.start)} года.`);

  return {
    title: "Договор",
    subtitle: `аренды нежилого помещения № ${d.no}`,
    intro: `${lessorIntro} с одной стороны, и ${tenantIntro}, с другой стороны, а по отдельности Сторона, заключили настоящий Договор о нижеследующем:`,
    sections: [
      { title: "Предмет договора", items: [
        `Предметом Договора является аренда части нежилого помещения, расположенного по адресу: ${obj} (далее - Объект).`,
        "Арендодатель передает Арендатору Объект за арендную плату во временное владение и пользование, без права выкупа, с целью осуществления предпринимательской деятельности (торговый магазин), на основании Акта приема-передачи Объекта (Приложение №1), который является неотъемлемой частью Договора (далее – Акт приема-передачи).",
        "Арендатор вправе передать часть Объекта третьему лицу в субаренду только с письменного согласия Арендодателя.",
        "Объект передается Арендатору в состоянии, пригодном для использования по назначению. Для подтверждения состояния Объекта на момент передачи составляются и подписываются Сторонами три фотоснимка, которые прилагаются к настоящему Договору и являются его неотъемлемой частью.",
      ] },
      { title: "Порядок расчетов", items: pay },
      { title: "Обязанности и права Сторон", items: [
        { head: "Арендодатель обязуется:", sub: [
          "передать Объект Арендатору в состоянии, соответствующем условиям Договора и назначению Объекта, его правоустанавливающим и техническим документам и свободный от притязания третьих лиц;",
          "обеспечить беспрепятственное использование Объекта Арендатором на условиях Договора;",
          "обеспечить нормальное функционирование Объекта в соответствии с его функциональным назначением, в том числе электроснабжением, теплоэнергией, канализацией и водоснабжением.",
        ] },
        { head: "Арендодатель имеет право:", sub: [
          "проводить осмотр и контроль за целевым использованием Объекта в соответствии с условиями настоящего Договора, но не более 1 раза в месяц, предварительно письменно уведомив Арендатора за 1 (один) рабочий день до проведения осмотра;",
          "контролировать проведение перепланировок или переоборудования Объекта Арендатором, которые могут проводиться только с согласия Арендодателя;",
          "если задержка в уплате арендной платы превышает 3 (три) календарных дня и такая ситуация повторяется более 2 (двух) раз в течение срока действия договора, Арендодатель имеет право ограничить доступ Арендатора и его сотрудников к имуществу и расторгнуть договор.",
        ] },
        { head: "Арендатор обязуется:", sub: [
          "принять Объект по Акту приема-передачи, согласно условиям Договора;",
          "использовать Объект по его целевому назначению в соответствии с условиями Договора;",
          "соблюдать правила пожарной безопасности, при необходимости установить и поддерживать в рабочем состоянии соответствующее оборудование. Аварийные выходы не должны быть заблокированы во время работы. В случае нарушения правил Арендатор оплачивает установленный штраф;",
          "своевременно вносить арендную плату согласно условиям Договора;",
          "в случае порчи Объекта по вине Арендатора возместить причиненный ущерб в соответствии с составленным Сторонами дефектным актом;",
          "в случае необходимости перепланировки или переоборудования Объекта, а также расположенных в нем сетей и коммуникаций, предоставить на рассмотрение Арендодателя схему планируемых изменений для получения его разрешения;",
          "проводить текущий ремонт, перепланировку или переоборудование Объекта с соблюдением технических норм и правил эксплуатации помещений, а также с учетом дизайна Объекта, за счет своих средств;",
          "передать Объект Арендодателю по Акту приема-передачи в том же состоянии, в котором он был передан в аренду, с учетом его нормального износа;",
          "не передавать Объект в субаренду третьему лицу без письменного согласия Арендодателя.",
        ] },
        { head: "Арендатор имеет право:", sub: [
          "использовать Объект в соответствии с условиями настоящего Договора;",
          "после согласия Арендодателя произвести перепланировку или переоборудование Объекта, в том числе расположенных в нем сетей и коммуникаций;",
          "обозначать местонахождение Объекта путем размещения рекламных вывесок, стендов, указательных табличек как внутри помещения Объекта, так и на фасаде его здания;",
          "устанавливать замки на входную дверь Объекта;",
          "устанавливать телефонные линии, интернет, пожарную сигнализацию, системы охраны Объекта и имущества Арендатора и другие системы и коммуникации, необходимые для нормального использования Объекта;",
          "досрочно отказаться от исполнения настоящего Договора в одностороннем внесудебном порядке по своей инициативе, без указания причин, с уведомлением Арендодателя за 1 (один) месяц до даты предстоящего отказа, а в первые три месяца аренды — за 10 (десять) календарных дней до даты расторжения Договора.",
        ] },
      ] },
      { title: "Ответственность Сторон", items: [
        "За невыполнение или ненадлежащее выполнение обязательств по Договору Стороны несут ответственность в соответствии с условиями Договора и действующим законодательством Республики Узбекистан.",
        "В случае задержки оплаты в сроки, предусмотренные п. 2.1 Договора, Арендатор выплачивает пеню в размере 0,1% от неуплаченной суммы за каждый день просрочки, но не более 1% от суммы арендной платы.",
        "В случае неисполнения Арендодателем своих обязательств по Договору Арендодатель выплачивает пеню в размере 0,1% от суммы арендной платы за каждый день неисполнения условий Договора, но не более 1% от суммы арендной платы.",
        "В случае выявления причинения ущерба Объекту по вине Арендатора Арендатор обязан возместить причиненный ущерб в полном объеме.",
        "В случае если ущерб Объекту устраняется Арендодателем, все расходы, понесенные на устранение такого ущерба, подлежат возмещению Арендатором в полном объеме.",
      ] },
      { title: "Порядок приема и передачи объекта аренды", items: [
        "Передача Объекта оформляется Актом приема-передачи (Приложение №1), который является неотъемлемой частью Договора.",
        "Объект должен быть передан не позднее 3 (трех) календарных дней с даты заключения либо расторжения Договора.",
        "Объект считается переданным с даты подписания Сторонами Акта приема-передачи.",
        "После окончания срока действия или прекращения Договора Арендатор обязан вернуть Арендодателю Объект. При возврате помещения составляется Акт возврата (Приложение №2), который подписывается обеими Сторонами.",
        "Если Арендатор допустил ухудшение состояния арендованного имущества или своевременно не возвращает его, он должен возместить Арендодателю понесенные в результате этого убытки.",
      ] },
      { title: "Форс-мажорные обстоятельства", items: [
        "Стороны освобождаются от ответственности за полное либо частичное неисполнение обязательств, а также за задержку в их выполнении по настоящему Договору, если таковые явились следствием обстоятельств непреодолимой силы (форс-мажор), включая, но не ограничиваясь: стихийные бедствия, политические, гражданские, военные конфликты (революция, мятеж, забастовка), решения высших органов власти, террористические акты, эмбарго, наводнения, взрывы, сбои в снабжении электроэнергией, газом.",
      ] },
      { title: "Срок действия и порядок расторжения Договора", items: [
        `Настоящий Договор вступает в силу с даты подписания Сторонами Акта приема-передачи и заключается ${R.end ? `сроком до ${dmy(R.end)} года` : "на неопределенный срок"}. Если после истечения срока договора Арендатор продолжает фактически пользоваться арендованным имуществом и Арендодатель до истечения срока договора не имел возражений на этот счет, то договор считается возобновленным на тот же срок.`,
        "Настоящий Договор может быть расторгнут в одностороннем порядке в соответствии с условиями Договора либо по соглашению Сторон.",
        "По окончании срока аренды Арендатор обязан вернуть Объект в том же состоянии, в каком он был передан, с учетом нормального износа.",
        "Односторонний отказ от исполнения обязательства и одностороннее изменение условий договора, кроме случаев, предусмотренных настоящим Договором, не допускаются.",
        "Арендатор вправе в одностороннем порядке расторгнуть настоящий Договор при условии уплаты суммы в размере трехмесячной арендной платы.",
        "Настоящий Договор может быть расторгнут по требованию одной из Сторон в случае неисполнения или ненадлежащего исполнения другой Стороной условий Договора.",
        { head: "По требованию Арендодателя договор может быть досрочно расторгнут судом в случаях, когда Арендатор:", sub: [
          "пользуется имуществом с существенным нарушением условий договора или назначения имущества либо с неоднократными нарушениями, несмотря на письменное предупреждение Арендодателя;",
          "существенно ухудшает имущество;",
          "более двух раз подряд по истечении установленного договором срока платежа не вносит плату за пользование имуществом.",
        ] },
        "Арендодатель вправе требовать досрочного расторжения договора только после письменного предупреждения Арендатора и предоставления ему возможности исполнения своего обязательства.",
      ] },
      { title: "Прочие условия", items: [
        "Все изменения и дополнения к настоящему Договору должны быть оформлены в виде дополнительного соглашения к нему, подписанного Сторонами.",
        "Ни одна из Сторон не вправе передавать свои права по настоящему Договору третьей стороне без письменного согласия другой Стороны.",
        "В случае досрочного расторжения Договора или окончания срока его действия между Сторонами составляется Акт сверки, в соответствии с которым производятся расчеты.",
        "Взаимоотношения Сторон, не предусмотренные настоящим Договором, регламентируются действующим законодательством Республики Узбекистан.",
        ...(d.note ? [d.note] : []),
        "Настоящий Договор составлен в 2-х экземплярах, по одному экземпляру для каждой из Сторон.",
      ] },
    ],
    act1: `Согласно Договору аренды нежилого помещения № ${d.no} от ${dmy(d.date)} года, АРЕНДОДАТЕЛЬ — ${L.person ? `частное лицо ${L.name}` : L.name}${L.basis ? `, ${L.basis}` : ""}, сдает, а АРЕНДАТОР — ${v(T.name)}${T.rep ? `, ${T.rep}` : ""}, принимает во временное владение и пользование на срок аренды нежилое коммерческое помещение, расположенное по адресу: ${obj} Состояние нежилого помещения на момент сдачи-приемки удовлетворительное.`,
    act1Items: [
      "Арендатор претензий к техническому состоянию, площади и комплектации Объекта не имеет.",
      "Арендатор несет ответственность за сохранность и надлежащее использование указанного оборудования и имущества на весь срок аренды.",
      "В арендуемом помещении имеются следующие предметы и оборудование:",
    ],
    act2: `В связи с истечением срока действия (прекращением) Договора аренды нежилого помещения № ${d.no} от ${dmy(d.date)} года Арендатор — ${v(T.name)} — возвращает, а Арендодатель — ${L.name} — принимает нежилое помещение, расположенное по адресу: ${obj}`,
    act2Items: [
      "Помещение находится в удовлетворительном состоянии с учетом нормального износа.",
      "Водопроводные коммуникации, система отопления, электроснабжения, вентиляции и кондиционирования находятся в исправном состоянии.",
      "Арендодатель не имеет претензий к Арендатору в отношении вышеуказанного Помещения.",
      "Настоящий Акт составлен в двух экземплярах, имеющих одинаковую юридическую силу, один для Арендодателя, второй — для Арендатора.",
    ],
  };
}

/** O'zbekcha (lotin) matn — ruscha shablonning tarjimasi. */
function uz(d: ContractData, basisUz: string): ReturnType<typeof ru> {
  const L = d.lessor, T = d.tenant, R = d.rent, O = d.object;
  const total = R.bank + R.cash;
  const basis = basisUz || L.basis;
  const lessorIntro = L.person
    ? `O'zbekiston Respublikasi fuqarosi, jismoniy shaxs ${L.name}${basis ? ` (${basis})` : ""}, bundan buyon «Ijaraga beruvchi» deb ataladi`
    : `${L.name}${basis ? `, ${basis}` : ""}, bundan buyon «Ijaraga beruvchi» deb ataladi`;
  const tenantIntro = `${v(T.name)}${T.rep ? `, ${T.rep}` : ""}, bundan buyon «Ijarachi» deb ataladi`;
  const obj = `${v(O.address)} (kadastr raqami ${v(O.cadastre)}), umumiy maydoni ${O.area ? fmtNum(O.area, 2) : "___"} kv.m. bo'lgan noturar tijorat binosi`;
  const how = R.bank && R.cash ? `bank orqali ${fmtNum(R.bank)} so'm va naqd ${fmtNum(R.cash)} so'm, jami` : R.cash ? "naqd pulda" : "bank orqali (pul o'tkazish yo'li bilan)";
  const when = R.daily ? "har kuni" : `har oy, joriy oyning ${R.payDay ?? "___"}-sanasidan kechiktirmay`;
  const pay: string[] = [
    `Ijarachi ijara haqini ${how} ${fmtNum(total)} (${cap(numWords(total))}) so'm miqdorida ${when} to'laydi.`,
    "Shartnomaning 2.1-bandida ko'rsatilgan ijara haqi miqdori Ijaraga beruvchi tomonidan uch oyda bir martadan ko'p bo'lmagan holda qayta ko'rib chiqilishi mumkin. Qabul qilingan qaror haqida Ijaraga beruvchi Ijarachini yozma ravishda xabardor qiladi.",
    "Ijarachi ijara haqi miqdorining o'zgarishiga rozi bo'lmasa, ushbu Shartnoma bekor qilinadi.",
    "Ijarachi Tomonlar qabul-topshirish dalolatnomasini imzolaganidan keyin Obyektdan to'liq foydalanish huquqiga ega bo'ladi.",
  ];
  if (L.person && L.taxPercent > 0) {
    pay.push(`Shartnomaning 2.1-bandida ko'rsatilgan ijara haqi summasiga Ijaraga beruvchining daromadidan to'lanadigan ${fmtNum(L.taxPercent, 2)}% miqdoridagi jismoniy shaxslardan olinadigan daromad solig'i kiritilgan. Ushbu soliq Ijarachi tomonidan hisoblanadi va Ijaraga beruvchi soliq hisobida turgan joydagi byudjetga to'lanadi.`);
    pay.push(`Ijara haqi Ijarachi tomonidan Ijaraga beruvchining ${L.card ? "bank kartasiga" : "bank hisob raqamiga"} pul o'tkazish yo'li bilan to'lanadi. Bunda Ijarachi ijara haqidan ${fmtNum(L.taxPercent, 2)}% miqdorida jismoniy shaxslardan olinadigan daromad solig'ini ushlab qoladi va qonunchilikda belgilangan tartibda byudjetga o'tkazadi.`);
  }
  if (R.electricity) pay.push(R.elecFixed > 0
    ? `Elektr energiyasi uchun to'lov Ijarachi tomonidan ijara haqidan alohida, har oy ${fmtNum(R.elecFixed)} (${cap(numWords(R.elecFixed))}) so'm miqdorida yoki hisoblagich ko'rsatkichi bo'yicha Ijaraga beruvchi belgilagan tarifda amalga oshiriladi.`
    : "Elektr energiyasi uchun to'lov Ijarachi tomonidan ijara haqidan alohida, hisoblagich ko'rsatkichi bo'yicha Ijaraga beruvchi belgilagan tarifda amalga oshiriladi.");
  if (R.deposit > 0) pay.push(`Ijarachi ${fmtNum(R.deposit)} (${cap(numWords(R.deposit))}) so'm miqdorida garov (zaklad) to'laydi. Shartnoma tugaganda garov qarzdorlik va zarar summalari ayirilgan holda Ijarachiga qaytariladi.`);
  pay.push(`Shartnoma bo'yicha to'lov ${dmy(R.start)} yildan boshlab amalga oshiriladi.`);

  return {
    title: "Noturar joyni ijaraga berish",
    subtitle: `shartnomasi № ${d.no}`,
    intro: `${lessorIntro}, bir tomondan, va ${tenantIntro}, ikkinchi tomondan, alohida holda Tomon deb atalib, ushbu Shartnomani quyidagilar haqida tuzdilar:`,
    sections: [
      { title: "Shartnoma predmeti", items: [
        `Shartnoma predmeti quyidagi manzilda joylashgan noturar binoning bir qismini ijaraga berishdir: ${obj} (bundan buyon — Obyekt).`,
        "Ijaraga beruvchi Ijarachiga Obyektni ijara haqi evaziga, sotib olish huquqisiz, tadbirkorlik faoliyatini (savdo do'koni) amalga oshirish maqsadida vaqtincha egalik qilish va foydalanish uchun Obyektni qabul-topshirish dalolatnomasi (1-ilova) asosida topshiradi; dalolatnoma Shartnomaning ajralmas qismi hisoblanadi.",
        "Ijarachi Obyektning bir qismini uchinchi shaxsga subijaraga faqat Ijaraga beruvchining yozma roziligi bilan berishi mumkin.",
        "Obyekt Ijarachiga maqsadiga ko'ra foydalanishga yaroqli holatda topshiriladi. Topshirish paytidagi holatini tasdiqlash uchun Tomonlar tomonidan uchta fotosurat tuziladi va imzolanadi; ular Shartnomaga ilova qilinadi va uning ajralmas qismi hisoblanadi.",
      ] },
      { title: "Hisob-kitob tartibi", items: pay },
      { title: "Tomonlarning majburiyatlari va huquqlari", items: [
        { head: "Ijaraga beruvchi quyidagilarga majbur:", sub: [
          "Obyektni Ijarachiga Shartnoma shartlari va Obyekt maqsadiga, uning huquqni belgilovchi va texnik hujjatlariga mos holatda hamda uchinchi shaxslarning da'volaridan xoli holda topshirish;",
          "Ijarachining Obyektdan Shartnoma shartlari asosida to'siqsiz foydalanishini ta'minlash;",
          "Obyektning, jumladan elektr ta'minoti, issiqlik, kanalizatsiya va suv ta'minotining o'z vazifasiga ko'ra bir me'yorda ishlashini ta'minlash.",
        ] },
        { head: "Ijaraga beruvchi quyidagi huquqlarga ega:", sub: [
          "Obyektdan maqsadli foydalanilishini oyiga 1 martadan ko'p bo'lmagan holda, Ijarachini 1 (bir) ish kuni oldin yozma ogohlantirib ko'zdan kechirish va nazorat qilish;",
          "Obyektni Ijarachi tomonidan qayta rejalashtirish yoki qayta jihozlashni nazorat qilish (bu faqat Ijaraga beruvchining roziligi bilan amalga oshiriladi);",
          "ijara haqini to'lash 3 (uch) kalendar kunidan ortiq kechiktirilsa va bu holat shartnoma muddati davomida 2 (ikki) martadan ortiq takrorlansa, Ijaraga beruvchi Ijarachi va uning xodimlarining mol-mulkka kirishini cheklash va shartnomani bekor qilish huquqiga ega.",
        ] },
        { head: "Ijarachi quyidagilarga majbur:", sub: [
          "Obyektni Shartnoma shartlariga muvofiq qabul-topshirish dalolatnomasi bo'yicha qabul qilish;",
          "Obyektdan Shartnoma shartlariga muvofiq o'z maqsadida foydalanish;",
          "yong'in xavfsizligi qoidalariga rioya qilish, zarur bo'lsa tegishli uskunalarni o'rnatish va ishchi holatda saqlash. Ish vaqtida favqulodda chiqish yo'llari to'silmasligi kerak. Qoidalar buzilsa, Ijarachi belgilangan jarimani to'laydi;",
          "ijara haqini Shartnoma shartlariga muvofiq o'z vaqtida to'lash;",
          "Ijarachi aybi bilan Obyekt shikastlansa, Tomonlar tuzgan nuqson dalolatnomasiga muvofiq yetkazilgan zararni qoplash;",
          "Obyektni, shuningdek undagi tarmoq va kommunikatsiyalarni qayta rejalashtirish yoki qayta jihozlash zarur bo'lsa, ruxsat olish uchun rejalashtirilgan o'zgarishlar sxemasini Ijaraga beruvchiga ko'rib chiqish uchun taqdim etish;",
          "joriy ta'mir, qayta rejalashtirish yoki qayta jihozlashni texnik me'yorlar va binolardan foydalanish qoidalariga rioya qilgan holda, Obyekt dizaynini hisobga olib, o'z hisobidan amalga oshirish;",
          "Obyektni Ijaraga beruvchiga qabul-topshirish dalolatnomasi bo'yicha ijaraga berilgan holatida, me'yoriy eskirishni hisobga olgan holda qaytarish;",
          "Obyektni Ijaraga beruvchining yozma roziligisiz uchinchi shaxsga subijaraga bermaslik.",
        ] },
        { head: "Ijarachi quyidagi huquqlarga ega:", sub: [
          "Obyektdan ushbu Shartnoma shartlariga muvofiq foydalanish;",
          "Ijaraga beruvchining roziligi bilan Obyektni, jumladan undagi tarmoq va kommunikatsiyalarni qayta rejalashtirish yoki qayta jihozlash;",
          "Obyekt joylashgan joyni Obyekt binosi ichida ham, bino fasadida ham reklama lavhalari, stendlar, ko'rsatkich taxtachalari joylashtirish orqali belgilash;",
          "Obyektning kirish eshigiga qulf o'rnatish;",
          "telefon liniyalari, internet, yong'in signalizatsiyasi, Obyekt va Ijarachi mol-mulkini qo'riqlash tizimlari hamda Obyektdan me'yorida foydalanish uchun zarur boshqa tizim va kommunikatsiyalarni o'rnatish;",
          "o'z tashabbusi bilan, sababini ko'rsatmasdan, Ijaraga beruvchini 1 (bir) oy oldin, ijaraning dastlabki uch oyida esa 10 (o'n) kalendar kuni oldin ogohlantirib, ushbu Shartnomani bir tomonlama sudsiz tartibda muddatidan oldin bajarishdan bosh tortish.",
        ] },
      ] },
      { title: "Tomonlarning javobgarligi", items: [
        "Shartnoma bo'yicha majburiyatlarni bajarmaganlik yoki lozim darajada bajarmaganlik uchun Tomonlar Shartnoma shartlari va O'zbekiston Respublikasining amaldagi qonunchiligiga muvofiq javob beradi.",
        "Shartnomaning 2.1-bandida nazarda tutilgan muddatda to'lov kechiktirilsa, Ijarachi to'lanmagan summaning har bir kechiktirilgan kun uchun 0,1% miqdorida, lekin ijara haqining 1% idan ko'p bo'lmagan penya to'laydi.",
        "Ijaraga beruvchi Shartnoma bo'yicha o'z majburiyatlarini bajarmasa, Shartnoma shartlari bajarilmagan har bir kun uchun ijara haqining 0,1% miqdorida, lekin ijara haqining 1% idan ko'p bo'lmagan penya to'laydi.",
        "Ijarachi aybi bilan Obyektga zarar yetkazilgani aniqlansa, Ijarachi yetkazilgan zararni to'liq hajmda qoplashi shart.",
        "Agar Obyektga yetkazilgan zarar Ijaraga beruvchi tomonidan bartaraf etilsa, unga sarflangan barcha xarajatlar Ijarachi tomonidan to'liq qoplanadi.",
      ] },
      { title: "Ijara obyektini qabul qilish va topshirish tartibi", items: [
        "Obyektni topshirish Shartnomaning ajralmas qismi bo'lgan qabul-topshirish dalolatnomasi (1-ilova) bilan rasmiylashtiriladi.",
        "Obyekt Shartnoma tuzilgan yoki bekor qilingan kundan boshlab 3 (uch) kalendar kunidan kechiktirmay topshirilishi kerak.",
        "Obyekt Tomonlar qabul-topshirish dalolatnomasini imzolagan kundan boshlab topshirilgan hisoblanadi.",
        "Shartnoma muddati tugaganidan yoki to'xtatilganidan keyin Ijarachi Obyektni Ijaraga beruvchiga qaytarishi shart. Binoni qaytarishda ikkala Tomon imzolaydigan qaytarish dalolatnomasi (2-ilova) tuziladi.",
        "Agar Ijarachi ijaraga olingan mol-mulk holatini yomonlashtirsa yoki uni o'z vaqtida qaytarmasa, buning natijasida Ijaraga beruvchiga yetkazilgan zararni qoplashi kerak.",
      ] },
      { title: "Fors-major holatlar", items: [
        "Tomonlar ushbu Shartnoma bo'yicha majburiyatlarni to'liq yoki qisman bajarmaganlik, shuningdek ularni kechiktirib bajarganlik uchun, agar bu yengib bo'lmaydigan kuch (fors-major) holatlari — jumladan, lekin ular bilan cheklanmagan holda: tabiiy ofatlar, siyosiy, fuqarolik, harbiy mojarolar (inqilob, isyon, ish tashlash), oliy hokimiyat organlari qarorlari, terrorchilik harakatlari, embargo, suv toshqini, portlashlar, elektr energiyasi va gaz ta'minotidagi uzilishlar natijasida yuzaga kelgan bo'lsa, javobgarlikdan ozod qilinadi.",
      ] },
      { title: "Shartnomaning amal qilish muddati va uni bekor qilish tartibi", items: [
        `Ushbu Shartnoma Tomonlar qabul-topshirish dalolatnomasini imzolagan kundan boshlab kuchga kiradi va ${R.end ? `${dmy(R.end)} yilgacha` : "muddatsiz"} tuziladi. Agar shartnoma muddati tugaganidan keyin Ijarachi ijaraga olingan mol-mulkdan amalda foydalanishda davom etsa va Ijaraga beruvchi shartnoma muddati tugaguniga qadar bunga e'tiroz bildirmagan bo'lsa, shartnoma xuddi shu muddatga yangilangan hisoblanadi.`,
        "Ushbu Shartnoma Shartnoma shartlariga muvofiq bir tomonlama tartibda yoki Tomonlarning kelishuvi bilan bekor qilinishi mumkin.",
        "Ijara muddati tugaganda Ijarachi Obyektni me'yoriy eskirishni hisobga olgan holda topshirilgan holatida qaytarishi shart.",
        "Ushbu Shartnomada nazarda tutilgan hollardan tashqari, majburiyatni bajarishdan bir tomonlama bosh tortish va shartnoma shartlarini bir tomonlama o'zgartirishga yo'l qo'yilmaydi.",
        "Ijarachi uch oylik ijara haqi miqdoridagi summani to'lagan holda ushbu Shartnomani bir tomonlama bekor qilishga haqli.",
        "Ushbu Shartnoma Tomonlardan birining talabi bilan, ikkinchi Tomon Shartnoma shartlarini bajarmagan yoki lozim darajada bajarmagan hollarda bekor qilinishi mumkin.",
        { head: "Ijaraga beruvchining talabi bilan shartnoma quyidagi hollarda sud tomonidan muddatidan oldin bekor qilinishi mumkin, agar Ijarachi:", sub: [
          "mol-mulkdan shartnoma shartlarini yoki mol-mulk maqsadini jiddiy buzgan holda yoki Ijaraga beruvchining yozma ogohlantirishiga qaramay qayta-qayta buzgan holda foydalansa;",
          "mol-mulkni jiddiy darajada yomonlashtirsa;",
          "shartnomada belgilangan to'lov muddati o'tgach, mol-mulkdan foydalanganlik uchun haqni ketma-ket ikki martadan ortiq to'lamasa.",
        ] },
        "Ijaraga beruvchi shartnomani muddatidan oldin bekor qilishni faqat Ijarachini yozma ogohlantirib, unga majburiyatini bajarish imkoniyatini berganidan keyin talab qilishga haqli.",
      ] },
      { title: "Boshqa shartlar", items: [
        "Ushbu Shartnomaga kiritiladigan barcha o'zgartish va qo'shimchalar Tomonlar imzolagan qo'shimcha kelishuv shaklida rasmiylashtirilishi kerak.",
        "Tomonlarning hech biri ushbu Shartnoma bo'yicha o'z huquqlarini ikkinchi Tomonning yozma roziligisiz uchinchi tomonga o'tkazishga haqli emas.",
        "Shartnoma muddatidan oldin bekor qilinganda yoki uning amal qilish muddati tugaganda Tomonlar o'rtasida solishtirma dalolatnoma (akt-sverka) tuziladi va unga muvofiq hisob-kitob qilinadi.",
        "Tomonlarning ushbu Shartnomada nazarda tutilmagan munosabatlari O'zbekiston Respublikasining amaldagi qonunchiligi bilan tartibga solinadi.",
        ...(d.note ? [d.note] : []),
        "Ushbu Shartnoma 2 nusxada, har bir Tomon uchun bittadan tuzildi.",
      ] },
    ],
    act1: `${d.no}-sonli ${dmy(d.date)} yildagi noturar joyni ijaraga berish shartnomasiga muvofiq IJARAGA BERUVCHI — ${L.person ? `jismoniy shaxs ${L.name}` : L.name}${basis ? ` (${basis})` : ""} — topshiradi, IJARACHI — ${v(T.name)}${T.rep ? `, ${T.rep}` : ""} — esa ijara muddatiga vaqtincha egalik qilish va foydalanish uchun quyidagi manzilda joylashgan noturar tijorat binosini qabul qiladi: ${obj}. Topshirish-qabul qilish paytida binoning holati qoniqarli.`,
    act1Items: [
      "Ijarachining Obyektning texnik holati, maydoni va jihozlanishiga e'tirozi yo'q.",
      "Ijarachi ijaraning butun muddati davomida ko'rsatilgan uskuna va mol-mulkning saqlanishi va to'g'ri foydalanilishi uchun javob beradi.",
      "Ijaraga olingan binoda quyidagi buyum va uskunalar mavjud:",
    ],
    act2: `${d.no}-sonli ${dmy(d.date)} yildagi noturar joyni ijaraga berish shartnomasining amal qilish muddati tugashi (to'xtatilishi) munosabati bilan Ijarachi — ${v(T.name)} — qaytaradi, Ijaraga beruvchi — ${L.name} — esa quyidagi manzilda joylashgan noturar binoni qabul qiladi: ${obj}.`,
    act2Items: [
      "Bino me'yoriy eskirishni hisobga olgan holda qoniqarli holatda.",
      "Suv quvurlari, isitish, elektr ta'minoti, shamollatish va konditsionerlash tizimlari soz holatda.",
      "Ijaraga beruvchining yuqorida ko'rsatilgan Bino bo'yicha Ijarachiga e'tirozi yo'q.",
      "Ushbu Dalolatnoma bir xil yuridik kuchga ega ikki nusxada tuzildi: biri Ijaraga beruvchi uchun, ikkinchisi Ijarachi uchun.",
    ],
  };
}

const T = {
  ru: { city: "г.", lessor: "Арендодатель", tenant: "Арендатор", req: "Реквизиты и адреса Сторон", bank: "Банк", mfo: "МФО", acc: "Расчетный счет", inn: "ИНН", card: "Пл. карта", phone: "Телефон", addr: "Адрес",
    app1: "Приложение №1", app2: "Приложение №2", toContract: (no: string, d: string) => `к Договору аренды нежилого помещения № ${no} от ${d} года`,
    act1: "АКТ", act1Sub: "приема-передачи нежилого помещения", act2: "АКТ ВОЗВРАТА ПОМЕЩЕНИЯ", act2Sub: "по договору аренды", equip: "Название оборудования и имущества", state: "Состояние",
    sign: "подпись", long: longRu, date: "«___» __________ 20__ года" },
  uz: { city: "", lessor: "Ijaraga beruvchi", tenant: "Ijarachi", req: "Tomonlarning rekvizitlari va manzillari", bank: "Bank", mfo: "MFO", acc: "Hisob raqami", inn: "INN", card: "Plastik karta", phone: "Telefon", addr: "Manzil",
    app1: "1-ilova", app2: "2-ilova", toContract: (no: string, d: string) => `${d} yildagi ${no}-sonli noturar joyni ijaraga berish shartnomasiga`,
    act1: "Noturar joyni", act1Sub: "qabul qilish-topshirish dalolatnomasi", act2: "Binoni qaytarish", act2Sub: "dalolatnomasi", equip: "Uskuna va mol-mulk nomi", state: "Holati",
    sign: "imzo", long: longUz, date: "20__-yil «___» __________" },
};

/** Bitta til nusxasi: shartnoma + 1-ilova (qabul-topshirish) + 2-ilova (qaytarish). Har biri yangi sahifadan. */
export function ContractDoc({ lang, d, basisUz }: { lang: ContractLang; d: ContractData; basisUz: string }) {
  const t = T[lang];
  const x = lang === "ru" ? ru(d) : uz(d, basisUz);
  const L = d.lessor, Tn = d.tenant;
  const p = "mt-1 text-justify";
  const line = (label: string, val: string) => (val ? <div>{label}: {val}</div> : null);
  const signs = (
    <div className="mt-8 grid grid-cols-2 gap-10 text-[12px]">
      <div><div className="font-semibold">{t.lessor}:</div><div>{L.name}</div><div className="mt-8 border-b border-black" /><div className="mt-1 text-slate-600">{t.sign}</div></div>
      <div><div className="font-semibold">{t.tenant}:</div><div>{v(Tn.name)}</div><div className="mt-8 border-b border-black" /><div className="mt-1 text-slate-600">{t.sign}</div></div>
    </div>
  );
  const head = (app: string) => (
    <div className="text-right text-[12px]"><div>{app}</div><div>{t.toContract(d.no, dmy(d.date))}</div></div>
  );
  return (
    <>
      <section className="contract-page">
        <h1 className="text-center text-[15px] font-bold">{x.title}</h1>
        <div className="text-center font-bold">{x.subtitle}</div>
        <div className="mt-3 flex justify-between font-semibold"><span>{t.city} {d.city}</span><span>{t.long(d.date)}</span></div>
        <p className="mt-3 text-justify indent-8">{x.intro}</p>
        {x.sections.map((s, si) => (
          <div key={s.title} className="mt-3">
            <h2 className="text-center font-bold">{si + 1}. {s.title}</h2>
            {s.items.map((it, ii) => typeof it === "string"
              ? <p key={ii} className={p}><b>{si + 1}.{ii + 1}.</b> {it}</p>
              : (
                <div key={ii} className="mt-1">
                  <p className="font-semibold"><b>{si + 1}.{ii + 1}.</b> {it.head}</p>
                  {it.sub.map((sub, k) => <p key={k} className="pl-6 text-justify">— {sub}</p>)}
                </div>
              ))}
          </div>
        ))}
        <h2 className="mt-4 text-center font-bold">{x.sections.length + 1}. {t.req}</h2>
        <div className="mt-2 grid grid-cols-2 gap-8 text-[12px]">
          <div>
            <div className="font-semibold">{t.lessor}</div>
            <div className="font-semibold">{L.name}</div>
            {line(t.addr, L.address)}{line(t.bank, L.bank)}{line(t.mfo, L.mfo)}{line(t.acc, L.account)}{line(t.inn, L.inn)}{line(t.card, L.card)}{line(t.phone, L.phone)}
            <div className="mt-8 border-b border-black" /><div className="mt-1 text-slate-600">{t.sign}{L.person ? "" : lang === "ru" ? ", М.П." : ", M.O'."}</div>
          </div>
          <div>
            <div className="font-semibold">{t.tenant}</div>
            <div className="font-semibold">{v(Tn.name)}</div>
            {line(t.addr, Tn.address)}{line(t.acc, Tn.account)}{line(t.mfo, Tn.mfo)}{line(t.inn, Tn.inn)}{line(t.phone, Tn.phone)}
            <div className="mt-8 border-b border-black" /><div className="mt-1 text-slate-600">{t.sign}{Tn.rep ? ` · ${Tn.rep.replace(/^в лице |^vakili /, "")}` : ""}</div>
          </div>
        </div>
      </section>

      <section className="contract-page">
        {head(t.app1)}
        <h2 className="mt-4 text-center font-bold">{t.act1}</h2>
        <div className="text-center">{t.act1Sub}</div>
        <p className="mt-3 text-justify indent-8">{x.act1}</p>
        {x.act1Items.map((it, i) => <p key={i} className={p}>{i + 1}. {it}</p>)}
        <table className="mt-2 w-full border-collapse text-[12px]">
          <thead><tr><th className="border border-black px-2 py-1 text-left">{t.equip}</th><th className="w-48 border border-black px-2 py-1 text-left">{t.state}</th></tr></thead>
          <tbody>{[0, 1, 2, 3].map((i) => <tr key={i}><td className="h-7 border border-black" /><td className="border border-black" /></tr>)}</tbody>
        </table>
        {signs}
      </section>

      <section className="contract-page">
        {head(t.app2)}
        <h2 className="mt-4 text-center font-bold">{t.act2}</h2>
        <div className="text-center font-bold">{t.act2Sub}</div>
        <div className="mt-2 text-right text-[12px]">{t.date}</div>
        <p className="mt-3 text-justify indent-8">{x.act2}</p>
        {x.act2Items.map((it, i) => <p key={i} className={p}>{i + 1}. {it}</p>)}
        {signs}
      </section>
    </>
  );
}
