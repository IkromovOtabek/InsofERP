"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white print:hidden">
      <Printer size={16} /> Chop etish / PDF saqlash
    </button>
  );
}
