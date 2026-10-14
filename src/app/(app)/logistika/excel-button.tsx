"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui";
import { uiText } from "@/components/script-provider";

/**
 * Hisobotni Excel'ga yuklash — varaqlar serverda tayyorlangan (sarlavha → qiymat) qatorlaridan.
 * Sarlavha, varaq nomi va matnli kataklar ekrandagi til bilan bir xil (lotin / kirill / rus — `uiText`); sonlar o'zgarmaydi.
 */
export function ExcelButton({ file, sheets }: { file: string; sheets: { name: string; rows: Record<string, string | number | null>[] }[] }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const tr = (v: string | number | null) => (typeof v === "string" && v ? uiText(v) : v);
      for (const s of sheets) {
        const rows = (s.rows.length ? s.rows : [{ "": "Ma'lumot yo'q" }]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [uiText(k), tr(v)])));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), uiText(s.name).slice(0, 31));
      }
      XLSX.writeFile(wb, `${uiText(file)}.xlsx`);
    } finally { setBusy(false); }
  };
  return <Button type="button" variant="secondary" onClick={run} disabled={busy}><FileSpreadsheet size={16} /> {busy ? "Tayyorlanmoqda…" : "Excel"}</Button>;
}
