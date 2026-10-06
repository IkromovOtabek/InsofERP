"use server";

import { getSession } from "@/lib/auth";
import { deleteFace, enrollFace, scanFace, type EnrollResult } from "@/lib/face-id";
import type { FaceScanResult } from "@/lib/face-id-const";

/*
 * Face ID davomat amallari. Ruxsat `lib/face-id.ts` ichida (faceScope / canEnrollFaces) — skaner tsikli xato
 * tashlamasin, javob doim ekranda ko'rsatiladigan matn bo'lsin. Sahifa yangilanishi klientda (router.refresh).
 */

const expired = "Sessiya tugagan — qayta kiring";

export async function scanFaceAction(input: unknown): Promise<FaceScanResult> {
  const s = await getSession();
  if (!s) return { ok: false, code: "FORBIDDEN", error: expired };
  return scanFace(s, input);
}

export async function enrollFaceAction(input: unknown): Promise<EnrollResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: expired };
  return enrollFace(s, input);
}

export async function deleteFaceAction(employeeId: string): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s) return { ok: false, error: expired };
  return deleteFace(s, String(employeeId));
}
