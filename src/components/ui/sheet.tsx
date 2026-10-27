import { cn } from "@/lib/utils";

/**
 * Excel uslubidagi jadval — Sklad → «Приход», «Расход», «Остатки» (foydalanuvchi Excel jurnallari ko'rinishida).
 *
 * Oddiy `Table` dan farqi:
 *  · butun `thead` yopishadi (har katak emas) — ikki qatorli guruhlangan sarlavha (colSpan/rowSpan) to'g'ri turadi;
 *  · `border-separate` + har katakda chegara — aylantirilganda ham chiziqlar yo'qolmaydi;
 *  · sarlavha ranglari SHAFFOF EMAS: tungi rejimda rang tintlari shaffof (globals.css), yopishqoq sarlavha
 *    ostidan qatorlar ko'rinmasin — rang karta foniga (`--color-white`) aralashtiriladi;
 *  · shrift Inter: ruscha yozuv va raqamlar bir xil shriftda (asosiy Jakarta kirillni ko'tarmaydi);
 *  · sarlavha katta harfga o'tkazilmaydi (Excel'dagidek «Наименование»).
 */

export type SheetTone = "plain" | "head" | "green" | "red" | "gray" | "yellow" | "blue";

/** Shaffof bo'lmagan tus: rang karta foniga aralashtiriladi (yorug'da — och, tunda — to'q). */
const mix = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, var(--color-white))`;

const HEAD_BG: Record<SheetTone, string> = {
  plain: "var(--color-slate-50)",
  head: mix("#16a34a", 26), // Приход/Расход jurnali — yashil sarlavha (Excel'dagi kabi)
  green: mix("#16a34a", 30),
  red: mix("#dc2626", 26),
  gray: mix("#64748b", 22),
  yellow: mix("#eab308", 30),
  blue: mix("#3b82f6", 24),
};

/** Tana kataklari uchun yengil ustun tusi (guruh ustunlari ko'zda ajralib tursin). */
const CELL_BG: Partial<Record<SheetTone, string>> = {
  green: mix("#16a34a", 7),
  red: mix("#dc2626", 6),
  gray: mix("#64748b", 6),
  yellow: mix("#eab308", 9),
  blue: mix("#3b82f6", 7),
};

export function Sheet({ children, className, maxHeight = "72vh", lang = "ru" }: { children: React.ReactNode; className?: string; maxHeight?: string | number; lang?: string }) {
  return (
    <div lang={lang} className={cn("relative max-w-full overflow-auto overscroll-contain rounded-(--radius-card) border border-slate-300/80 bg-white shadow-(--shadow-card)", className)} style={{ maxHeight }}>
      <table className="w-full border-separate border-spacing-0 font-(family-name:--font-inter) text-[13px] tabular text-slate-800">{children}</table>
    </div>
  );
}

export function SheetHead({ children }: { children: React.ReactNode }) {
  return <thead className="sticky top-0 z-10">{children}</thead>;
}

export function SheetTh({ children, tone = "head", colSpan, rowSpan, right, className, title }: {
  children?: React.ReactNode; tone?: SheetTone; colSpan?: number; rowSpan?: number; right?: boolean; className?: string; title?: string;
}) {
  return (
    <th scope="col" colSpan={colSpan} rowSpan={rowSpan} title={title}
      style={{ background: HEAD_BG[tone] }}
      className={cn("border-r border-b border-slate-300/90 px-2.5 py-2 text-center align-middle text-[13px] font-bold leading-tight whitespace-nowrap text-slate-900 last:border-r-0", right && "text-right", className)}>
      {children}
    </th>
  );
}

export function SheetTd({ children, right, center, tone, strong, muted, className, colSpan }: {
  children?: React.ReactNode; right?: boolean; center?: boolean; tone?: SheetTone; strong?: boolean; muted?: boolean; className?: string; colSpan?: number;
}) {
  const bg = tone ? CELL_BG[tone] : undefined;
  return (
    <td colSpan={colSpan} style={bg ? { background: bg } : undefined}
      className={cn("border-r border-b border-slate-200 px-2.5 py-1.5 align-middle last:border-r-0", right && "text-right whitespace-nowrap", center && "text-center", strong && "font-semibold text-slate-900", muted && "text-slate-400", className)}>
      {children}
    </td>
  );
}

export function SheetTr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("transition-colors hover:bg-slate-50", className)}>{children}</tr>;
}

/** Pastki «Итого» qatori — yopishqoq emas, qalin, kulrang fon. */
export function SheetFoot({ children }: { children: React.ReactNode }) {
  return <tfoot className="[&_td]:bg-slate-50 [&_td]:font-semibold [&_td]:text-slate-900">{children}</tfoot>;
}
