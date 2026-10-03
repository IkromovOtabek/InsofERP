import { headers } from "next/headers";
import { control } from "./db";
import { ipFromHeaders } from "../login-guard";

/** Superadmin amali jurnalga: kim, qaysi korxonada, nima qildi. Parol hech qachon yozilmaydi. */
export async function logEvent(adminId: string | null, action: string, tenantId: string | null, detail?: Record<string, unknown>) {
  let ip: string | null = null;
  try { ip = ipFromHeaders(await headers()); } catch { /* skript (CLI) — so'rov yo'q */ }
  await control.controlEvent.create({ data: { adminId, tenantId, action, ip, detail: detail ? JSON.parse(JSON.stringify(detail)) : undefined } });
}

export const EVENT_LABEL: Record<string, string> = {
  TENANT_CREATE: "Korxona yaratildi",
  TENANT_REGISTER: "Mavjud korxona ro'yxatga olindi",
  TENANT_UPDATE: "Korxona ma'lumoti o'zgardi",
  TENANT_SUSPEND: "Korxona to'xtatildi",
  TENANT_RESUME: "Korxona qayta yoqildi",
  DIRECTOR_SET: "Direktor login/paroli berildi",
  SSO: "Korxonaga kirdi (SSO)",
  ADMIN_LOGIN: "Panelga kirdi",
  ADMIN_CREATE: "Superadmin qo'shildi",
  ADMIN_TOGGLE: "Superadmin bloklandi/yoqildi",
  ADMIN_PASSWORD: "Superadmin paroli almashdi",
};
