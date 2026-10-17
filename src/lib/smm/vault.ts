/**
 * Ijtimoiy tarmoq tokenlarini bazada shifrlab saqlash (AES-256-GCM).
 * Kalit AUTH_SECRET dan HKDF bilan olinadi (alohida maqsad — boshqa joyda ishlatilmaydi).
 * AUTH_SECRET almashtirilsa, saqlangan tokenlar o'qilmaydi — profillarni qayta ulash kerak bo'ladi.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { authSecret } from "@/lib/secret";

/**
 * Maqsad bo'yicha alohida kalit: bir modulning shifri boshqasida ochilmaydi (amoCRM tokenlari — `lib/amocrm/store.ts`).
 */
export function makeVault(salt: string, info: string) {
  const key = () => Buffer.from(hkdfSync("sha256", authSecret(), salt, info, 32));
  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key(), iv);
      const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
    },
    /** Shifrni ochish; buzilgan yoki boshqa kalit bilan yozilgan bo'lsa — null */
    unseal(sealed: string | null | undefined): string | null {
      if (!sealed) return null;
      const [v, iv, tag, ct] = sealed.split(".");
      if (v !== "v1" || !iv || !tag || !ct) return null;
      try {
        const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
        d.setAuthTag(Buffer.from(tag, "base64url"));
        return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
      } catch {
        return null;
      }
    },
  };
}

const smm = makeVault("insof-smm", "smm-token-vault-v1");
export const seal = smm.seal;
export const unseal = smm.unseal;
