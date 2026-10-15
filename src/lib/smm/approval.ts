/**
 * Post tasdiqlash oqimi — veb (`marketing/kontent/actions.ts`) va mobil ilova (direktor «Tasdiqlar») uchun bitta qoida.
 * Holat o'tishlari shartli `updateMany`: ikki marta bosilsa yoki shu orada post o'zgarsa — o'tmaydi.
 * Bildirishnomalar: tasdiqlashga yuborilsa — direktorga (marketing moduli «publish» huquqi odatda faqat unda),
 * tasdiqlansa yoki rad etilsa — post muallifiga va sotuv bo'limiga.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notifyAfter, notifyRoles } from "@/lib/notify";
import { composeText } from "./publish";
import { marketingSettings } from "./boosts";

export type Actor = { userId: string; name: string };
type Res = { ok: true; note?: string } | { ok: false; error: string };

/** Nashrga tayyorlik: tasdiqlashga yuborishda ham, direktor to'g'ridan-to'g'ri tasdiqlaganda ham tekshiriladi */
export async function readyError(id: string): Promise<{ error: string } | { c: { approval: string; status: string; title: string } }> {
  const c = await db.marketingContent.findUnique({ where: { id }, include: { _count: { select: { media: true } } } });
  if (!c) return { error: "Post topilmadi" };
  if (c.status === "CANCELLED") return { error: "Post bekor qilingan" };
  if (!c.channels.length) return { error: "Kamida bitta tarmoq tanlang" };
  if (!c.caption && !c.captionUz) return { error: "Post matni (izoh) bo'sh" };
  if (c.channels.some((ch) => ch !== "TELEGRAM") && c._count.media === 0) return { error: "Instagram/Facebook uchun rasm yoki video biriktiring" };
  if (c.channels.includes("INSTAGRAM")) {
    // Instagram chegarasi butun matnga: izoh RU + UZ + heshteglar (+ standart heshteglar) birga
    const text = composeText(c, (await marketingSettings()).defaultHashtags);
    if (text.length > 2200) return { error: `Instagram uchun matn juda uzun: ${text.length} belgi (RU + UZ izoh va heshteglar birga 2200 dan oshmasin)` };
    if ((text.match(/#[^\s#]+/g) ?? []).length > 30) return { error: "Instagram'da 30 tadan ko'p heshteg bo'lmaydi" };
  }
  return { c };
}

const link = (id: string) => ({ key: "smm", id });

export async function submitContent(id: string, actor: Actor): Promise<Res> {
  const chk = await readyError(id);
  if ("error" in chk) return { ok: false, error: chk.error };
  const r = await db.marketingContent.updateMany({ where: { id, approval: { in: ["DRAFT", "REJECTED"] } }, data: { approval: "PENDING", approvalNote: null } });
  if (r.count === 0) return { ok: false, error: "Post allaqachon tasdiqlashda yoki tasdiqlangan" };
  await audit(db, actor.userId, "STATUS_CHANGE", "MarketingContent", id, { approval: chk.c.approval }, { approval: "PENDING" });
  notifyAfter(() => notifyRoles(["DIRECTOR"], {
    type: "SMM_PENDING", title: "Post tasdiqlashni kutmoqda", body: `${chk.c.title} · yubordi: ${actor.name}`, link: link(id),
  }, { except: actor.userId }));
  return { ok: true, note: "Tasdiqlashga yuborildi" };
}

/** `seen` — direktor ko'rgan postning `updatedAt` qiymati: shundan keyin o'zgargan post tasdiqlanmaydi */
export async function approveContentLib(id: string, seen: Date, actor: Actor): Promise<Res> {
  if (Number.isNaN(seen.getTime())) return { ok: false, error: "Sahifani yangilang" };
  const chk = await readyError(id);
  if ("error" in chk) return { ok: false, error: chk.error };
  const r = await db.marketingContent.updateMany({
    where: { id, approval: { in: ["PENDING", "DRAFT"] }, status: { not: "CANCELLED" }, updatedAt: seen },
    data: { approval: "APPROVED", approvedById: actor.userId, approvedByName: actor.name, approvedAt: new Date(), approvalNote: null },
  });
  if (r.count === 0) return { ok: false, error: "Post ko'rib chiqilgan yoki shu orada o'zgargan — yangilab qayta tekshiring" };
  await audit(db, actor.userId, "STATUS_CHANGE", "MarketingContent", id, undefined, { approval: "APPROVED" });
  const c = await db.marketingContent.findUnique({ where: { id }, select: { scheduledAt: true, title: true } });
  notifyAfter(() => notifyRoles(["SALES"], {
    type: "SMM_APPROVED", title: "Post tasdiqlandi", body: `${c?.title ?? ""}${c?.scheduledAt ? " · belgilangan vaqtda o'zi chiqadi" : " · chiqish vaqtini belgilang"}`, link: link(id), channel: "oddiy",
  }, { except: actor.userId }));
  return { ok: true, note: c?.scheduledAt ? "Tasdiqlandi — belgilangan vaqtda o'zi chiqadi" : "Tasdiqlandi — chiqish vaqtini belgilang yoki «Hozir chiqarish»ni bosing" };
}

export async function rejectContentLib(id: string, note: string, actor: Actor): Promise<Res> {
  const r = await db.marketingContent.updateMany({
    where: { id, approval: { in: ["PENDING", "APPROVED"] }, status: { not: "PUBLISHED" } },
    data: { approval: "REJECTED", approvalNote: note, approvedAt: null, approvedById: null, approvedByName: null },
  });
  if (r.count === 0) return { ok: false, error: "Holat o'zgargan — yangilang" };
  await audit(db, actor.userId, "STATUS_CHANGE", "MarketingContent", id, undefined, { approval: "REJECTED", note });
  const c = await db.marketingContent.findUnique({ where: { id }, select: { title: true } });
  notifyAfter(() => notifyRoles(["SALES"], {
    type: "SMM_REJECTED", title: "Post rad etildi", body: `${c?.title ?? ""} · sabab: ${note}`, link: link(id),
  }, { except: actor.userId }));
  return { ok: true };
}
