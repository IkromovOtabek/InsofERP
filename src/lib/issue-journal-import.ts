import { createHash } from "node:crypto";
import { db } from "./db";
import { validDate } from "./action";
import { resolveMaterials } from "./import-materials";
import { toMaterialUnit } from "./unit";
import { journalUnit } from "./prixod-journal";
import { matchTarget, normTargetName } from "./issue-target";
import { issueTargetOptions, upsertRecipient } from "./stock-recipients";
import { issueStock, IssueError, parseIssueTarget } from "./stock-issue";
import type { IssueJournalDoc } from "./issue-journal";
import type { Role } from "@/generated/prisma";

export type IssueChunkResult = {
  error?: string;
  created: number;
  /** Shu fayl avval yuklangan — chiqim qayta yozilmadi (bir martalik kalit) */
  existed: number;
  failed: { date: string; recipient: string; error: string }[];
};

/** Bir chaqiruvda ko'pi bilan shuncha hujjat. */
const MAX_DOCS = 40;

/**
 * Sklad → Chiqim → «Excel'dan yuklash»: brauzer o'qib guruhlagan chiqim hujjatlarining bir bo'lagini yozadi
 * (ruxsat — `stock` → `issue`, chaqiruvchida). Har hujjat — oddiy chiqim (`issueStock`: qoldiq qulf ostida tekshiriladi,
 * narx skladdan). Sana cheklovi yo'q (eski daftar), kelajak — rad.
 * «Kimga»: brigada → xodim → oluvchi; topilmasa yangi oluvchi yaratiladi. Xomashyo yaratilmaydi — skladda yo'q narsani
 * berib bo'lmaydi. Qoldig'i yetmagan yoki xomashyosi topilmagan hujjat saqlanmaydi, qolganlari yoziladi.
 * Bir martalik kalit hujjat mazmunidan — fayl qayta yuklansa chiqim takrorlanmaydi.
 */
export async function importIssueDocs(
  input: { warehouseId: string; docs: IssueJournalDoc[] },
  s: { userId: string; role: Role },
): Promise<IssueChunkResult> {
  const res: IssueChunkResult = { created: 0, existed: 0, failed: [] };
  const docs = Array.isArray(input?.docs) ? input.docs.slice(0, MAX_DOCS) : [];
  if (!docs.length) return { ...res, error: "Hujjat yo'q" };
  const bad = docs.find((d) => !validDate(String(d?.date ?? "")) || !Array.isArray(d.rows) || !d.rows.length || !String(d.recipient ?? "").trim());
  if (bad) return { ...res, error: `Hujjat noto'g'ri: ${bad?.date ?? "?"} · ${bad?.recipient ?? "?"} (sana bugundan keyin bo'lmasin)` };
  const wh = await db.warehouse.findFirst({ where: { id: String(input.warehouseId ?? ""), isActive: true }, select: { id: true } });
  if (!wh) return { ...res, error: "Sklad topilmadi yoki yopilgan" };

  const targets = await issueTargetOptions();
  const keyOf = new Map<string, string | { error: string }>();
  const targetOf = async (name: string) => {
    const k = normTargetName(name);
    if (!keyOf.has(k)) {
      const hit = matchTarget(targets, name);
      if (hit) keyOf.set(k, hit.key);
      else {
        const r = await upsertRecipient({ name }, s.userId);
        keyOf.set(k, "error" in r ? { error: r.error } : `r:${r.id}`);
      }
    }
    return keyOf.get(k)!;
  };

  const names = docs.flatMap((d) => d.rows.map((r) => ({ name: String(r.material ?? "").trim(), unit: String(r.unit ?? "") })));
  const { result: mats } = await db.$transaction((tx) => resolveMaterials(tx, names, false));

  for (const d of docs) {
    try {
      const items = d.rows.map((r) => {
        const m = mats.get(String(r.material ?? "").toLowerCase().trim());
        if (!m) throw new IssueError(`«${r.material}» spravochnikda yo'q — nomini tuzating`);
        const conv = toMaterialUnit(Number(r.qty), 0, journalUnit(r.unit), m.unit);
        if (!conv) throw new IssueError(`«${m.name}»: faylda birlik «${r.unit}», spravochnikda «${m.unit}» — o'girib bo'lmaydi`);
        return { materialId: m.id, qty: conv.qty };
      });
      const key = await targetOf(d.recipient);
      if (typeof key !== "string") throw new IssueError(key.error);
      const to = parseIssueTarget(key)!;
      const hash = createHash("sha256").update(JSON.stringify([wh.id, d.key, d.rows.map((r) => [r.material, r.unit, r.qty])])).digest("hex").slice(0, 40);
      const out = await issueStock(
        { warehouseId: wh.id, date: d.date, to, items, note: String(d.note ?? "").slice(0, 300) || "Excel'dan", clientToken: `xli-${hash}`, anyPastDate: true },
        { userId: s.userId, role: s.role },
      );
      if (out.existed) res.existed++; else res.created++;
    } catch (e) {
      if (!(e instanceof IssueError)) console.error("[issue-journal]", e);
      res.failed.push({ date: d.date, recipient: d.recipient, error: e instanceof IssueError ? e.message : "Saqlanmadi" });
    }
  }
  return res;
}
