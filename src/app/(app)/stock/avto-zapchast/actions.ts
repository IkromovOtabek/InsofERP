"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { markAvtoPartsSeen } from "@/lib/avto-parts";

/** «Yangi kelgan avto zapchastlar» ochildi — o'z xabarlari o'qilgan bo'ladi, tepadagi banner yo'qoladi. */
export async function markAvtoSeen(): Promise<void> {
  const s = await getSession();
  if (!s) return;
  if (await markAvtoPartsSeen(s.userId)) revalidatePath("/", "layout");
}
