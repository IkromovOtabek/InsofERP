import type { CashCategoryNeeds, CashFlowKind, PnlLine } from "@/generated/prisma";

/** Yorliqlar — klient komponentlar ham oladi (bazaga bog'liq emas). */
export const FLOW_LABEL: Record<CashFlowKind, string> = { OPERATING: "Joriy faoliyat", FINANCING: "Moliyaviy faoliyat", INVESTING: "Investitsion faoliyat" };

export const PNL_LINE_LABEL: Record<PnlLine, string> = {
  OTHER_INCOME: "Boshqa tushumlar", MATERIALS: "Xom-ashyo (tannarx)", PRODUCTION: "Ishlab chiqarish xarajatlari", PAYROLL: "Ish haqi",
  TRANSPORT: "Avtotransport", ADMIN: "Ma'muriy xarajatlar", COMMERCIAL: "Tijoriy xarajatlar", TAX: "Soliqlar", INTEREST: "Kredit foizi",
  PROJECT: "Loyihalar", DIVIDEND: "Divident", NONE: "Foyda-zararga kirmaydi",
};

export const NEEDS_LABEL: Record<CashCategoryNeeds, string> = { PROJECT: "Loyiha", LOAN: "Kredit / qarz", ASSET: "Asosiy vosita" };

