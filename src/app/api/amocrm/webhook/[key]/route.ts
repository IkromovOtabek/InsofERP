import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { notifyAfter } from "@/lib/notify";
import { AMO_ID } from "@/lib/amocrm/store";
import { pullDeal } from "@/lib/amocrm/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * amoCRM → ERP webhook (`status_lead` — sdelka bosqichi o'zgardi). amoCRM imzo qo'ymaydi, shuning uchun:
 *  - manzildagi maxfiy kalit (`AmoConnection.webhookKey`, uzilganda almashadi) tekshiriladi;
 *  - tanadagi ma'lumotga ishonilmaydi: faqat sdelka id olinadi, sdelka API orqali qayta o'qiladi (`pullDeal`).
 * amoCRM 2 soniya ichida javob kutadi (ko'p xatoda webhook'ni o'chiradi) — ish javobdan keyin bajariladi.
 * O'tkazib yuborilgan hodisalarni 5 daqiqalik tekshiruv (`pullStageDeals`) baribir topadi.
 * Login'dan ozod (middleware'da /api/amocrm/webhook/ ochiq).
 */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const c = await db.amoConnection.findUnique({ where: { id: AMO_ID } });
  const ok = !!c && c.status !== "DISCONNECTED" && !!c.accessTokenEnc && key.length === c.webhookKey.length && timingSafeEqual(Buffer.from(key), Buffer.from(c.webhookKey));
  if (!ok) return new Response("not found", { status: 404 });

  const body = (await req.text()).slice(0, 200_000);
  const form = new URLSearchParams(body);
  // leads[status][0][id]=…&leads[status][0][status_id]=…&leads[status][0][pipeline_id]=…
  const ids = new Set<number>();
  for (const [k, v] of form) {
    const m = /^leads\[(status|add|update)\]\[(\d+)\]\[id\]$/.exec(k);
    if (!m) continue;
    const statusId = Number(form.get(`leads[${m[1]}][${m[2]}][status_id]`));
    if (c.stageToErp && statusId !== c.stageToErp) continue;
    const id = Number(v);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
    if (ids.size >= 50) break;
  }
  if (ids.size) {
    notifyAfter(async () => {
      for (const id of ids) {
        try { await pullDeal(id, c); } catch (e) { console.warn("[amocrm] webhook sdelka", id, e instanceof Error ? e.message : e); }
      }
    });
  }
  return new Response("ok");
}
