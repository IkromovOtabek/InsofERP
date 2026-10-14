import type { PayMethod } from "@/generated/prisma";
import { db } from "@/lib/db";
import { payReqWhere } from "@/lib/payment-requests";

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * «Pul qabul qilish» qisqacha ko'rsatkichlari — bo'lim sahifasi va kassir/buxgalter bosh sahifasi bitta manbadan:
 * ochiq so'rovlar (soni, kutilayotgan summa), muddati o'tganlar, bugun qabul qilingan pul.
 * «Bugun qabul qilingan» — bugun tizimga kiritilgan, shu usuldagi so'rovli zayavkaga (avans yoki schyot) tushgan to'lovlar.
 */
export async function payReqSummary(methods: PayMethod[]) {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const byMethod = { payRequest: { method: { in: methods } } };
  const [open, overdue, today] = await Promise.all([
    db.paymentRequest.aggregate({ where: payReqWhere("open", methods), _count: { _all: true }, _sum: { amount: true, received: true } }),
    db.paymentRequest.aggregate({ where: payReqWhere("overdue", methods), _count: { _all: true }, _sum: { amount: true, received: true } }),
    db.payment.aggregate({
      where: { createdAt: { gte: dayStart, lt: dayEnd }, OR: [{ order: byMethod }, { invoice: { order: byMethod } }] },
      _count: { _all: true }, _sum: { amount: true },
    }),
  ]);
  const left = (a: typeof open) => r2(Math.max(0, Number(a._sum.amount ?? 0) - Number(a._sum.received ?? 0)));
  return {
    open: { n: open._count._all, left: left(open) },
    overdue: { n: overdue._count._all, left: left(overdue) },
    today: { n: today._count._all, sum: r2(Number(today._sum.amount ?? 0)) },
  };
}
