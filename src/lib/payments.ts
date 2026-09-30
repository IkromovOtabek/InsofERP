import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { money } from "@/lib/format";
import { notifyAfter, notifyRoles } from "@/lib/notify";

/**
 * To'lov qabul qilish — yagona joy (veb kassa sahifasi ham, mobil ilova ham shu yerdan).
 * Schyot ko'rsatilsa uning holati qayta hisoblanadi; zayavkaning hamma schyoti yopilsa — zayavka CLOSED.
 */
export type PaymentInput = {
  customerId: string;
  invoiceId?: string | null;
  cashAccountId: string;
  amount: number;
  date: Date;
  note?: string | null;
};

class PaymentError extends Error {}

/** Bir xil to'lov shu oraliqda qayta kelsa — ikki marta bosilgan deb hisoblanadi. */
const DUPLICATE_WINDOW_MS = 60_000;

export async function addPayment(input: PaymentInput, userId: string): Promise<{ id?: string; invoiceStatus?: string; error?: string }> {
  if (!(input.amount > 0)) return { error: "Summa 0 dan katta bo'lsin" };
  const res = await db.$transaction(async (tx) => {
    // Mijoz bo'yicha navbat: bir vaqtdagi ikki to'lov qoldiqni ham, dublikatni ham to'g'ri ko'rsin
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.customerId}))`;
    const acc = await tx.cashAccount.findUnique({ where: { id: input.cashAccountId }, select: { isActive: true } });
    if (!acc?.isActive) throw new PaymentError("Kassa/hisob topilmadi yoki yopilgan");
    if (input.invoiceId) {
      // Schyot shu mijozniki, ochiq va summa qoldiqdan oshmasin (mobil ilovadagi qoida bilan bir xil).
      // Aks holda A mijozning puli B ning schyotini yopishi yoki bekor qilingan schyot qayta "to'landi" bo'lishi mumkin edi.
      const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { payments: { select: { amount: true } } } });
      if (!inv) throw new PaymentError("Schyot topilmadi");
      if (inv.customerId !== input.customerId) throw new PaymentError("Schyot boshqa mijozniki");
      if (!["OPEN", "PARTIAL"].includes(inv.status)) throw new PaymentError("Bu schyot yopilgan yoki bekor qilingan");
      const left = Number(inv.amount) - inv.payments.reduce((x, y) => x + Number(y.amount), 0);
      if (input.amount > left + 0.005) throw new PaymentError(`Qoldiqdan ko'p: ${money(left)}`);
    }
    const dup = await tx.payment.findFirst({
      where: {
        customerId: input.customerId, invoiceId: input.invoiceId ?? null, cashAccountId: input.cashAccountId,
        amount: input.amount, createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
      },
      select: { id: true },
    });
    if (dup) throw new PaymentError("Aynan shu to'lov hozirgina yozildi — ikki marta bosilgan bo'lishi mumkin. Rostdan ikkinchi to'lov bo'lsa, bir daqiqadan keyin qayta kiriting");
    const p = await tx.payment.create({
      data: {
        customerId: input.customerId,
        invoiceId: input.invoiceId ?? undefined,
        cashAccountId: input.cashAccountId,
        amount: input.amount,
        date: input.date,
        note: input.note ?? undefined,
      },
    });
    await audit(tx, userId, "CREATE", "Payment", p.id, undefined, p);

    if (!input.invoiceId) return { id: p.id };

    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId }, include: { payments: true } });
    const paid = inv.payments.reduce((x, y) => x + Number(y.amount), 0);
    const status = paid >= Number(inv.amount) - 0.005 ? "PAID" : paid > 0 ? "PARTIAL" : "OPEN";
    await tx.invoice.update({ where: { id: inv.id }, data: { status } });
    if (status === "PAID" && inv.orderId) {
      const others = await tx.invoice.count({ where: { orderId: inv.orderId, status: { in: ["OPEN", "PARTIAL"] } } });
      if (others === 0) await tx.order.updateMany({ where: { id: inv.orderId, status: "DELIVERED" }, data: { status: "CLOSED" } });
    }
    return { id: p.id, invoiceStatus: status };
  }).catch((e: Error) => { if (e instanceof PaymentError) return { error: e.message }; throw e; });
  if ("error" in res) return res;

  // To'lov mijozning limitini bo'shatadi — sotuv va buxgalteriya buni kutib turadi
  notifyAfter(async () => {
    const c = await db.customer.findUnique({ where: { id: input.customerId }, select: { name: true } });
    await notifyRoles(["SALES", "ACCOUNTING"], {
      type: "PAYMENT_RECEIVED",
      title: `To'lov: ${money(input.amount)}`,
      body: `${c?.name ?? "Mijoz"}${res.invoiceStatus === "PAID" ? " · schyot yopildi" : ""}`,
      link: input.invoiceId ? { key: "invoices", id: input.invoiceId } : undefined,
      channel: "oddiy",
    }, { except: userId });
  });
  return res;
}
