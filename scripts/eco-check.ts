/** Qo'lda tekshirish: ERP haydovchilari va texnikasi ECO bilan qanday bog'langan. `npx tsx scripts/eco-check.ts` */
import { db } from "@/lib/db";

async function main() {
  const rows = await db.employee.findMany({
    where: { position: { equals: "Haydovchi", mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { fullName: true, phone: true, isActive: true, ecoUserId: true, ecoActive: true, ecoError: true },
  });
  console.table(rows.map((r) => ({ ...r, eco: r.ecoUserId?.slice(-6) ?? null, ecoUserId: undefined })));
  console.log("Jami haydovchi:", rows.length, "· ECO'ga ulangan:", rows.filter((r) => r.ecoUserId).length);
  const v = await db.vehicle.findMany({ select: { plate: true, type: true, capacityM3: true, isActive: true, ecoVehicleId: true, ecoError: true } });
  console.table(v.map((x) => ({ ...x, capacityM3: Number(x.capacityM3 ?? 0), eco: x.ecoVehicleId?.slice(-6) ?? null, ecoVehicleId: undefined })));
  await db.$disconnect();
}
void main();
