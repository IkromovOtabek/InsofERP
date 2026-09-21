import type { Prisma } from "@/generated/prisma";
import { codeFromName } from "./excel";

type Tx = Prisma.TransactionClient;
type Mat = { id: string; code: string; name: string; unit: string };

/**
 * Excel'dagi xomashyo nomini (yoki kodini) bazadagi Material'ga moslaydi.
 * Topilmasa va `createMissing` bo'lsa — yangi xomashyo yaratadi (kod nomdan, birlik Excel'dan yoki "dona").
 * Bir importda bir xil nom ikki marta kelsa bitta yozuv yaratiladi.
 */
export async function resolveMaterials(tx: Tx, names: { name: string; unit?: string; code?: string }[], createMissing: boolean) {
  const all: Mat[] = await tx.material.findMany({ select: { id: true, code: true, name: true, unit: true } });
  const byKey = new Map<string, Mat>();
  for (const m of all) { byKey.set(m.code.toLowerCase(), m); byKey.set(m.name.toLowerCase().trim(), m); }
  const result = new Map<string, Mat>();
  const missing: string[] = [];
  const created: Mat[] = [];
  for (const { name, unit, code: fileCode } of names) {
    const key = name.toLowerCase().trim();
    if (!key || result.has(key)) continue;
    // avval fayldagi kod bo'yicha, keyin nom bo'yicha
    const found = (fileCode?.trim() ? byKey.get(fileCode.toLowerCase().trim()) : undefined) ?? byKey.get(key);
    if (found) { result.set(key, found); continue; }
    if (!createMissing) { missing.push(name); continue; }
    const wanted = fileCode?.trim() ? fileCode.trim().toUpperCase() : codeFromName(name);
    let code = wanted;
    for (let n = 2; all.some((m) => m.code === code); n++) code = `${wanted.slice(0, 13)}-${n}`;
    const m = await tx.material.create({ data: { code, name: name.trim(), unit: unit?.trim() || "dona", isActive: true }, select: { id: true, code: true, name: true, unit: true } });
    all.push(m); byKey.set(code.toLowerCase(), m); byKey.set(key, m); result.set(key, m); created.push(m);
  }
  return { result, missing: [...new Set(missing)], created };
}
