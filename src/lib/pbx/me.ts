import { db } from "@/lib/db";
import { pbxEnabled } from "./onlinepbx";

/** Joriy xodim onlinePBX orqali qo'ng'iroq qila oladimi (telefoniya ulangan va ichki raqami bor) */
export async function canPbxCall(userId: string): Promise<boolean> {
  if (!pbxEnabled()) return false;
  const u = await db.user.findUnique({ where: { id: userId }, select: { pbxExt: true } });
  return !!u?.pbxExt;
}

/** Soniya → «2:05» */
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
