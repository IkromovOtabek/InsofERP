import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const dev = process.env.NODE_ENV === "development";
  const client = new PrismaClient({
    log: [{ emit: "event", level: "error" }, ...(dev ? [{ emit: "event" as const, level: "warn" as const }] : [])],
  });
  // Unique kalit to'qnashuvi (P2002) — idempotentlik (clientToken, ikki marta bosish, parallel import) uchun
  // KUTILGAN holat: chaqiruvchi uni ushlab, mavjud yozuvni qaytaradi. Prisma esa har birini `prisma:error` qilib
  // jurnalga yozardi — haqiqiy xatolar shovqin ichida yo'qolardi. Ushlanmagan P2002 baribir Next jurnaliga
  // (500 bilan) tushadi, shuning uchun bu yerda faqat Prisma'ning takror yozuvi o'tkazib yuboriladi.
  client.$on("error", (e) => {
    if (/Unique constraint failed/i.test(e.message)) return;
    console.error("prisma:error", e.message);
  });
  if (dev) client.$on("warn", (e) => console.warn("prisma:warn", e.message));
  return client;
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
