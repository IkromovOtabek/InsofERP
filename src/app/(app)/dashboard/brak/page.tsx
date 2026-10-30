import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { requirePage } from "@/lib/page-guard";
import { db } from "@/lib/db";
import { productionDay, PRODUCTION_HOME_ROLES } from "@/lib/production-day";
import { fmtUnitTotals } from "@/lib/unit";
import { fmtNum } from "@/lib/format";
import { today } from "@/lib/davomat";
import { LinkButton, PageHeader } from "@/components/ui";
import { BrakSection } from "../brak-section";

/**
 * Brak — ishlab chiqarish bosh sahifasidagi «Brak» kartasidan ochiladi (avval bosh sahifaning o'zida edi):
 * yozish, oy yozuvlari, brak ulushi va sabablar. Kunlik / brigada bo'yicha hisob va summani tahrirlash — Brigadalar → «Brak».
 */
export default async function BrakPage() {
  const s = await requirePage("/dashboard");
  if (s.role !== "DIRECTOR" && !(PRODUCTION_HOME_ROLES as readonly string[]).includes(s.role)) redirect("/dashboard?denied=1");
  const [d, brigades] = await Promise.all([
    productionDay(today()),
    db.brigade.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const isDirector = s.role === "DIRECTOR";
  const todayText = d.defects.today.length ? fmtUnitTotals(d.defects.today.map((r) => ({ unit: r.product.unit, qty: r.qty }))) : "0";
  return (
    <div>
      <PageHeader
        back={{ href: isDirector ? "/dashboard?view=production" : "/dashboard", label: "Bosh sahifa" }}
        eyebrow="Ishlab chiqarish"
        title="Brak"
        subtitle={`Bugun: ${todayText} · oyda ${d.defects.month.length} ta yozuv · ${fmtNum(d.defects.month.reduce((x, r) => x + r.amount, 0))} so'm`}
        action={<LinkButton href="/brigades?tab=brak" variant="secondary"><CalendarDays size={16} /> Kunlik, brigada bo&apos;yicha</LinkButton>}
      />
      <BrakSection d={d} brigades={brigades} userId={s.userId} isDirector={isDirector} />
    </div>
  );
}
