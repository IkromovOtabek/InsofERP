import type { CompanySettings, Employee, HrDocument } from "@/generated/prisma";
import { money } from "@/lib/format";
import { docDate, docDateCyr, docDateLat, regionLine, shortName } from "@/lib/hr-docs";

/**
 * Otdel kadr shakllarining matni — qog'ozdagi blankalar bilan bir xil.
 * Har bir hujjat o'z asl tilida (ariza, buyruq, shartnoma — kirill; anketa, tilxat,
 * moddiy javobgarlik — lotin), chunki korxona shu ko'rinishda yuritadi.
 *
 * Matn o'zgarmas; tizim faqat bo'sh joylarni to'ldiradi. To'ldirilmagan maydon
 * qo'lda yozish uchun chiziq bo'lib chiqadi.
 */
export type DocProps = {
  e: Employee;
  c: CompanySettings;
  /** Tayyorlangan hujjat yozuvi — bo'lmasa bo'sh blanka chiqadi. */
  d: HrDocument | null;
};

/* ───────── Kichik yordamchilar ───────── */

/** To'ldiriladigan joy: qiymat bo'lsa chiziq ustida, bo'lmasa bo'sh chiziq. */
function F({ v, w = 200, center = true }: { v?: string | null; w?: number; center?: boolean }) {
  return (
    <span
      className="inline-block border-b border-black px-1 align-baseline"
      style={{ minWidth: w, textAlign: center ? "center" : "left" }}
    >
      {v || " "}
    </span>
  );
}

/** Imzo joyi: tagida nima ekanligi yozilgan chiziq. */
function Sign({ label, value, w = 220 }: { label: string; value?: string | null; w?: number }) {
  return (
    <span className="inline-block align-top" style={{ width: w }}>
      <span className="block border-b border-black pb-0.5 text-center">{value || " "}</span>
      <span className="mt-0.5 block text-center text-[10px]">{label}</span>
    </span>
  );
}

/**
 * Bitta A4 varaq. Chop etishda har biri alohida sahifaga tushadi — oxirgisidan keyin
 * bo'sh sahifa chiqmasligi uchun uzilish `doc-sheet:last-of-type` da bekor qilinadi
 * (qoida chop etish sahifasining `<style>` ida).
 */
export function Sheet({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <section
      className={`doc-sheet${last ? " doc-last" : ""} paper mx-auto mb-6 w-full max-w-[210mm] rounded-sm bg-white px-[18mm] py-[16mm] text-[12.5px] leading-[1.45] text-black shadow-sm print:mb-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none`}
    >
      {children}
    </section>
  );
}

const P = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <p className={`mt-2 text-justify indent-6 ${className}`}>{children}</p>
);

/** Chiziqcha bilan boshlanadigan band ro'yxati. */
const Dashes = ({ items }: { items: string[] }) => (
  <ul className="mt-1 space-y-1">
    {items.map((t, i) => (
      <li key={i} className="pl-4 text-justify -indent-4">– {t}</li>
    ))}
  </ul>
);

/* ───────── 1. Ariza (ishga qabul qilish) ───────── */

export function Ariza({ e, c, d }: DocProps) {
  return (
    <Sheet>
      <div className="ml-[45%]">
        <div>{regionLine(c.address)}</div>
        <div className="mt-2">“{c.legalName || c.name}” Директори: {shortName(c.directorName)} га</div>
        <div className="mt-2">Фукаро <F v={e.fullName} w={260} /> дан</div>
      </div>

      <h1 className="mt-10 text-center text-base font-bold">Ариза</h1>

      <p className="mt-8 text-justify indent-8">
        Аризамни мазмуни шундан иборатки Мени <F v={docDate(d?.effectiveAt)} w={140} /> йилдан
        “{c.legalName || c.name}” га <F v={d?.position ?? e.position} w={250} /> лавозимига ишга кабул килишингизни сурайман.
      </p>

      <div className="mt-20 flex items-start justify-between">
        <Sign label="(сана)" value={docDate(d?.docDate)} w={160} />
        <Sign label="(имзо)" w={150} />
        <Sign label="(ф.и.ш)" value={e.fullName} w={240} />
      </div>
    </Sheet>
  );
}

/* ───────── 2. Insof anketasi (shaxsiy varaqa) ───────── */

export function Anketa({ e, c, d }: DocProps) {
  const rows: [string, string | null][] = [
    ["1. F.I.SH.", e.fullName],
    ["2. Tug'ilgan yili", e.birthDate ? docDate(e.birthDate) : null],
    ["3. Tug'ilgan joyi", null],
    ["4. Millati", null],
    ["5. Ma'lumoti", e.education],
    ["A) ta'lim muassasasining nomi va bitirgan yili", null],
    ["6. Diplom bo'yicha mutaxassisligi", null],
    ["7. Oilaviy ahvoli", e.maritalStatus],
    ["8. Pasport seriyasi", [e.passportSeries, e.passportIssuedAt ? docDate(e.passportIssuedAt) : null].filter(Boolean).join("  ") || null],
    ["9. Kim tomonidan berilgan", e.passportIssuedBy],
    ["10. Manzili", e.address],
    ["11. Telefon", e.phone],
  ];

  return (
    <Sheet>
      <h1 className="text-center text-3xl font-bold">“{c.legalName || c.name}”</h1>
      <div className="mt-5 text-[13px] font-semibold">
        Shaxsiy varaqa №<F v={d?.no ?? e.tabelNo} w={80} />
      </div>
      <h2 className="mt-3 text-center text-[13px] font-bold">SHAXSIY VARAQA UMUMIY MA`LUMOT.</h2>

      <div className="mt-5 space-y-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-end gap-2">
            <span className="shrink-0">{k}</span>
            <span className="flex-1 border-b border-black pb-0.5 pl-2">{v || " "}</span>
          </div>
        ))}
        {/* Qo'lda davom ettirish uchun bo'sh qatorlar */}
        {[0, 1].map((i) => <div key={i} className="h-5 border-b border-black" />)}
        <div className="flex items-end gap-2">
          <span className="shrink-0">12. Imzo</span>
          <span className="flex-1 border-b border-black pb-0.5" />
        </div>
      </div>

      <div className="mt-10 flex items-start justify-between">
        <Sign label="(to'ldirilgan sana)" value={docDate(d?.docDate)} w={180} />
        <Sign label="Otdel kadr (imzo)" w={200} />
      </div>
    </Sheet>
  );
}

/* ───────── 3. Mehnat shartnomasi ───────── */

export function Shartnoma({ e, c, d }: DocProps) {
  const boss = c.legalName || c.name;
  const start = d?.effectiveAt ?? e.hiredAt ?? null;

  return (
    <>
      <Sheet>
        <h1 className="text-center text-base font-bold">МЕҲНАТ ШАРТНОМАСИ. <F v={d?.no} w={110} /></h1>

        <div className="mt-6 flex items-end justify-between">
          <span>{regionLine(c.address)}.</span>
          <span>{docDateCyr(d?.docDate)}</span>
        </div>

        <P>
          “{boss}” (кейинги ўринларда “ИШ БЕРУВЧИ”, “КОРХОНА”) номидан корхона рахбари{" "}
          {shortName(c.directorName)} бир тарафдан <F v={e.fullName} w={280} /> иккинчи
          ўринларда “ХОДИМ”, билан қуйидаги шартлар асосида ушбу Меҳнат шартномасини
          (кейинги ўринларда “ШАРТНОМА”) тузилади:
        </P>

        <h2 className="mt-4 text-center font-bold">1. ШАРТНОМАСИНИНГ ПРЕДМЕТИ</h2>
        <P>
          <b>1.1.</b> ХОДИМ <F v={d?.position ?? e.position} w={230} /> лавозимига <F v="1" w={40} /> ставка ишга қабул қилинади.
        </P>
        <P><b>1.2.</b> ХОДИМ “{boss}” корхонасида иш жойи сифатида фаолият юритади.</P>
        <P><b>1.3.</b> ХОДИМ ушбу ШАРТНОМАда ва мансаб йўриқномасида белгиланган мажбуриятларни бажаради ва вазифаларини амалга оширади.</P>
        <P>
          <b>1.4.</b> ХОДИМ ШАРТНОМАда белгиланган мажбуриятларни бажаришга тўсқинлик қиладиган
          асослар (тиббий-меҳнат экспертизасининг ишга лаёқатсизлиги тўғрисидаги ёки бошқалар)
          мавжуд эмаслигини кафолатлайди. Меҳнат вазифаларини бажаришни чекловчи асослар мавжуд
          бўлганда, ушбу холат ХОДИМ томонидан тегишли хужжатлар асосида тасдиқланиши лозим.
        </P>
        <P>
          <b>1.5.</b> ХОДИМ лавозим йўриқномасида кўрсатилган мажбуриятлар ва ишларни бажаради, ички
          меҳнат тақсимоти, меҳнатни муҳофаза қилиш, техника хавфсизлиги, ёнғин хавфсизлиги
          қоидалари, ички меҳнат тартиби қоидалари ва бошқа ички хужжатларга сўзсиз амал қилади
          ҳамда улар билан тўлиқ танишганлигини тасдиқлайди.
        </P>

        <h2 className="mt-4 text-center font-bold">2. ШАРТНОМАНИНГ АМАЛ ҚИЛИШ МУДДАТИ</h2>
        <P>
          <b>2.1.</b> ХОДИМ ўз вазифасини бажаришга <F v={start ? docDate(start) : null} w={150} /> дан киришиши лозим.
        </P>
        <P>
          <b>2.2.</b> Меҳнат шартномаси{" "}
          <span className={d?.fixedTerm ? "font-bold underline" : ""}>муддатли</span>
          {" / "}
          <span className={d && !d.fixedTerm ? "font-bold underline" : ""}>муддатсиз</span>.
          {d?.fixedTerm && d.termUntil ? <> (<F v={docDate(d.termUntil)} w={120} /> гача)</> : null}
          {" "}(тагига чизилади.)
        </P>

        <h2 className="mt-4 text-center font-bold">3. ХОДИМНИНГ ХУҚУҚ ВА МАЖБУРИЯТЛАРИ</h2>
        <P><b>3.1.</b> ХОДИМ қуйидаги ҳуқуқларга эга:</P>
        <Dashes items={[
          "ШАРТНОМАда белгиланган вазифаларни бажарганлиги учун штат жадвалида белгиланган иш ҳақини олиш;",
          "ШАРТНОМАда белгиланган вазифаларни амалга ошириш билан боғлиқ рационализаторлик таклифларини киритиш;",
          "меҳнат фаолиятини амалга ошириш учун зарур бўладиган техника ва асбоб-ускуналардан фойдаланиш;",
          "ИШ БЕРУВЧИдан ШАРТНОМА шартларини бажаришни талаб қилиш.",
        ]} />
        <P><b>3.2.</b> ХОДИМ қуйидаги мажбуриятларга эга:</P>
        <Dashes items={[
          "ШАРТНОМАда белгиланган шартларини тўлиқ бажариш;",
          "ШАРТНОМА шартларига кўра бириктирилаётган техника ва асбоб-ускуналардан тўғри ва ўз мақсадига кўра фойдаланиш;",
          "ўз фаолиятини амалга ошириш жараёнида аён бўлган махфий (конфиденциал) маълумотларни сир сақлаш. Бундай маълумотларга ИШ БЕРУВЧИнинг ҳамкорлари, молиявий аҳволи, савдо режалари, ойлик суммалари, ташкилот харажатлари, ишчилар таркиби, қўриқлаш тизими ҳақидаги, шунингдек бегона шахслар томонидан фойдаланилиши ИШ БЕРУВЧИ ҳамда унинг ишчилари, ҳамкорлари ва мижозларининг манфаатларига зарар етказиши мумкин бўлган бошқа маълумотлар киради;",
          "ИШ БЕРУВЧИнинг розилигисиз бошқа корхона ва ташкилотларда бирор бир вазифа ёки мансабни эгалламаслик;",
          "ШАРТНОМА муддати тугагандан кейин КОРХОНА фаолиятига ва унинг манфаатларига тегишли бўлган барча хужжатлар, жумладан, хат, чизмалар, белгилар, китоблар ва бошқалар, шу билан бирга, иш режалари, асбоб-ускуналар ва материалларни қўшимча талабларсиз КОРХОНАга қайтариш лозим. Юқорида таъкидланган ҳужжат ва ашёларни ходим ўзида қолдириши ШАРТНОМАда назарда тутилмаган;",
          "Ходимга ишониб топширилган маҳсулотларга оид хизмат (сақлаш, сотиш, ташиш, қайта ишлаш) билан бевосита боғлиқ моддий қимматликларнинг бутунлигини таъминлаш тўлиқ моддий жавобгарликни ўз зиммасига олади.",
        ]} />
      </Sheet>

      <Sheet>
        <h2 className="text-center font-bold">4. ИШ БЕРУВЧИНИНГ ҲУҚУҚ ВА МАЖБУРИЯТЛАРИ</h2>
        <P><b>4.1.</b> ИШ БЕРУВЧИ қуйидаги ҳуқуқларга эга:</P>
        <Dashes items={[
          "ХОДИМ томонидан шартнома шартлари, меҳнат муносабатларини тартибга солувчи ички меҳнат тақсимоти қоидалари бузилганда, унинг фаолияти даврида ташкилот моддий бойликларини, яъни ходимга иш давомида фойдаланиш учун ташкилот томонидан тақдим қилинган материаллар, техникалар ва сотиш учун мўлжалланган барча турдаги маҳсулотларни ўғирлаш холатлари аниқланган тақдирда ШАРТНОМАга мувофиқ, ШАРТНОМАда назарда тутилмаган бўлса, Ўзбекистон Республикаси Меҳнат кодексига мувофиқ ходимга нисбатан интизомий ёки моддий жавобгарлик чораларини қўллаш;",
          "ХОДИМдан шартнома шартларини бажаришни талаб қилиш.",
        ]} />
        <P><b>4.2.</b> ИШ БЕРУВЧИ қуйидаги мажбуриятларга эга:</P>
        <Dashes items={[
          "хавфсиз меҳнат шароитларини яратиб бериш;",
          "техника хавфсизлиги ва ёнғин хавфсизлиги бўйича инструктаж ўтказиш;",
          "техника хавфсизлиги бўйича инструктаж ўтмаган ва/ёки тегишли рухсатномага (допуск) ҳамда малакага эга бўлмаган ХОДИМни корхона ҳудудига қўймаслик;",
          "ШАРТНОМА шартлари ва талабларини тўлиқ бажариш;",
          "ХОДИМни ШАРТНОМА шартларини бажариш билан боғлиқ тадбирлар тўғрисида хабардор қилиш;",
          "ХОДИМ ва ташкилотларнинг илтимосига кўра, ХОДИМнинг ШАРТНОМАни бажаришга доир ишларига баҳо бериш;",
          "ХОДИМнинг ШАРТНОМАда назарда тутилган ишларни амалга оширилишининг муддати, сифати ва миқдорини назорат қилиш;",
          "ШАРТНОМА шартларини бажаришга таъсир этувчи холатлар тўғрисида ХОДИМни дарҳол хабардор қилиш;",
          "ХОДИМ малакасини оширишни таъминлаш;",
          "ХОДИМни ўз вазифаларини бажариши учун лозим бўладиган инструктив хужжатлар, маълумотлар, адабиётлар билан таъминлаш;",
          "ХОДИМга ҳар ойда иш ҳақи тўлаш;",
          "ХОДИМга йиллик меҳнат таътили бериш;",
          "қонунчиликда назарда тутилган тегишли фондларга ижтимоий суғурта ва пенсия таъминоти учун бадаллар тўлаб бориш.",
        ]} />

        <h2 className="mt-4 text-center font-bold">5. МЕҲНАТГА ҲАҚ ТЎЛАШ</h2>
        <P>
          <b>5.1.</b> ХОДИМга штатлар жадвалига мувофиқ ойлик иш маоши белгиланади
          {d?.salary ? <> — <F v={money(d.salary)} w={170} /></> : null}. Бунда ойлик иш ҳақи миқдори
          ХОДИМ билан келишув натижасида, ИШ БЕРУВЧИнинг молиявий ҳолатига, Ўзбекистон Республикаси
          Президенти ва Ҳукуматининг қарорларига кўра ўзгартирилиши мумкин.
        </P>
        <P>
          <b>5.2.</b> Иш ҳақи миқдорини ошириш ИШ БЕРУВЧИнинг ихтиёрига кўра амалга оширилади. Иш ҳақи
          миқдорини камайиш томонига ўзгартириш ХОДИМни бу хақда 1 ой олдин хабардор қилган ҳолда амалга оширилади.
        </P>
        <P>
          <b>5.3.</b> Рағбатлантириш, ХОДИМ учун жарима тўловлари ва компенсация тўловлари меҳнат
          қонунчилигига мувофиқ амалга оширилади. Бунда, ХОДИМни рағбатлантириш муддати, миқдори ва бу
          тўғрисида қарор чиқариш ИШ БЕРУВЧИнинг мутлақ хуқуқи ҳисобланади.
        </P>

        <h2 className="mt-4 text-center font-bold">6. ИШ ВАҚТИ ВА МЕҲНАТ ШАРОИТЛАРИ</h2>
        <P>
          <b>6.1.</b> ХОДИМга 6/1 иш ҳафталик тартибда иш соати кунлик 8 соатдан кўп бўлмаган/сменали,
          дам олиш куни/кунлари ва танаффус вақти тақдим этиладиган иш ҳафтаси ўрнатилади.
        </P>
        <P>
          <b>6.2.</b> Кунлик иш вақтининг бошланиши ва тугаш вақти (Иш вақти жадвали), ҳамда танаффус
          вақти локал хужжатлар томонидан белгиланади.
        </P>
        <P>
          <b>6.3.</b> Байрам (дам олиш кунлари) арафасидаги кунларда иш вақти барча ишчилар учун камида
          бир соатга қисқартирилади.
        </P>
        <P>
          <b>6.4.</b> ИШ БЕРУВЧИ ХОДИМ билан келишилган холда иш вақти режимига ўзгартириш киритиши
          мумкин. Иш вақтидан ташқари, дам олиш ва байрам кунларида ХОДИМни ишга жалб қилиш ХОДИМнинг
          розилигига кўра амалга оширилади. Бунда ушбу кунлар учун алоҳида таърифлар бўйича иш ҳақи
          тўланади ёки бошқа кунларда дам олиш (отгул) бериш орқали компенсация қилинади.
        </P>

        <h2 className="mt-4 text-center font-bold">7. МЕҲНАТ ТАЪТИЛЛАРИ</h2>
        <P><b>7.1.</b> ИШ БЕРУВЧИ ХОДИМга йиллик меҳнат таътилини қуйидаги тартибда:</P>
        <Dashes items={["Асосий меҳнат таътили – 21 иш куни;"]} />
        <p className="mt-1 pl-4 -indent-4">– Қўшимча меҳнат таътили – <F w={110} /> иш куни миқдорида беради.</p>
        <P>
          <b>7.2.</b> Меҳнат таътиллари КОРХОНАда белгиланган меҳнат таътили бериш жадвалига асосан
          берилади ёки томонларнинг келишувига мувофиқ йилнинг бошқа қулай вақтида берилади.
        </P>
        <P>
          <b>7.3.</b> ХОДИМнинг аризаси асосида иш ҳақи сақланмаган ҳолда меҳнат таътили берилиши
          мумкин, меҳнат таътилининг муддати ИШ БЕРУВЧИ ва ХОДИМ ўртасидаги ўзаро келишувга кўра ҳамда
          ИШ БЕРУВЧИ томонидан белгиланади.
        </P>
      </Sheet>

      <Sheet>
        <h2 className="text-center font-bold">8. МЕҲНАТ ШАРТНОМАСИНИ БЕКОР ҚИЛИШ ТАРТИБИ</h2>
        <P>
          <b>8.1.</b> ШАРТНОМА Ўзбекистон Республикаси Меҳнат кодексининг тегишли моддаларида назарда
          тутилган асосларга кўра бекор қилиниши мумкин.
        </P>
        <P>
          <b>8.2.</b> Ўзбекистон Республикаси Меҳнат кодексининг 161-моддаси иккинчи қисмининг
          5-бандига мувофиқ шартнома ХОДИМ томонидан ўзининг меҳнат мажбуриятларини бир марта қўпол
          равишда бузган ҳолларда ҳам бекор қилиниши мумкин.
        </P>
        <P>Бир марта бузганлик учун меҳнат шартномасини бекор қилиш мумкин бўлган қўпол бузишларга қуйидагилар киритилади:</P>
        <Dashes items={[
          "ижро интизомини бузиш (Ўзбекистон Республикаси Президентининг Фармонлари, фармойишлари ва топшириқларида, Ўзбекистон Республикаси ҳукуматининг қарорлари ва фармойишларида, юқори орган, ҳокимлик ва иш берувчининг қарорларида қўйилган вазифаларни амалга оширишни ўз вақтида ва тўлиқ ҳажмда таъминламаганлик);",
          "ишга узрсиз сабаблар билан чиқмаслик (ишда узрсиз сабаблар билан узлуксиз ёки иш куни мобайнида иш вақти-вақти билан жами 10 соатдан кўпроқ бўлмаганлик);",
          "ишга алкоголли ичимликлар, гиёҳвандлик ёки заҳарвандлик воситаларини истеъмол қилиб келиш, буни гувоҳларнинг кўрсатмалари ёки тиббий хулоса тасдиқлаган бўлса;",
          "иш жойида жамиятнинг мол-мулкини ўғирлашни содир этиш;",
          "жамият ходимларининг, шу жумладан, тартиббузарнинг ҳам ҳаёти ёки соғлиғига хавф туғдирадиган тарзда хавфсизлик техникасини, ишлаб чиқариш технологиясини қўпол равишда бузиш;",
          "ходим томонидан меҳнат мажбуриятлари бузилиб, Ўзбекистон Республикасида белгиланган энг кам иш ҳақининг 10 баравар ҳажмида моддий зарар етказилиши;",
          "махфийлиги меҳнат шартномасида шарт қилиб қўйилган тижорат сирининг ходим томонидан ошкор қилиниши;",
          "бевосита пул ёки товар бойликларига хизмат кўрсатадиган ходим томонидан айбли хатти-ҳаракатлар содир этилиши, агар бу ҳатти-ҳаракатлар иш берувчи томонидан унга нисбатан ишончнинг йўқолиши учун асос бўлса;",
          "Жамиятнинг мижозлари билан нотўғри ва ноқонуний алоқаларга киришиш, коррупцияга қарши қонунлар талабларига жавоб бериш;",
        ]} />
        <P>
          <b>8.3.</b> Меҳнат шартномаси ходимнинг ташаббуси билан ҳам бекор қилиниши мумкин. Бунда,
          ўзининг меҳнат шартномасини бекор қилиш тўғрисидаги нияти хусусида ходим тегишли аризани
          кадрлар бўлимига (иш берувчи томонидан белгиланган бошқа бўлим ёки шахсга) топшириш йўли
          билан иш берувчини ёзма равишда огоҳлантиришга мажбурдир 14 иш куни олдин.
        </P>

        <h2 className="mt-4 text-center font-bold">9. ТОМОНЛАРНИНГ ЖАВОБГАРЛИГИ</h2>
        <p className="mt-2 font-bold">ИШ БЕРУВЧИнинг жавобгарлиги:</p>
        <P>
          <b>9.1.</b> ИШ БЕРУВЧИ, ХОДИМнинг юқори даражадаги хавфли манба билан боғлиқ меҳнат
          мажбуриятларини бажариши оқибатида унинг соғлигига етказилган зарарни қоплаб беради, агарда
          ИШ БЕРУВЧИ мазкур холатлар ушбу ШАРТНОМАнинг 9.4-бандида келтирилган холларда вужудга
          келганлигини исботлай олмаса.
        </P>
        <P>
          <b>9.2.</b> ИШ БЕРУВЧИ ХОДИМнинг соғлигига етказилган зарарни иш берувчининг фуқаролик
          жавобгарлигини мажбурий суғурталаш ҳисобига қоплаб беради.
        </P>
        <P>
          <b>9.3.</b> Соғлиққа етказилган зарар оқибатида меҳнат қобилиятини йўқотганлик даражаси
          тиббий-меҳнат экспертиза комиссияси хулосасига асосан аниқланади.
        </P>
        <P>
          <b>9.4.</b> Қуйидаги ҳолатларда юқори даражадаги хавфли манба билан боғлиқ меҳнат
          мажбуриятларини амалга ошириш жараёнида ХОДИМнинг соғлигига етказилган зарар ИШ БЕРУВЧИ
          томонидан қопланмайди:
        </P>
        <Dashes items={[
          "ХОДИМнинг соғлигига иш вақтидан ташқари пайтда зарар етганда;",
          "ХОДИМнинг соғлигига етказилган зарар иш вақти давомида, аммо ўз хизмат мажбуриятларини бажариш билан боғлиқ бўлмаган ҳолатларда етказилганда;",
          "ХОДИМнинг соғлигига етказилган зарар унинг юқори даражали хавфли манбани ўзбошимчалик ва/ёки ноқонуний эгаллаб олиш ҳолатларида юзага келганда;",
          "ХОДИМнинг соғлигига етказилган зарар унинг қўпол эҳтиётсизлиги оқибатида, яъни оддий ва аниқ кўриниб турган техника хавфсизлиги қоидаларига амал қилинмаганлиги оқибатида вужудга келган бўлса;",
          "ХОДИМнинг техника хавфсизлиги қоидаларига амал қилмаган ҳолатларда;",
          "ХОДИМнинг соғлигига етказилган зарар зарурий мудофаа ва/ёки охирги зарурятни талаб этувчи вазиятларда юзага келган бўлса;",
          "ХОДИМнинг соғлигига етказилган зарар ХОДИМ томонидан жиноий ҳаракатларни содир этиш оқибатида юзага келган бўлса;",
          "ХОДИМнинг соғлигига етказилган зарар енгиб бўлмас куч (ёнғин, ер қимирлаши, тўфон ва бошқ.) таъсирида юзага келган бўлса;",
          "ХОДИМ томонидан ўзига қасддан тан жароҳати етказиш ҳолатларида юзага келган бўлса.",
        ]} />
        <p className="mt-2 font-bold">ХОДИМнинг жавобгарлиги:</p>
        <P><b>9.5.</b> ХОДИМ ИШ БЕРУВЧИга бевосита етказилган ҳақиқий зарарни тўлаши шарт.</P>
        <P>
          Бевосита етказилган ҳақиқий зарар деганда ИШ БЕРУВЧИнинг мавжуд мол-мулки (шу жумладан иш
          берувчи учинчи шахслардан ижарага олган мол-мулк) амалда камайганлиги ёки ёмон холатга
          келганлиги, шунингдек иш берувчининг ортиқча тўловлар қилиш зарурияти тушунилади.
        </P>
        <P>
          <b>9.6.</b> ХОДИМ етказилган зарар учун ўзининг ўртача ойлик иш ҳақи миқдори доирасида моддий жавобгар бўлади.
        </P>
        <P><b>9.7.</b> ХОДИМ қуйидаги ҳолатларда бевосита етказилган зарарни тўлиқ миқдорида қоплашга жавобгар бўлади:</P>
        <Dashes items={[
          "махсус ёзма шартнома асосида унга ишониб топширилган қимматликларнинг сақланишини таъминламаганлик учун;",
          "бир галлик ҳужжат асосида олинган қимматликларнинг сақланишини таъминламаганлик учун;",
          "қасддан зарар етказилганда;",
          "алкогол ичимликдан, гиёҳвандлик ёки токсик модда таъсиридан мастлик холатида зарар етказилганда;",
          "ХОДИМнинг суд ҳукми билан аниқланган жиноий ҳаракатлари натижасида зарар етказилганда;",
          "тижорат сирлари ошкор этилганда.",
        ]} />
      </Sheet>

      <Sheet last>
        <h2 className="text-center font-bold">10. БОШҚА ШАРТЛАР</h2>
        <P>
          <b>10.1.</b> ИШ БЕРУВЧИ амалдаги қонунчиликка мувофиқ ХОДИМни ишлаб чиқаришдаги бахтсиз
          ходисалар ва касб касалликларидан мажбурий давлат ижтимоий суғуртасини амалга оширади.
        </P>
        <P>
          <b>10.2.</b> ХОДИМ Ўзбекистон Республикаси қонунчилигига мувофиқ меҳнат шартномаси
          тугатилгандан кейин ушбу ШАРТНОМАга асосан меҳнат мажбуриятларини амалга ошириш муносабати
          билан маълум бўлган, қонун билан қўриқланадиган тижорат, хизмат ва бошқа сирларни ошкор
          этмаслик мажбуриятини олади.
        </P>
        <P><b>10.3.</b> Мазкур шартнома шартлари ТОМОНлар учун мажбурий аҳамиятга эга.</P>
        <P><b>10.4.</b> ШАРТНОМА тарафлар томонидан имзоланган кундан қонуний кучга киради.</P>
        <P><b>10.5.</b> ШАРТНОМАга ўзгартириш ёки қўшимчалар киритиш тарафларнинг ёзма розилиги асосида амалга оширилади.</P>
        <P>
          <b>10.6.</b> ТАШКИЛОТ ходим томонидан топширилган шахсий хужжатларини сақлаш, ишга тааллуқли
          бўлган барча фаолиятларда фойдаланиш ҳуқуқига эгадир.
        </P>
        <P><b>10.7.</b> Ушбу ШАРТНОМАда назарда тутилмаган холатлар Ўзбекистон Республикаси қонунчилиги билан тартибга солинади.</P>
        <P>
          <b>10.9.</b> ШАРТНОМА бир хил юридик кучга эга бўлган иккита нусхада тузилди ва сақлаш учун
          тарафларга бир нусхадан берилди.
        </P>

        <h2 className="mt-6 text-center font-bold">11. ТАРАФЛАРНИНГ МАНЗИЛИ ВА РЕВИЗИТЛАРИ</h2>

        <div className="mt-6 grid grid-cols-2 gap-10">
          <div>
            <div className="text-center font-bold">ИШ БЕРУВЧИ</div>
            <div className="mt-4 text-center font-bold">“{c.legalName || c.name}”</div>
            <div className="mt-4 space-y-1">
              {c.address && <div>Manzil: {c.address}</div>}
              {c.inn && <div>ИНН: {c.inn}</div>}
              {c.bankAccount && <div>Ҳисоб рақами: {c.bankAccount}</div>}
              {c.bankName && <div>Банк: {c.bankName}</div>}
              {c.mfo && <div>МФО: {c.mfo}</div>}
              {c.phone && <div>Тел: {c.phone}</div>}
            </div>
            <div className="mt-10">
              <div className="font-bold">{shortName(c.directorName)} <span className="inline-block w-40 border-b border-black" /></div>
              <div className="mt-1 text-center text-[10px]">(имзо, мухр)</div>
            </div>
          </div>

          <div>
            <div className="text-center font-bold">ХОДИМ</div>
            <div className="mt-4 space-y-5">
              <Sign label="F.I.SH." value={e.fullName} w={260} />
              <Sign label="Pasport yoki ID-karta ma'lumotlari." value={e.passportSeries} w={260} />
              <Sign label="Manzil." value={e.address} w={260} />
              <Sign label="telefon" value={e.phone ? `+998 ${e.phone.replace(/^\+?998/, "")}` : "+998"} w={260} />
              <Sign label="Imzo:" w={260} />
            </div>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/* ───────── 4. Tilxat ───────── */

const TILXAT_BANDLAR = [
  "Menga belgilangan vazifalarni sidqi dildan va to`liq bajarish.",
  "Korxona ichki tartib qoidalariga rioya qilish;",
  "Korxona ichki sir-sinoatlarini sir saqlash;",
  "Korxona mulkini asrab avaylash;",
  "Ish boshlashdan, smena qabul qilishdan avval asbob uskunalarni ko`rikdan o`tkazish va soz holda qabul qilib olish.",
  "Ish tugagandan so`ng smena topshirishdan avval asbob uskunalarni ko`rikdan o`tkazish va soz holda topshirish.",
  "Korxonadan o`zboshimchalik bilan korxonaga tegishli bo`lgan mulklarni korxona xududidan olib chiqmaslik;",
  "Korxona xududidan mumkin bo`lmagan joylarda yurmaslik, telefon ishlatmaslik, spirtli ichimliklarni istemol qilmaslik va chekmaslik;",
  "Korxonada ish vaqtida texnik havfsizlikka rioya qilish va sochini yeg`ib yurish (qizlarga tegishli);",
  "Ishga o`z vaqtida kelib ketish, ish vaqtida bajarayotgan ishiga layoqatsizlik qilmaslik, ish vaqtida uxlamaslik.",
  "Menga tanishtirilgan texnik xafsizligi va yong`in xafsizligi yo`riqnomalarga rioya qilish;",
  "Ish joyimda o`tkazilgan barcha yo`riqnomalarga amal qilish;",
  "Korxonada menga aloqadorligi bo`lmagan ishni bajarmaslik;",
  "Korxonada ishga to`g`ridan to`g`ri aloqasi bo`lmagan elektr jixozlarini ishlatmaslik (Choynak, kipyatilnik, blok pitaniya va x.k);",
  "Raxbariyatning ko`rsatma va buyruqlariga o`z vaqtida amal qilish va ularni bajarish;",
  "Ish vaqtida ish joyini tozaligini ta`minlash;",
  "Ish vaqtida ishlab turgan dastgohlarga qo`l tekkazmaslik va aylanib turuvchi uskunalar bilan ishlashda extiyotkorlik choralariga rioya qilgan holda bajarish;",
  "Ish vaqtida texnika va yong`in hafsizligi qoidalariga rioya qilish;",
  "Ish tugagandan so`ng barcha o`chirilishi lozim bo`lgan dastgohlarni o`chirishga, hamda ish joyimni ozoda va toza qoldirishga axamiyatli bo`lishlik;",
  "Ish vaqtida etiborsizlik yani uxlab qolish va boshqa xatolar natijasida ishlab chaqarilayotgan mol mulkka zarar etkazilsa ish xaqidan ushlab qolinishiga, agarda bu hol uch marotaba takrorlansa mexnat shartnomasi bekor qilinishiga qarshilik bildirmayman.",
  "Korxonaga tegishli bo`lgan mol mulk va asbob – uskunalarga zarar etkazilgan xolatlarda korxona tomonidan undirilishi to`g`risida ogoxlantirildim. Ushbu tilxatimda ko`rsatilgan talablarni bajarmasam korxona tomonidan etkazilgan zarar summasini mendan undirilishiga qarshilik bildirmayman.",
];

export function Tilxat({ e, d }: DocProps) {
  return (
    <Sheet>
      <h1 className="text-center text-base font-bold">TILXAT</h1>

      <p className="mt-6 text-justify">
        Men <F v={e.fullName} w={330} /> korxonada mexnat faoliyatim davomida quyidagi ko`rsatilgan
        majburiyatlarga to`liq rioya qilishga kafolat beraman va shu majburiyatlarni to`liq bajaraman.
      </p>

      <ol className="mt-5 space-y-1.5">
        {TILXAT_BANDLAR.map((t, i) => (
          <li key={i} className="flex gap-2 text-justify">
            <span className="w-6 shrink-0 text-right font-bold">{i + 1}.</span>
            <span className="flex-1">{t}</span>
          </li>
        ))}
      </ol>

      <div className="mt-12 flex items-start justify-between">
        <Sign label="(sana)   (oy)" value={docDate(d?.docDate)} w={200} />
        <Sign label="(Imzo)" w={200} />
      </div>
    </Sheet>
  );
}

/* ───────── 5. To'liq moddiy javobgarlik shartnomasi ───────── */

export function Javobgarlik({ e, c, d }: DocProps) {
  const firm = c.legalName || c.name;
  return (
    <Sheet>
      <h1 className="text-center text-base font-bold">
        To`liq moddiy javobgarlik to`g`risida
        <br />Shartnoma
      </h1>

      <div className="mt-6 flex items-end justify-between">
        <span>{docDateLat(d?.docDate)}</span>
        <span>{regionLine(c.address)}</span>
      </div>

      <P>
        “{firm}” nizom asosida ish yurituvchi bundan keyin “Korxona” deb nomlanadi, korxona nomidan
        direktor {shortName(c.directorName)} bir tomondan, va <F v={e.fullName} w={260} /> ikkinchi
        tomondan, bundan keyin “Xodim” deb nomlanadi. Ushbu shartnomani tuzdilar:
      </P>

      <P className="indent-0">
        <b>Shartnomaning mazmuni:</b> Korxonaga tegishli moddiy boyliklar, uskunalar va jihozlarning soz
        xolda saqlanishini ta`minlash, ularga yetkaziladigan zararlarni oldini olish va zarar miqdorini
        undirish. O`zbekiston Respublikasi Mehnat Kodeksining <b>337–343 moddalariga</b> binoan.
      </P>

      <h2 className="mt-5 font-bold">1. Xodimning majburiyatlari</h2>
      <P>
        <b>1.1.</b> Xodim korxonadagi moddiy boyliklar, uskunalar va jihozlarning soz xolda saqlanishini
        ta`minlashni o`z zimmasiga oladi.
      </P>
      <P>
        <b>1.2.</b> Xodim to`liq moliyaviy javobgarlikni o`z zimmasiga oladi va ish vaqtida
        foydalaniladigan xar bir uskuna va jihozlarning soz xolda saqlanishini ta`minlaydi:
      </P>
      <ul className="mt-1 space-y-1 pl-6">
        <li className="pl-5 text-justify -indent-5"><b>a)</b> Xodim moddiy boyliklar, uskunalar va jihozlarning buzulishi va ularga zarar kelirishni oldini olish bo`yicha zarur choralarni ko`rishni ta`minlaydi.</li>
        <li className="pl-5 text-justify -indent-5"><b>b)</b> Xodim moddiy boyliklar, uskunalar va jihozlarning buzulishi va ularga zarar tegishini oldini olish bo`yicha holatlar aniqlansa ma`muriyatga tezda xabar beradi;</li>
        <li className="pl-5 text-justify -indent-5"><b>c)</b> Xodim tomonidan korxonaga tegishli moddiy boyliklar va jihozlarga zarar yetkazilsa zarar miqdorini qoplanishini ta`minlaydi.</li>
        <li className="pl-5 text-justify -indent-5"><b>d)</b> Xodim o`ziga ishonib topshirilgan moddiy boyliklar, uskunalar va jihozlarning ro`yxatga olishda ishtirok etadi:</li>
      </ul>

      <h2 className="mt-5 font-bold">2. Korxona majburiyatlari</h2>
      <P><b>2.1.</b> Korxona xodim uchun ish faoliyati davomida zarur bo`lgan sharoitlarni yaratishni o`z zimmasiga oladi.</P>
      <P>
        <b>2.2.</b> Korxona, korxonaga tegishli moddiy boyliklar, uskunalar va jihozlarning soz holda
        saqlanishi uchun kerak bo`lgan extiyot qisimlar bilan taminlashni o`z zimmasiga oladi.
      </P>
      <P>
        <b>3.</b> Korxona, korxonaga tegishli moddiy boyliklar, uskunalar va jihozlarga zarar etkazilsa va
        nosoz holga kelsa zarar miqdorini aniqlidi va xodimdan undiradi.
      </P>
      <P>
        <b>4.</b> Korxona, korxonaga tegishli moddiy boyliklar, uskunalar va jihozlarning xodimning aybi
        bilan emas balki tabiiy va boshqa shunga o`xshash hollarda zarar etkazilgan bo`lsa, xodimni moddiy
        javobgar emas deb hisoblaydi.
      </P>
      <P>
        Shartnoma muddati korxona va xodim o`rtasida tuzilgan mexnat shartnomasi bekor qilingungacha amal qilinadi.
      </P>
      <P>
        Ushbu shartnoma ikki nusxada korxona va xodim o`rtasida tuziladi, bir nusxasi Korxonada va
        ikkinchi nusxasi xodimda turadi.
      </P>

      <div className="mt-12 grid grid-cols-2 gap-10">
        <div>
          <div className="font-bold">“{firm}”</div>
          <div className="mt-1 font-bold">Direktor {shortName(c.directorName)}</div>
          <div className="mt-8 w-52 border-b border-black" />
        </div>
        <div>
          <div className="font-bold">Xodim:</div>
          <div className="mt-6"><Sign label="(F.I.SH, imzo)" value={e.fullName} w={240} /></div>
        </div>
      </div>
    </Sheet>
  );
}

/* ───────── 6. Buyruq (ishga qabul qilish) ───────── */

export function Buyruq({ e, c, d }: DocProps) {
  const firm = c.legalName || c.name;
  const rekvizit = [c.address, c.phone ? `Tel: ${c.phone}` : null, c.inn ? `INN ${c.inn}` : null]
    .filter(Boolean)
    .join(". ");

  return (
    <Sheet>
      {/* Korxona blankasi */}
      <div className="flex items-start justify-between gap-4 text-center text-[11px] font-semibold leading-tight">
        <div className="w-1/3">
          O`ZBEKISTON<br />RESPUBLIKASI<br />***<br />TOSHKENT VILOYATI<br />YANGIYO`L TUMANI<br />MASULIYATI CHEKLANGAN<br />JAMIYAT
        </div>
        <div className="w-1/3 self-center text-3xl font-bold tracking-wide">INSOF</div>
        <div className="w-1/3">
          ЎЗБЕКИСТОН<br />РЕСПУБЛИКАСИ<br />***<br />ТОШКЕНТ ВИЛОЯТИ<br />ЯНГИЙЎЛ ТУМАНИ<br />МАСУЛИЯТИ ЧЕКЛАНГАН<br />ЖАМИЯТ
        </div>
      </div>
      <div className="mt-1 border-t-2 border-black pt-1 text-center text-[9px]">{rekvizit}</div>

      <div className="mt-6 flex items-end justify-between">
        <span>{regionLine(c.address).split(" ").slice(0, 2).join(" ")}</span>
        <span className="font-bold">{docDateCyr(d?.docDate)}</span>
      </div>

      <h1 className="mt-10 text-center text-base font-bold">БУЙРУҚ №<F v={d?.no} w={90} /></h1>

      <P className="indent-0">
        <b>1. {e.fullName.toUpperCase()}</b> – <F v={docDate(d?.effectiveAt ?? e.hiredAt)} w={130} /> йилдан
        бошлаб «{firm}» маъсулияти чекланган жамиятининг{" "}
        <F v={d?.position ?? e.position} w={260} /> вазифасига ишга кабул килинсин.
      </P>
      <P className="indent-0">
        <b>2. {e.fullName.toUpperCase()}</b> белгиланган тартибда мехнат шартномаси тузилсин хамда ойлик
        иш хакки {d?.salary ? <><F v={money(d.salary)} w={170} /> миқдорида</> : "штат жадвалига мувофиқ"} белгилансин.
      </P>

      <div className="mt-14 flex items-end justify-center gap-4">
        <span>Буйрук билан танишдим</span>
        <span className="inline-block w-40 border-b border-black" />
        <span className="font-bold">{shortName(e.fullName).toUpperCase()}</span>
      </div>

      <div className="mt-24 flex items-start justify-between">
        <div className="font-bold">
          «{firm}»
          <br />Директори
        </div>
        <div className="font-bold">{shortName(c.directorName)}</div>
      </div>
    </Sheet>
  );
}

/* ───────── 7. Bo'shatish arizasi ───────── */

export function Boshatish({ e, c, d }: DocProps) {
  return (
    <Sheet>
      <div className="ml-[45%]">
        <div>{regionLine(c.address)}</div>
        <div className="mt-2">“{c.legalName || c.name}” Директори: {shortName(c.directorName)} га</div>
        <div className="mt-2">Фукаро <F v={e.fullName} w={260} /> дан</div>
      </div>

      <h1 className="mt-10 text-center text-base font-bold">Ариза</h1>

      <p className="mt-8 text-justify indent-8">
        Аризамни мазмуни шундан иборатки Мени <F v={docDate(d?.effectiveAt)} w={150} /> йилдан ўз
        ҳоҳишим билан эгаллаб турган лавозимимдан бўшатишингизни сўрайман.
      </p>

      {d?.reason && <p className="mt-4 text-justify indent-8">Сабаби: {d.reason}.</p>}

      <div className="mt-20 flex items-start justify-between">
        <Sign label="(сана)" value={docDate(d?.docDate)} w={160} />
        <Sign label="(имзо)" w={150} />
        <Sign label="(ф.и.ш)" value={e.fullName} w={240} />
      </div>
    </Sheet>
  );
}

/* ───────── Slug → komponent ───────── */

export const DOC_COMPONENTS: Record<string, (p: DocProps) => React.ReactNode> = {
  ariza: Ariza,
  anketa: Anketa,
  shartnoma: Shartnoma,
  tilxat: Tilxat,
  javobgarlik: Javobgarlik,
  buyruq: Buyruq,
  boshatish: Boshatish,
};
