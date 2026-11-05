import { moduleWriteAllowed, type Session } from "@/lib/auth";
import { OPENING_WRITERS } from "@/lib/opening-balances";
import { PageHeader } from "@/components/ui";
import { OpeningSection } from "@/app/(app)/settings/boshlangich-qoldiq/section";

/**
 * Debitorka varag'idagi «Qarzlarni kiritish» — mijoz / ta'minotchi qarzini Excel'dan yoki qo'lda yozish,
 * kiritilganlarni tahrirlash, kamaytirish va o'chirish. Mexanizm — boshlang'ich qoldiq (`lib/opening-balances.ts`):
 * mijozda BQ-schyot, ta'minotchida qoldiq yozuvi; varaqdagi qarz va avans shular bilan hisoblanadi.
 */
const SIDE = {
  customer: { kind: "CUSTOMER", sheet: "/bi-tahlil/mijozlar/xaridorlar", title: "Mijozlar qarzini kiritish", back: "Mijoz debitorka / kreditorka",
    subtitle: "Mijozning qarzi (+) yoki bergan avansi (−) — Excel'dan yoki qo'lda. Kiritilgani darrov debitorka varag'ida, akt sverkada va mijoz kartasida ko'rinadi; kassir to'lovni shu qarzga yozadi." },
  supplier: { kind: "SUPPLIER", sheet: "/bi-tahlil/mijozlar/taminotchilar", title: "Ta'minotchilar qarzini kiritish", back: "Ta'minotchi kreditorka / debitorka",
    subtitle: "Ta'minotchiga qarzimiz (+) yoki bergan avansimiz (−) — Excel'dan yoki qo'lda. Kiritilgani varaqda va ta'minotchi kartasida ko'rinadi; to'lov shu ro'yxatdan yoki kartadan yoziladi." },
} as const;

/** Varaq tepasidagi tugma kimga ko'rinadi — kiritish huquqi borlarga (direktor, buxgalteriya yoki «opening» ruxsati). */
export const canEnterDebts = (s: Session) => moduleWriteAllowed(s, "opening", OPENING_WRITERS) === true;

export function debtEntryHref(who: keyof typeof SIDE) { return `${SIDE[who].sheet}/kiritish`; }

export async function DebtEntry({ who, s, sp }: { who: keyof typeof SIDE; s: Session; sp: { bekor?: string; q?: string } }) {
  const side = SIDE[who];
  return (
    <div className="min-w-0">
      <PageHeader back={{ href: side.sheet, label: side.back }} eyebrow="Tahlil" title={side.title} subtitle={side.subtitle} />
      <OpeningSection kind={side.kind} s={s} base={debtEntryHref(who)} showCancelled={sp.bekor === "1"} q={sp.q} help={false} />
    </div>
  );
}
