"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { importJournalDocs, type JournalChunkResult } from "@/lib/prixod-journal-import";
import type { JournalDoc } from "@/lib/prixod-journal";

/** Sklad → Kirim → «Excel jurnal»: bir bo'lak hujjatni kirim qiladi (mantiq — `lib/prixod-journal-import.ts`). */
export async function importJournalChunk(input: { warehouseId: string; docs: JournalDoc[]; supplierVat: Record<string, boolean>; paid?: boolean }): Promise<JournalChunkResult> {
  const s = await requireAction("stock", "receipt");
  const res = await importJournalDocs(input, { userId: s.userId, role: s.role, canAddSuppliers: canDo(s, "stock", "suppliers") });
  if (res.created) {
    revalidatePath("/receipts"); revalidatePath("/stock"); revalidatePath("/stock/prixod"); revalidatePath("/suppliers"); revalidatePath("/cashflow");
  }
  return res;
}
