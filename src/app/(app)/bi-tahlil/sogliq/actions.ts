"use server";

import { revalidatePath } from "next/cache";
import { requirePage } from "@/lib/page-guard";
import { saveDataHealthRun } from "@/lib/data-health";
import type { ActionState } from "@/lib/action";

/** «Hozir tekshirish» — sahifa ruxsati bor (direktor) xodim; Telegram yuborilmaydi (tungi tekshiruv yuboradi). */
export async function runDataHealthNow(): Promise<ActionState> {
  await requirePage("/bi-tahlil/sogliq");
  const r = await saveDataHealthRun({ manual: true, notify: false });
  revalidatePath("/bi-tahlil/sogliq");
  return { ok: true, note: r && r.problems ? `${r.problems} ta tekshiruvda muammo topildi` : "Hammasi joyida" };
}
