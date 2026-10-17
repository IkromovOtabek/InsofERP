"use server";

import { revalidatePath } from "next/cache";
import { requireAction } from "@/lib/auth";
import { importIssueDocs, type IssueChunkResult } from "@/lib/issue-journal-import";
import type { IssueJournalDoc } from "@/lib/issue-journal";

/** Sklad → Chiqim → «Excel'dan yuklash»: bir bo'lak hujjatni chiqim qiladi (mantiq — `lib/issue-journal-import.ts`). */
export async function importIssueChunk(input: { warehouseId: string; docs: IssueJournalDoc[] }): Promise<IssueChunkResult> {
  const s = await requireAction("stock", "issue");
  const res = await importIssueDocs(input, { userId: s.userId, role: s.role });
  if (res.created) {
    revalidatePath("/stock"); revalidatePath("/stock/rasxod"); revalidatePath("/brigades");
    revalidatePath("/production"); revalidatePath("/dashboard"); revalidatePath("/snabjeniye");
  }
  return res;
}
