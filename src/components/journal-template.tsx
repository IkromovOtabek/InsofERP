"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { JOURNAL_HEADERS } from "@/lib/prixod-journal";

/** Kirim / Chiqim Excel namunasi: daftardagi ustunlar + bitta misol qatori (sarlavhalar bo'yicha). */
export function JournalTemplateButton({ file, example }: { file: string; example: Partial<Record<(typeof JOURNAL_HEADERS)[number], string | number>> }) {
  async function download() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([[...JOURNAL_HEADERS], JOURNAL_HEADERS.map((h) => example[h] ?? "")]);
    ws["!cols"] = JOURNAL_HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Namuna");
    XLSX.writeFile(wb, `${file}.xlsx`);
  }
  return <Button type="button" variant="secondary" size="sm" onClick={download}><Download size={15} /> Namuna fayl</Button>;
}
