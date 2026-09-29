"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui";

/** Hisobotni Excel'ga yuklash — varaqlar serverda tayyorlangan (sarlavha → qiymat) qatorlaridan. */
export function ExcelButton({ file, sheets }: { file: string; sheets: { name: string; rows: Record<string, string | number | null>[] }[] }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ "": "Ma'lumot yo'q" }]), s.name.slice(0, 31));
      XLSX.writeFile(wb, `${file}.xlsx`);
    } finally { setBusy(false); }
  };
  return <Button type="button" variant="secondary" onClick={run} disabled={busy}><FileSpreadsheet size={16} /> {busy ? "Tayyorlanmoqda…" : "Excel"}</Button>;
}
