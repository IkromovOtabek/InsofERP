import Link from "next/link";
import { Undo2 } from "lucide-react";
import { getSession } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { recentCashImports, type CashImportBatch } from "@/lib/cash-import";
import { dateRu, dateTime } from "@/lib/format";
import { Card, CardHeader, Table, Td, Th, Tr } from "@/components/ui";
import { ConfirmButton } from "../confirm-button";
import { rollbackCashImportAction } from "./actions";

/** «YYYY-MM-DD» (partiya davri) — jadvaldagi sana ko'rinishida. */
const day = (s: string | null) => {
  const [y, m, d] = (s ?? "").split("-").map(Number);
  return y && m && d ? dateRu(new Date(y, m - 1, d)) : "—";
};

/** `goTo` — Kassa jurnalidagi import xabarida: qaytarilgach xabar (eski sonlar bilan) qolmasin, jurnal yangidan ochiladi. */
function UndoButton({ b, goTo }: { b: CashImportBatch; goTo?: string }) {
  return (
    <ConfirmButton
      action={rollbackCashImportAction.bind(null, b.id)}
      label="Importni qaytarish"
      icon={<Undo2 size={14} />}
      question={`${b.added} ta yozuv${b.transfers ? ` va ${b.transfers} ta o'tkazma` : ""}${b.newCats ? ", ishlatilmagan yangi manbalar" : ""} o'chirilsinmi?`}
      reason="required"
      okText="Import qaytarildi"
      className="h-8 px-2 text-sm"
      goTo={goTo}
    />
  );
}

/**
 * «Oxirgi importlar» (Excel orqali qo'shish sahifasi): hali qaytarilmagan partiyalar. Qaytarish tugmasi —
 * `cashflow.delete` bo'lsa har biriga, `payments.import` bilan faqat o'zi yuklaganiga.
 */
export async function RecentImports({ userId, canAny }: { userId: string; canAny: boolean }) {
  const list = await recentCashImports({ take: 10 });
  if (!list.length) return null;
  return (
    <Card className="mt-4 max-w-6xl">
      <div id="oxirgi" className="scroll-mt-20" />
      <CardHeader title="Oxirgi importlar"
        description="Noto'g'ri fayl butunligicha qaytariladi: yozuvlar, perekit o'tkazmalari va ishlatilmagan yangi manbalar o'chadi. Yuklangandan keyin tahrirlangan, bekor qilingan yoki hujjatga bog'langan yozuv bo'lsa — qaytarilmaydi" />
      <Table>
        <thead>
          <tr><Th>Qachon</Th><Th>Kim</Th><Th>Davr</Th><Th right>Yozuv</Th><Th right>O&apos;tkazma</Th><Th right>Yangi manba</Th><Th /></tr>
        </thead>
        <tbody>
          {list.map((b) => (
            <Tr key={b.id}>
              <Td className="whitespace-nowrap">{dateTime(b.at)}</Td>
              <Td>{b.by}{b.fileName && <div className="text-xs text-slate-500">{b.fileName}</div>}</Td>
              <Td className="whitespace-nowrap">{day(b.from)} — {day(b.to)}</Td>
              <Td right>{b.added}</Td>
              <Td right>{b.transfers || "—"}</Td>
              <Td right>{b.newCats || "—"}</Td>
              <Td>{(canAny || b.userId === userId) && <UndoButton b={b} />}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/**
 * Import xabari ostida (Kassa jurnali): shu foydalanuvchining hozirgina yuklagan importi — «Importni qaytarish».
 * Xabardagi sonlar mos kelmasa yoki 30 daqiqadan oshgan bo'lsa — «Oxirgi importlar» ro'yxatiga havola.
 */
export async function LastImportUndo({ added, transfers }: { added: number; transfers: number }) {
  const s = await getSession();
  if (!s || !(canDo(s, "cashflow", "delete") || canDo(s, "payments", "import"))) return null;
  const [last] = await recentCashImports({ take: 1, userId: s.userId });
  const fresh = last && Date.now() - last.at.getTime() < 30 * 60_000 && last.added === added && last.transfers === transfers ? last : null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {fresh ? <UndoButton b={fresh} goTo={`/payments?tab=kassa&from=${fresh.from ?? ""}&to=${fresh.to ?? ""}`} /> : (
        <Link href="/payments/import#oxirgi" className="text-sm font-medium underline">Noto&apos;g&apos;ri fayl bo&apos;lsa — Oxirgi importlar</Link>
      )}
    </div>
  );
}
