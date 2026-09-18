import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Badge, Callout, Field, Input, Select, Checkbox, Button, Table, Th, Td, Tr, StatusSteps, DL } from "@/components/ui";

/* ═══════════════════════ Yordamchi bloklar ═══════════════════════ */

function Num({ n }: { n: number }) {
  return (
    <span className="absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-slate-950 ring-2 ring-white">
      {n}
    </span>
  );
}

function Mark({ n, children, className }: { n: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      {children}
      <Num n={n} />
    </div>
  );
}

function Steps({ items }: { items: { n: number; text: string }[] }) {
  return (
    <ol className="space-y-3">
      {items.map((s) => (
        <li key={s.n} className="flex items-start gap-2 text-sm text-slate-700">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-slate-950">{s.n}</span>
          <ArrowRight size={14} className="mt-1 shrink-0 text-brand-400" />
          <span>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Flow({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-800 shadow-(--shadow-card)">{s}</div>
          {i < steps.length - 1 && <ArrowRight size={16} className="shrink-0 text-slate-300" />}
        </div>
      ))}
    </div>
  );
}

function Shot({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-(--shadow-card)">
      <div className="flex items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        <span className="ml-2 truncate text-[11px] font-medium text-slate-400">{title}</span>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

function Lesson({ id, eyebrow, title, shot, steps, children }: {
  id: string; eyebrow: string; title: string; shot: React.ReactNode; steps: { n: number; text: string }[]; children?: React.ReactNode;
}) {
  return (
    <div id={id} className="mt-10 scroll-mt-20">
      <div className="mb-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</div>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div>{shot}</div>
        <Card padded className="h-fit">
          <div className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Qanday bajariladi</div>
          <Steps items={steps} />
        </Card>
      </div>
      {children}
    </div>
  );
}

function TestStep({ n, role, title, page, action, result, warn }: {
  n: number; role: string; title: string; page: string; action: string; result: React.ReactNode; warn?: string;
}) {
  return (
    <Card padded>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[13px] font-bold text-slate-950">{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-semibold text-slate-900">{title}</div>
            <Badge color="slate" dot={false}>{role}</Badge>
          </div>
          <DL items={[
            { k: "Sahifa", v: page },
            { k: "Amal", v: action },
            { k: "Natija", v: result },
          ]} />
          {warn && (
            <div className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[13px] text-amber-800">{warn}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ═══════════════════════ Sahifa ═══════════════════════ */

const TOC = [
  { href: "#menyu", label: "Bosh menyu" },
  { href: "#zayavka", label: "Zayavka" },
  { href: "#ishlab-chiqarish", label: "Ishlab chiqarish" },
  { href: "#sklad", label: "Sklad" },
  { href: "#reys", label: "Reyslar" },
  { href: "#moliya", label: "Moliya" },
  { href: "#boshqaruv", label: "Xodimlar" },
  { href: "#sinov", label: "Sinov ssenariysi" },
];

export default function QollanmaPage() {
  return (
    <div className="max-w-5xl">
      <div className="mb-8 animate-fade-up">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Yangi xodimlar uchun</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Foydalanuvchi qo'llanmasi</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-slate-500">
          Insof ERP zayavkadan to'lovgacha bo'lgan barcha jarayonni bitta tizimda birlashtiradi. Quyida har bir bo'lim
          qanday ishlashi qadamma-qadam, rasm va belgilar bilan tushuntirilgan.
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {TOC.map((t) => (
            <a key={t.href} href={t.href} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[12.5px] font-medium text-slate-600 shadow-xs hover:border-slate-300 hover:text-slate-900">
              {t.label}
            </a>
          ))}
        </div>
      </div>

      {/* Umumiy jarayon */}
      <Card padded className="mb-8">
        <div className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Tizim qanday ishlaydi</div>
        <Flow steps={["Zayavka (Sotuv)", "Tasdiqlash", "Ishlab chiqarish (Zames)", "Reys (yetkazish)", "Schyot", "To'lov"]} />
        <p className="mt-3 text-sm text-slate-600">
          Har bir hujjat oldingisiga bog'langan: zayavkasiz zames bo'lmaydi, tasdiqlanmagan zayavkaga reys yozilmaydi,
          yetkazilmagan hajmga schyot chiqarilmaydi. Shu tufayli ma'lumot faqat bir marta — eng boshida — kiritiladi.
        </p>
      </Card>

      {/* Bosh menyu */}
      <div id="menyu" className="mt-10 scroll-mt-20">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Orientatsiya</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Bosh menyu va navigatsiya</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <Shot title="Chap panel">
              <div className="overflow-hidden rounded-lg bg-ink-950 text-slate-200">
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-brand-500 text-[11px] font-bold text-slate-950">I</div>
                  <div className="text-[12px] font-semibold text-white">Insof ERP</div>
                </div>
                <div className="space-y-2.5 px-3 pb-3">
                  <Mark n={1}>
                    <div className="mb-1 px-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sotuv</div>
                  </Mark>
                  <Mark n={2}>
                    <div className="relative flex items-center gap-2 rounded-md bg-white/10 px-2.5 py-1.5 text-[11.5px] font-medium text-white">
                      <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-brand-400" />
                      Zayavkalar
                    </div>
                  </Mark>
                  <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11.5px] text-slate-400">Mijozlar</div>
                </div>
                <Mark n={3} className="mx-3 mb-3 border-t border-white/10 pt-2.5">
                  <div className="flex items-center gap-2 text-[11px] text-slate-300">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-[10px] font-semibold text-slate-950">DY</div>
                    Dilnoza Yusupova — Sotuv
                  </div>
                </Mark>
              </div>
            </Shot>
            <Card padded className="h-fit">
              <div className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Nimalarga e'tibor bering</div>
              <Steps items={[
                { n: 1, text: "Menyu bo'limlarga guruhlangan (Sotuv, Ishlab chiqarish, Sklad va h.k.) — faqat sizning rolingizga tegishli bo'limlar ko'rinadi." },
                { n: 2, text: "Joriy sahifa chap tomonda amber chiziq va yorqinroq rang bilan belgilanadi." },
                { n: 3, text: "Pastda o'z ismingiz, lavozimingiz va tizimdan chiqish tugmasi turadi." },
              ]} />
            </Card>
          </div>
      </div>

      {/* Zayavka */}
      <Lesson
        id="zayavka" eyebrow="1-qadam · Sotuv bo'limi" title="Zayavka yaratish"
        shot={
          <Shot title="Zayavkalar → Yangi zayavka">
            <Mark n={1} className="grid grid-cols-2 gap-3">
              <Field label="Mijoz *"><Select disabled defaultValue=""><option>Qurilish Servis MChJ</option></Select></Field>
              <Field label="Yetkazish sanasi *"><Input readOnly defaultValue="2026-09-20" /></Field>
            </Mark>
            <Field label="Obyekt manzili *"><Input readOnly defaultValue="Mirzo Ulug'bek t., Bobur ko'chasi 12" /></Field>
            <Mark n={2}>
              <div className="grid grid-cols-[1fr_90px_110px] gap-2">
                <Select disabled defaultValue=""><option>Beton M300 (B22.5)</option></Select>
                <Input readOnly defaultValue="24" placeholder="m³" />
                <Input readOnly defaultValue="650 000" placeholder="Narx" />
              </div>
            </Mark>
            <Mark n={3}><div className="text-[13px] font-medium text-slate-600">+ Qator qo'shish</div></Mark>
            <div className="text-right text-sm font-semibold">Jami: 15 600 000 so'm</div>
            <Checkbox label="Nasos kerak" disabled />
            <Mark n={4}><Button className="pointer-events-none">Saqlash (qoralama)</Button></Mark>
          </Shot>
        }
        steps={[
          { n: 1, text: "Mijoz va yetkazish sanasini, so'ng obyekt manzilini kiriting." },
          { n: 2, text: "Mahsulot (marka), hajm (m³) va kelishilgan narxni tanlang." },
          { n: 3, text: "Bir zayavkada bir nechta marka kerak bo'lsa — \"Qator qo'shish\" bilan yana qator oching." },
          { n: 4, text: "\"Saqlash\" — zayavka avtomatik Qoralama holatida yoziladi, keyin tasdiqlanadi." },
        ]}
      >
        <Card padded className="mt-5">
          <div className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Zayavka holatlari</div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge color="slate">Qoralama</Badge><ArrowRight size={14} className="text-slate-300" />
            <Badge color="blue">Tasdiqlangan</Badge><ArrowRight size={14} className="text-slate-300" />
            <Badge color="violet">Ishlab chiqarilmoqda</Badge><ArrowRight size={14} className="text-slate-300" />
            <Badge color="amber">Yetkazildi</Badge><ArrowRight size={14} className="text-slate-300" />
            <Badge color="green">Yopilgan</Badge>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            Tasdiqlashda mijozning qarzi + ochiq zayavkalari kredit limitidan oshsa, zayavka avtomatik <Badge color="red">Bloklangan</Badge> holatga
            o'tadi — uni faqat <b>direktor</b> ochishi mumkin.
          </p>
        </Card>
      </Lesson>

      {/* Ishlab chiqarish */}
      <Lesson
        id="ishlab-chiqarish" eyebrow="2-qadam · Ishlab chiqarish bo'limi" title="Zames (ishlab chiqarish partiyasi)"
        shot={
          <Shot title="Ishlab chiqarish → Yangi zames">
            <Mark n={1}>
              <Field label="Zayavka" hint="Tanlansa — marka va miqdor avtomatik to'ladi">
                <Select disabled defaultValue=""><option>Z-2026-00011 · Qurilish Servis MChJ · qoldi 24 m³</option></Select>
              </Field>
            </Mark>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Marka *"><Select disabled defaultValue=""><option>Beton M300 (B22.5)</option></Select></Field>
              <Field label="Miqdor, m³ *"><Input readOnly defaultValue="24" /></Field>
            </div>
            <Mark n={2}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Smena"><Select disabled defaultValue=""><option>1-smena</option></Select></Field>
                <Field label="Sklad *"><Select disabled defaultValue=""><option>Asosiy sklad</option></Select></Field>
              </div>
            </Mark>
            <Mark n={3}><Button className="pointer-events-none">Zamesni qayd etish</Button></Mark>
          </Shot>
        }
        steps={[
          { n: 1, text: "Zayavkani tanlang — marka va qolgan hajm o'zi to'ladi (zayavkasiz zames ham mumkin)." },
          { n: 2, text: "Smena va skladni belgilang." },
          { n: 3, text: "\"Qayd etish\" — tizim faol retsept bo'yicha xomashyoni avtomatik yechadi va tayyor betonni skladga kirim qiladi." },
        ]}
      >
        <Callout tone="warning" title="Diqqat">
          Xomashyo (sement, qum, shag'al...) yetarli bo'lmasa, zames saqlanmaydi va aniq qaysi xomashyo yetmayotgani ko'rsatiladi.
          Avval <b>Kirim</b> orqali sklad to'ldirilishi kerak.
        </Callout>
      </Lesson>

      {/* Sklad */}
      <div id="sklad" className="mt-10 scroll-mt-20">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Sklad</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Qoldiqlar va kirim (snabjeniye)</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="space-y-5">
              <Shot title="Sklad → Qoldiqlar">
                <Mark n={1}>
                  <Table>
                    <thead><tr><Th>Nomi</Th><Th right>Qoldiq</Th><Th right>Minimal</Th></tr></thead>
                    <tbody>
                      <Tr><Td>Sement M400</Td><Td right>73 160 kg</Td><Td right>20 000</Td></Tr>
                      <Tr><Td className="text-red-600">Qum</Td><Td right className="text-red-600 font-semibold">41 200 kg</Td><Td right>50 000</Td></Tr>
                    </tbody>
                  </Table>
                </Mark>
              </Shot>
              <Shot title="Kirim → Yangi kirim">
                <Mark n={2} className="grid grid-cols-3 gap-3">
                  <Field label="Yetkazuvchi *"><Select disabled defaultValue=""><option>Angren Karyera</option></Select></Field>
                  <Field label="Sklad *"><Select disabled defaultValue=""><option>Asosiy sklad</option></Select></Field>
                  <Field label="Sana *"><Input readOnly defaultValue="2026-09-18" /></Field>
                </Mark>
                <div className="grid grid-cols-[1fr_90px_40px_100px] gap-2">
                  <Select disabled defaultValue=""><option>Qum</option></Select>
                  <Input readOnly defaultValue="50 000" />
                  <span className="self-center text-xs text-slate-400">kg</span>
                  <Input readOnly defaultValue="120" placeholder="Narx" />
                </div>
                <Mark n={3}><Button className="pointer-events-none">Kirimni qayd etish</Button></Mark>
              </Shot>
            </div>
            <Card padded className="h-fit">
              <div className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Qanday bajariladi</div>
              <Steps items={[
                { n: 1, text: "Qoldiq minimal me'yordan past bo'lsa — qizil rangda ko'rinadi, darhol sezasiz." },
                { n: 2, text: "Yetkazuvchi, sklad va sanani, so'ng har bir xomashyo qatorini (miqdor + narx) kiriting." },
                { n: 3, text: "\"Qayd etish\" — xomashyo skladga kirim bo'ladi, qoldiq darhol yangilanadi." },
              ]} />
            </Card>
          </div>
      </div>

      {/* Reyslar */}
      <Lesson
        id="reys" eyebrow="3-qadam · Logistika bo'limi" title="Reys (yetkazib berish)"
        shot={
          <Shot title="Reyslar → Yangi reys">
            <Mark n={1}>
              <Field label="Zayavka *"><Select disabled defaultValue=""><option>Z-2026-00011 · qoldi 24 m³</option></Select></Field>
            </Mark>
            <Mark n={2}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mikser *"><Select disabled defaultValue=""><option>01A123BC (7 m³)</option></Select></Field>
                <Field label="Haydovchi *"><Select disabled defaultValue=""><option>Karimov Bobur</option></Select></Field>
              </div>
            </Mark>
            <Field label="Miqdor, m³ *" hint="Mikser sig'imidan katta bo'lmaydi"><Input readOnly defaultValue="7" /></Field>
            <Mark n={3}><Button className="pointer-events-none">Reys yaratish</Button></Mark>
            <div className="pt-2">
              <StatusSteps steps={[{ key: "PLANNED", label: "Rejalashtirilgan" }, { key: "LOADED", label: "Yuklandi" }, { key: "ON_ROAD", label: "Yo'lda" }, { key: "DELIVERED", label: "Yetkazildi" }]} current="LOADED" />
            </div>
          </Shot>
        }
        steps={[
          { n: 1, text: "Yetkaziladigan zayavkani tanlang." },
          { n: 2, text: "Mikser va haydovchini belgilang — miqdor mikser sig'imi bo'yicha avtomatik taklif qilinadi." },
          { n: 3, text: "\"Yuklandi\" bosilganda tayyor beton skladdan avtomatik chiqim bo'ladi; \"Yetkazildi\"da qabul qilgan shaxs F.I.O. si kiritiladi." },
        ]}
      />

      {/* Moliya */}
      <div id="moliya" className="mt-10 scroll-mt-20">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">4-qadam · Buxgalteriya / Kassa</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Schyot va to'lov</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="space-y-5">
              <Shot title="Schyotlar → Yangi schyot">
                <Mark n={1}>
                  <Field label="Zayavka *"><Select disabled defaultValue=""><option>Z-2026-00011 · Qurilish Servis MChJ</option></Select></Field>
                </Mark>
                <div className="rounded-lg bg-slate-50 p-2.5 text-[12.5px]">
                  <div className="flex justify-between"><span>Yetkazilgan</span><b>24 / 24 m³ — 15 600 000 so'm</b></div>
                </div>
                <Mark n={2}>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Summa (so'm) *"><Input readOnly defaultValue="15 600 000" /></Field>
                    <Field label="Sana *"><Input readOnly defaultValue="2026-09-19" /></Field>
                  </div>
                </Mark>
                <Button className="pointer-events-none">Schyot yozish</Button>
              </Shot>
              <Shot title="Kassa / bank → To'lov qo'shish">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Mijoz *"><Select disabled defaultValue=""><option>Qurilish Servis MChJ</option></Select></Field>
                  <Mark n={3}>
                    <Field label="Schyot" hint="Bo'sh bo'lsa — avans"><Select disabled defaultValue=""><option>S-2026-00011 · qoldiq 15 600 000</option></Select></Field>
                  </Mark>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kassa / hisob *"><Select disabled defaultValue=""><option>Asosiy hisob raqam</option></Select></Field>
                  <Field label="Summa (so'm) *"><Input readOnly defaultValue="15 600 000" /></Field>
                </div>
                <Button className="pointer-events-none">To'lovni qayd etish</Button>
              </Shot>
            </div>
            <Card padded className="h-fit">
              <div className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Qanday bajariladi</div>
              <Steps items={[
                { n: 1, text: "Zayavka tanlanganda yetkazilgan hajm bo'yicha summa avtomatik taklif qilinadi." },
                { n: 2, text: "Summani tasdiqlab, \"Schyot yozish\"ni bosing." },
                { n: 3, text: "To'lovda schyot tanlansa — u avtomatik hisoblanadi; to'liq to'lansa zayavka \"Yopilgan\" holatiga o'tadi." },
              ]} />
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap gap-2">
                  <Badge color="amber">Ochiq</Badge><Badge color="blue">Qisman to'langan</Badge><Badge color="green">To'langan</Badge>
                </div>
              </div>
            </Card>
          </div>
      </div>

      {/* Boshqaruv */}
      <div id="boshqaruv" className="mt-10 mb-10 scroll-mt-20">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Boshqaruv</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Xodimlar, texnika va sozlamalar</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card padded>
              <div className="mb-1 font-semibold text-slate-900">Yangi xodim qo'shish</div>
              <p className="text-sm text-slate-600">
                <b>Xodimlar</b> bo'limida F.I.O. va lavozimni kiriting. Agar lavozim tizimga kiradigan bo'lim bo'lsa
                (Sotuv, Sklad, Buxgalteriya...) — login va parol maydonlari chiqadi, shu orqali xodimga kirish huquqi beriladi.
                Buni faqat <b>Otdel kadr</b> yoki <b>direktor</b> bajara oladi.
              </p>
            </Card>
            <Card padded>
              <div className="mb-1 font-semibold text-slate-900">Sozlamalar (faqat direktor)</div>
              <p className="text-sm text-slate-600">
                Zavod rekvizitlari, beton markalari va narxlari, retseptlar, skladlar, kassa hisoblari, foydalanuvchilar
                va <b>audit jurnali</b> — tizimdagi har bir o'zgarish kim, qachon, nima qilgani bilan shu yerda saqlanadi.
              </p>
            </Card>
          </div>
      </div>

      {/* Sinov ssenariysi */}
      <div id="sinov" className="mt-10 scroll-mt-20">
          <div className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-600">Amaliyot</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">Sinov ssenariysi: zayavkadan to'lovgacha</h2>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-500">
              Tizimni birinchi marta sinab ko'rayotganda adashib ketmaslik uchun — bitta zayavkani boshidan oxirigacha
              shu tartibda qo'lda o'tkazing. Har bir qadam oldingisiga bog'liq, shuning uchun ketma-ketlikni buzmang.
            </p>
          </div>

          <Card padded className="mb-5">
            <div className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Kirish uchun loginlar (namunaviy ma'lumotlar)</div>
            <Table>
              <thead><tr><Th>Login</Th><Th>Parol</Th><Th>Rol / kimga kerak</Th></tr></thead>
              <tbody>
                <Tr><Td className="font-medium">admin</Td><Td>admin123</Td><Td>Direktor — hammasini ko'radi va har qanday amalni bajaradi</Td></Tr>
                <Tr><Td className="font-medium">snab1</Td><Td>parol123</Td><Td>Snabjeniye — xomashyo kirimi</Td></Tr>
                <Tr><Td className="font-medium">sotuv1</Td><Td>parol123</Td><Td>Sotuv — zayavka va tasdiqlash</Td></Tr>
                <Tr><Td className="font-medium">prod1</Td><Td>parol123</Td><Td>Ishlab chiqarish — zames</Td></Tr>
                <Tr><Td className="font-medium">log1</Td><Td>parol123</Td><Td>Logistika — reys</Td></Tr>
                <Tr><Td className="font-medium">buh1</Td><Td>parol123</Td><Td>Buxgalteriya — schyot</Td></Tr>
                <Tr><Td className="font-medium">kassa1</Td><Td>parol123</Td><Td>Kassa / bank — to'lov</Td></Tr>
              </tbody>
            </Table>
            <p className="mt-3 text-sm text-slate-600">
              Birinchi safar butun zanjirni <b>admin</b> bilan o'tkazing (direktor har qanday bo'lim amalini bajara oladi),
              keyin xohlasangiz har bir qadamni tegishli rol bilan qayta sinab ko'ring.
            </p>
          </Card>

          <Flow steps={["Kirim (Snabjeniye)", "Zayavka (Sotuv)", "Tasdiqlash", "Zames", "Reys → Yetkazildi", "Schyot", "To'lov", "Yopilgan"]} />

          <div className="mt-5 space-y-3">
            <TestStep n={1} role="Snabjeniye" title="Xomashyo kirimi"
              page="Kirim (snabjeniye) → Yangi kirim"
              action="Yetkazuvchi va Asosiy sklad tanlang; Sement 20000 kg, Qum 30000 kg, Shag'al 40000 kg, Suv 5000 l, Plastifikator 200 l qatorlarini narxi bilan kiritib saqlang."
              result={<>Hujjat <b>K-0001</b> yaratiladi; <b>Sklad</b> sahifasida barcha qoldiqlar oshadi.</>}
              warn="Bu qadam shart: zames uchun xomashyo yetarli bo'lmasa, keyingi qadam saqlanmaydi."
            />
            <TestStep n={2} role="Sotuv" title="Zayavka yaratish"
              page="Zayavkalar → Yangi zayavka"
              action={"Mijoz: \"Toshkent Qurilish Konsalting MChJ\" (limit 50 mln), marka M300, 10 m³, narx 650 000, yetkazish sanasi va manzil kiriting."}
              result={<>Zayavka <b>Z-0001</b>, holati <Badge color="slate" dot={false}>Qoralama</Badge></>}
            />
            <TestStep n={3} role="Sotuv" title="Tasdiqlash"
              page={'Zayavka sahifasi → "Tasdiqlash" tugmasi'}
              action="Tugmani bosing."
              result={<>Qarz + ochiq zayavkalar + shu summa limitdan oshmasa → <Badge color="blue" dot={false}>Tasdiqlangan</Badge>, oshsa → <Badge color="red" dot={false}>Bloklangan</Badge></>}
              warn={"Blokni alohida sinash uchun \"Chilonzor Invest\" mijozini tanlang — uning limiti 0 so'm, zayavka darhol bloklanadi. Faqat direktor \"Blokdan chiqarish\" qila oladi."}
            />
            <TestStep n={4} role="Ishlab chiqarish" title="Zames"
              page="Ishlab chiqarish → Yangi zames"
              action="Zayavkani tanlang (marka avtomat keladi), sklad = Asosiy, hajm 10 m³, smena 1, saqlang."
              result={<>Hujjat <b>ZM-0001</b>; sement 3800 kg (380 × 10) kamayadi, M300 tayyor beton +10 m³; zayavka <Badge color="violet" dot={false}>Ishlab chiqarilmoqda</Badge></>}
            />
            <TestStep n={5} role="Logistika" title="Reys va yetkazish"
              page="Reyslar → Yangi reys"
              action={"Zayavka, mikser 01D321GH (8 m³), haydovchi, hajm 8 m³ — reys yarating, so'ng ketma-ket \"Yuklandi\" → \"Yo'lda\" → \"Yetkazildi\" (qabul qilgan shaxs F.I.O. majburiy)."}
              result={<>Hujjat <b>N-0001</b>; &quot;Yuklandi&quot;da tayyor betondan chiqim yoziladi</>}
              warn="Zayavkada 2 m³ qoladi — uni yetkazish uchun ikkinchi reys oching va yetkazing. Faqat shundan keyin zayavka to'liq Yetkazildi holatiga o'tadi."
            />
            <TestStep n={6} role="Buxgalteriya" title="Schyot yozish"
              page={'Zayavka ichidagi "Schyot yozish" yoki Schyotlar → Yangi schyot'}
              action="Summa 6 500 000 kiriting va saqlang."
              result={<>Hujjat <b>S-0001</b>, holati <Badge color="amber" dot={false}>Ochiq</Badge>. Bitta zayavkaga faqat bitta schyot yoziladi.</>}
            />
            <TestStep n={7} role="Kassa" title="To'lov"
              page="Kassa / bank → To'lov qo'shish"
              action="Mijozni, albatta schyotni, kassa/bank hisobini va summani kiriting."
              result={<>Qisman to'lansa → <Badge color="blue" dot={false}>Qisman to'langan</Badge>, to'liq to'lansa → <Badge color="green" dot={false}>To'langan</Badge></>}
            />
            <TestStep n={8} role="Tekshiruv" title="Yakuniy holatni tekshirish"
              page="Zayavka sahifasi"
              action="Sahifani yangilang."
              result={<>Zayavka <b>Yetkazildi</b> va schyot <b>to'liq to'langan</b> bo'lsa — zayavka avtomatik <Badge color="green" dot={false}>Yopilgan</Badge> bo'ladi.</>}
            />
          </div>

          <Card padded className="mt-5">
            <div className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-slate-400">Eng ko'p chalkashtiradigan joylar</div>
            <Table>
              <thead><tr><Th>Muammo</Th><Th>Sababi</Th></tr></thead>
              <tbody>
                <Tr><Td>To'lov qildim, zayavka Yopilgan bo'lmadi</Td><Td className="text-slate-600">Zayavka avval <b>Yetkazildi</b> holatida bo'lishi shart — yetkazishdan oldin to'lasangiz, schyot To'langan bo'ladi, lekin zayavka yopilmaydi.</Td></Tr>
                <Tr><Td>To'lovni schyotsiz kiritdim — hech narsa o'zgarmadi</Td><Td className="text-slate-600">Schyot tanlanmasa, to'lov faqat avans sifatida yoziladi — schyot va zayavka holatiga ta'sir qilmaydi.</Td></Tr>
                <Tr><Td>Zames "xomashyo yetarli emas" deydi</Td><Td className="text-slate-600">Kirim qadami o'tkazib yuborilgan yoki boshqa sklad tanlangan — qoldiq har bir sklad kesimida alohida hisoblanadi.</Td></Tr>
                <Tr><Td>Reys ro'yxatida zayavka ko'rinmayapti</Td><Td className="text-slate-600">Ro'yxatda faqat <b>Tasdiqlangan</b> yoki <b>Ishlab chiqarilmoqda</b> holatidagi zayavkalar chiqadi.</Td></Tr>
                <Tr><Td>Zayavkani bekor qila olmayapman</Td><Td className="text-slate-600">Unga zames yoki reys yozilgan bo'lsa, zayavka bekor qilinmaydi.</Td></Tr>
              </tbody>
            </Table>
          </Card>
      </div>

      <Callout tone="info">
        Savol tug'ilsa — bo'lim rahbaringizga yoki direktorga murojaat qiling. Bu qo'llanma tizim menyusidagi{" "}
        <b>"Yordam"</b> tugmasi orqali istalgan vaqtda ochiladi.
      </Callout>
    </div>
  );
}
