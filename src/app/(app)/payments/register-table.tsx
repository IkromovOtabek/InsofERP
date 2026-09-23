import { CustomerName } from "@/components/customer-name";
import { Empty, Table, Td, Th, Tr } from "@/components/ui";
import { fmtNum, money, date as fmtDate } from "@/lib/format";
import { payKindLabel } from "@/lib/sales-register";
import type { CustomerMarks } from "@/lib/finance";

/**
 * Realizatsiya jurnali jadvali — Excel'dagi ustunlar o'z tartibida.
 * Ham Kassa/bank sahifasida (hamma mijozlar), ham mijoz sahifasida ishlatiladi.
 */
export type RegisterView = {
  id: string;
  date: Date;
  customerId: string;
  customerName: string;
  vehicleNo: string | null;
  ttn: string | null;
  productName: string;
  unit: string;
  qty: number;
  fromWho: string | null;
  payType: string | null;
  deliveryFee: number;
  price: number;
  sum: number;
  nds: number;
  total: number;
  address: string | null;
  contractNo: string | null;
  invoiceNo: string | null;
  monthNo: string | null;
  note: string | null;
};

type Dec = { toString(): string };
type DbRow = {
  id: string; date: Date; customerId: string; vehicleNo: string | null; ttn: string | null; productName: string;
  unit: string; qty: Dec; fromWho: string | null; payType: string | null; deliveryFee: Dec; price: Dec; sum: Dec;
  nds: Dec; total: Dec; address: string | null; contractNo: string | null; invoiceNo: string | null;
  monthNo: string | null; note: string | null;
  customer: { name: string };
};

/** Prisma qatori → jadval qatori (Decimal'lar raqamga aylantiriladi). */
export function toView(r: DbRow): RegisterView {
  return {
    id: r.id, date: r.date, customerId: r.customerId, customerName: r.customer.name,
    vehicleNo: r.vehicleNo, ttn: r.ttn, productName: r.productName, unit: r.unit, qty: Number(r.qty),
    fromWho: r.fromWho, payType: r.payType, deliveryFee: Number(r.deliveryFee), price: Number(r.price),
    sum: Number(r.sum), nds: Number(r.nds), total: Number(r.total), address: r.address,
    contractNo: r.contractNo, invoiceNo: r.invoiceNo, monthNo: r.monthNo, note: r.note,
  };
}

const dash = <span className="text-slate-300">—</span>;

export function RegisterTable({ rows, marks, showCustomer = true }: { rows: RegisterView[]; marks?: CustomerMarks; showCustomer?: boolean }) {
  const t = rows.reduce((a, r) => ({ qty: a.qty + r.qty, delivery: a.delivery + r.deliveryFee, sum: a.sum + r.sum, nds: a.nds + r.nds, total: a.total + r.total }),
    { qty: 0, delivery: 0, sum: 0, nds: 0, total: 0 });

  return (
    // 19 ta ustun — kataklar satr bo'ylab bo'linib ketmasin: jadval yonga suriladi (Excel'dagidek)
    <Table className="[&_td]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2 [&_th]:whitespace-nowrap [&_th]:px-3">
      <thead>
        <tr>
          <Th>Sana</Th>
          <Th>Mashina №</Th>
          <Th>Mahsulot</Th>
          <Th>TTN</Th>
          <Th>Birlik</Th>
          <Th right>Miqdor</Th>
          <Th>Kimdan</Th>
          {showCustomer && <Th>Mijoz</Th>}
          <Th>Deniga</Th>
          <Th right>Dostavka</Th>
          <Th right>Narx</Th>
          <Th right>Summa</Th>
          <Th right>NDS</Th>
          <Th right>Itogo</Th>
          <Th>Manzil</Th>
          <Th>Shartnoma</Th>
          <Th>Schyot</Th>
          <Th>Oy</Th>
          <Th>Izoh</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <Empty text="Jurnalda qator yo'q" />}
        {rows.map((r) => (
          <Tr key={r.id}>
            <Td>{fmtDate(r.date)}</Td>
            <Td>{r.vehicleNo || dash}</Td>
            <Td>{r.productName}</Td>
            <Td>{r.ttn || dash}</Td>
            <Td className="text-slate-500">{r.unit}</Td>
            <Td right>{fmtNum(r.qty, 3)}</Td>
            <Td className="text-slate-500">{r.fromWho || dash}</Td>
            {showCustomer && (
              <Td>
                {/* Mijoz nomi — bosilsa o'sha mijozning barcha qatorlari alohida sahifada */}
                <CustomerName name={r.customerName} blacklisted={!!marks?.black.has(r.customerId)} contracted={!!marks?.contract.has(r.customerId)} href={`/payments/mijoz/${r.customerId}`} short />
              </Td>
            )}
            <Td className="text-slate-500">{payKindLabel(r.payType)}</Td>
            <Td right>{r.deliveryFee ? fmtNum(r.deliveryFee) : dash}</Td>
            <Td right>{fmtNum(r.price)}</Td>
            <Td right>{fmtNum(r.sum)}</Td>
            <Td right>{r.nds ? fmtNum(r.nds) : dash}</Td>
            <Td right className="bg-emerald-50/60 font-semibold text-emerald-800">{fmtNum(r.total)}</Td>
            <Td className="max-w-56 truncate text-slate-500"><span title={r.address ?? undefined}>{r.address || dash}</span></Td>
            <Td className="text-slate-500">{r.contractNo || dash}</Td>
            <Td className="text-slate-500">{r.invoiceNo || dash}</Td>
            <Td className="text-slate-500">{r.monthNo || dash}</Td>
            <Td className="max-w-56 truncate text-slate-500"><span title={r.note ?? undefined}>{r.note || dash}</span></Td>
          </Tr>
        ))}
      </tbody>
      {rows.length > 0 && (
        <tfoot>
          <tr className="bg-slate-50">
            <Td colSpan={5} className="font-semibold text-slate-900">Jami · {rows.length} ta qator</Td>
            <Td right className="font-semibold">{fmtNum(t.qty, 3)}</Td>
            <Td colSpan={showCustomer ? 3 : 2} />
            <Td right className="font-semibold">{t.delivery ? fmtNum(t.delivery) : ""}</Td>
            <Td />
            <Td right className="font-semibold">{fmtNum(t.sum)}</Td>
            <Td right className="font-semibold">{fmtNum(t.nds)}</Td>
            <Td right className="bg-emerald-50 font-semibold text-emerald-800">{money(t.total)}</Td>
            <Td colSpan={5} />
          </tr>
        </tfoot>
      )}
    </Table>
  );
}
