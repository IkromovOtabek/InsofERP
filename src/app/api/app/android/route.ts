import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { apkResponse } from "@/lib/apk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/app/android — mobil ilovaning APK fayli (ERP yon menyusidagi tugma).
 *
 * Login talab qiladi: middleware ham bu yo'lni himoyalaydi, bu yerdagi tekshiruv esa ikkinchi
 * qulf — sessiyasiz so'rov 401 oladi, /login ga yo'naltirilmaydi. Ommaviy saytdagi tugma
 * `/api/public/app/android` dan oladi.
 */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Avval tizimga kiring" }, { status: 401 });
  return apkResponse();
}
