"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { JOURNAL_HEADERS } from "@/lib/prixod-journal";

/** Kirim / Chiqim Excel namunasi: daftardagi ustunlar (+ `extra`, masalan Kirimda «Kategoriya») va bitta misol qatori. */
export function JournalTemplateButton<E extends string = never>({ file, example, extra = [] }: {
  file: string; example: Partial<Record<(typeof JOURNAL_HEADERS)[number] | E, string | number>>; extra?: readonly E[];
}) {
  async function download() {
    const XLSX = await import("xlsx");
    const headers: ((typeof JOURNAL_HEADERS)[number] | E)[] = [...JOURNAL_HEADERS, ...extra];
    const ws = XLSX.utils.aoa_to_sheet([headers, headers.map((h) => example[h] ?? "")]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(10, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Namuna");
    XLSX.writeFile(wb, `${file}.xlsx`);
  }
  return <Button type="button" variant="secondary" size="sm" onClick={download}><Download size={15} /> Namuna fayl</Button>;
}
