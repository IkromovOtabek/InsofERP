import { moneyShort, fmtNum } from "@/lib/format";

/**
 * «Biznes salomatligi» bali (Tahlil → Umumiy) — sof funksiya, bazasiz (QA `c-health` shu bilan sinaydi).
 * Sarvar rejasi 3-bosqich (2026-11-24): ilgari 81/100 «Sog'lom» chiqardi, holbuki PNL −5 mlrd, qarz 26,8 mlrd va 28.11 da
 * kassa uzilishi bor edi — ball faqat debitorka, xomashyo, marja, o'sish va zayavka oqimidan iborat edi.
 * Endi 8 ta komponent (har biri 0–20): oldingi beshtasi + pul oqimi (30 kunlik prognozda uzilish), sof foyda (oy PNL),
 * qarz yuki (kredit + ta'minotchi qarzi / oylik sotuv). Debitorka — muddati o'tgan qarzning JAMI debitorkadagi ulushi
 * (ilgari oylik sotuvga nisbatan edi: 7,2 mlrd debitorka, 94 qarzdor bilan ham 20/20 chiqardi).
 * Ma'lumoti yo'q komponent ballanmaydi (`null`); ball mavjudlari bo'yicha 100 ga normallanadi, 3 tadan kam bo'lsa ko'rsatilmaydi.
 * Pul uzilishi kutilsa yoki oy zarar bilan yopilayotgan bo'lsa — holat hech qachon «Sog'lom» emas (ball 74 dan oshmaydi).
 */
export type HealthComponent = { label: string; score: number | null; text: string };

export type HealthInput = {
  customers: number;
  receivable: number;
  overdueDebt: number;
  materials: { total: number; ok: number; atRisk: number };
  revenue: number;
  margin: number;
  prevRevenue: number;
  orders: { inRange: number; blocked: number; overdue: number };
  monthRevenue: number;
  prevMonthRevenue: number;
  finance: { gap: { date: Date; balance: number } | null; horizonDays: number; net: number; income: number; loans: number; suppliers: number } | null;
};

export type HealthResult = { health: number | null; label: string; basis: number; components: HealthComponent[]; capped: string | null };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const dd = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
export const HEALTH_CAP = 74;
const MIN_COMPONENTS = 3;

export function healthScore(i: HealthInput): HealthResult {
  const growth = i.prevRevenue > 0 ? (i.revenue - i.prevRevenue) / i.prevRevenue : 0;
  const blockedShare = i.orders.blocked / Math.max(1, i.orders.inRange + i.orders.blocked);
  const overdueShare = i.receivable > 0 ? i.overdueDebt / i.receivable : 0;
  const f = i.finance;
  const monthly = Math.max(i.monthRevenue, i.prevMonthRevenue);
  const debt = f ? f.loans + f.suppliers : 0;
  const components: HealthComponent[] = [
    {
      label: "Debitorka nazorati",
      // 0% muddati o'tgan → 20; 50% va undan ko'p → 0
      score: i.customers ? Math.round(20 * clamp01(1 - overdueShare / 0.5)) : null,
      text: !i.customers ? "Mijoz bazasi bo'sh" : i.receivable > 0
        ? `Muddati o'tgan qarz jami debitorkaning ${Math.round(overdueShare * 100)}%i (${moneyShort(i.overdueDebt)} / ${moneyShort(i.receivable)})`
        : "Mijozlarda qarz yo'q",
    },
    {
      label: "Xomashyo zaxirasi",
      score: i.materials.total ? Math.round(20 * clamp01(i.materials.ok / i.materials.total)) : null,
      text: i.materials.total ? `${i.materials.atRisk} ta xomashyo xavf zonasida` : "Xomashyo spravochnigi bo'sh",
    },
    {
      label: "Marja",
      score: i.revenue > 0 ? Math.round(20 * clamp01(i.margin / 25)) : null,
      text: i.revenue > 0 ? `Yalpi marja ${fmtNum(i.margin, 1)}% (maqsad ≥25%)` : "Davr ichida sotuv yo'q",
    },
    {
      // O'tgan davrda sotuv bo'lmasa (tizimga yangi o'tilgan) o'sish yo'q — "+100%" ball bermaydi
      label: "Sotuv o'sishi",
      score: i.prevRevenue > 0 ? Math.round(20 * clamp01(0.5 + growth)) : null,
      text: i.prevRevenue > 0 ? `Oldingi davrga nisbatan ${growth >= 0 ? "▲" : "▼"} ${fmtNum(Math.abs(growth * 100), 1)}%` : "Taqqoslash uchun o'tgan davr sotuvi yo'q",
    },
    {
      label: "Zayavka oqimi",
      score: i.orders.inRange + i.orders.blocked + i.orders.overdue > 0 ? Math.round(20 * (1 - Math.min(1, blockedShare * 3)) * (i.orders.overdue ? 0.6 : 1)) : null,
      text: i.orders.inRange + i.orders.blocked + i.orders.overdue > 0 ? `${i.orders.blocked} ta bloklangan, ${i.orders.overdue} ta muddati o'tgan zayavka` : "Davr ichida zayavka yo'q",
    },
    {
      label: "Pul oqimi",
      score: f ? (f.gap ? 0 : 20) : null,
      text: !f ? "Kassa prognozi yo'q" : f.gap
        ? `${dd(f.gap.date)} da pul yetmaydi — prognoz qoldig'i ${moneyShort(f.gap.balance)}`
        : `${f.horizonDays} kunlik prognozda pul uzilishi yo'q`,
    },
    {
      // Sof marja −10% → 0, +10% → 20
      label: "Sof foyda",
      score: f && f.income > 0 ? Math.round(20 * clamp01((f.net / f.income + 0.1) / 0.2)) : null,
      text: f && f.income > 0 ? `Oy sof natijasi ${moneyShort(f.net)} (daromadning ${fmtNum((f.net / f.income) * 100, 1)}%i)` : "Oy daromadi hali yo'q",
    },
    {
      // Kredit + ta'minotchi qarzi: 1 oylik sotuvgacha → 20, 6 oylikdan ko'p → 0
      label: "Qarz yuki",
      score: !f || (debt <= 0 && monthly <= 0) ? null : monthly <= 0 ? 0 : Math.round(20 * clamp01(1 - (debt / monthly - 1) / 5)),
      text: !f ? "Qarz ma'lumoti yo'q" : debt <= 0 ? "Kredit va ta'minotchi qarzi yo'q"
        : monthly > 0 ? `Kredit va ta'minotchi qarzi ${moneyShort(debt)} — oylik sotuvning ${fmtNum(debt / monthly, 1)} barobari` : `Qarz ${moneyShort(debt)}, sotuv yo'q`,
    },
  ];
  const scored = components.filter((c): c is HealthComponent & { score: number } => c.score !== null);
  let health = scored.length >= MIN_COMPONENTS ? Math.round((scored.reduce((s, c) => s + c.score, 0) / (20 * scored.length)) * 100) : null;
  let capped: string | null = null;
  if (health !== null && f?.gap) capped = `${dd(f.gap.date)} da pul uzilishi kutilmoqda`;
  else if (health !== null && f && f.income > 0 && f.net < 0) capped = "oy zarar bilan yopilmoqda";
  if (health !== null && capped && health > HEALTH_CAP) health = HEALTH_CAP;
  const label = health !== null ? (health >= 75 ? "Sog'lom" : health >= 50 ? "E'tibor talab" : "Xavfli") : scored.length ? "Ma'lumot yetarli emas" : "Ma'lumot yo'q";
  return { health, label, basis: scored.length, components, capped };
}
