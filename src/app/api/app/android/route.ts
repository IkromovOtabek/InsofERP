import { createReadStream } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { APK_PATH, apkInfo } from "@/lib/apk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/app/android — mobil ilovaning APK fayli.
 *
 * Login talab qiladi: ilova zavod xodimlari va biriktirilgan haydovchilar uchun,
 * ochiq havolada turmasligi kerak. Middleware ham bu yo'lni himoyalaydi, bu yerdagi
 * tekshiruv esa ikkinchi qulf — sessiyasiz so'rov 401 oladi, /login ga yo'naltirilmaydi.
 *
 * Fayl oqim bilan uzatiladi: 35 MB ni xotiraga to'liq yuklash serverni band qilardi.
 */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Avval tizimga kiring" }, { status: 401 });

  const info = await apkInfo();
  if (!info.exists) {
    return NextResponse.json({ error: "Ilova fayli serverga hali yuklanmagan" }, { status: 404 });
  }

  const name = `insof-eco-${info.updatedAt.toISOString().slice(0, 10)}.apk`;
  const stream = Readable.toWeb(createReadStream(APK_PATH)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
