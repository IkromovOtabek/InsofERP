import { requireMobileUser } from "@/lib/mobile/auth";
import { forgetDevice, registerDevice } from "@/lib/mobile/notifications";
import { handle, preflight } from "@/lib/mobile/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** PUT /api/mobile/devices — {deviceId, expoPushToken, platform} → push manzilini saqlaydi. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  return handle(async () => registerDevice(await requireMobileUser(req), body));
}

/** DELETE /api/mobile/devices?deviceId=... — chiqishda: bu telefonga endi xabar yuborilmaydi. */
export async function DELETE(req: Request) {
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  return handle(async () => forgetDevice(await requireMobileUser(req), { deviceId }));
}

export const OPTIONS = preflight;
