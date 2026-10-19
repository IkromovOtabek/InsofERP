/**
 * amoCRM webhook tanasini o'qish (`application/x-www-form-urlencoded`):
 *   leads[status][0][id]=…&leads[status][0][status_id]=…&leads[status][0][custom_fields][0][name]=ИНН&…[values][0][value]=…
 *   account[subdomain]=insof&account[id]=…
 * Oddiy webhook (Sozlamalar → Integratsiyalar → Webhooks) va raqamli voronka triggeri bir xil formatda yuboradi.
 * API'siz usulda (WEBHOOK) sdelka ma'lumoti faqat shu yerdan olinadi.
 */

export type WebhookLead = {
  id: number; name: string; price: number | null; statusId: number; pipelineId: number;
  fields: { name: string; value: string }[];
};

type Node = { [k: string]: Node | string };

const MAX_LEADS = 50;
const cut = (v: unknown, n = 500) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const int = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

/** `leads[…][…]` kalitlarini daraxtga yig'ish (prototipsiz obyektlar — `__proto__` kaliti zarar qilmaydi) */
function tree(form: URLSearchParams, root: string): Node {
  const out: Node = Object.create(null);
  for (const [k, v] of form) {
    if (!k.startsWith(`${root}[`)) continue;
    const path = [...k.slice(root.length).matchAll(/\[([^\]]{0,40})\]/g)].map((m) => m[1]!);
    if (!path.length || path.length > 8) continue;
    let cur: Node = out;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i]!;
      if (i === path.length - 1) { if (typeof cur[seg] !== "object") cur[seg] = v; break; }
      const next = cur[seg];
      if (typeof next === "object") { cur = next; continue; }
      const made: Node = Object.create(null);
      cur[seg] = made;
      cur = made;
    }
  }
  return out;
}

const kids = (n: Node | string | undefined): Node[] => (n && typeof n === "object" ? Object.values(n).filter((x): x is Node => typeof x === "object") : []);

/** Maydon qiymati: `values[0][value]` yoki `values[0]` */
function fieldValue(f: Node): string {
  const vals = f.values;
  if (!vals || typeof vals !== "object") return "";
  const first = vals["0"];
  if (typeof first === "string") return cut(first);
  return first && typeof first === "object" ? cut(first.value) : "";
}

export function parseWebhookLeads(form: URLSearchParams): WebhookLead[] {
  const leads = tree(form, "leads");
  const out = new Map<number, WebhookLead>();
  for (const ev of ["add", "update", "status"]) {
    for (const l of kids(leads[ev])) {
      const id = int(l.id);
      if (!id) continue;
      const price = Number(l.price);
      out.set(id, {
        id,
        name: cut(l.name, 250) || `Sdelka #${id}`,
        price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
        statusId: int(l.status_id),
        pipelineId: int(l.pipeline_id),
        fields: kids(l.custom_fields).map((f) => ({ name: cut(f.name, 100), value: fieldValue(f) })).filter((f) => f.name && f.value),
      });
      if (out.size >= MAX_LEADS) return [...out.values()];
    }
  }
  return [...out.values()];
}

/** `account[subdomain]` — xabar qaysi hisobdan kelgani (bo'lmasa null) */
export function webhookSubdomain(form: URLSearchParams): string | null {
  const s = cut(form.get("account[subdomain]"), 63).toLowerCase();
  return s || null;
}

export const webhookFieldByName = (l: WebhookLead, re: RegExp): string | null => l.fields.find((f) => re.test(f.name))?.value ?? null;

/** Sozlamalarda ko'rinadigan oxirgi hodisa — bosqich ID'sini topish uchun */
export const webhookInfo = (l: WebhookLead) => `«${l.name}» #${l.id} → bosqich ${l.statusId || "?"}, voronka ${l.pipelineId || "?"}`.slice(0, 300);
