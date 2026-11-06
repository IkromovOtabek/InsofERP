import { db } from "@/lib/db";
import { requireRoles } from "@/lib/page-guard";
import { Callout, Card, Field, PageHeader, Select } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { dateRu } from "@/lib/format";
import { categoryOptions } from "@/lib/fin-report/categories";
import { PEREKIT_CATEGORY } from "@/lib/cash-categories";
import { SALES_MANBA } from "@/lib/cash-import";
import { importCashJournalFromExcel } from "../actions";

/**
 * Kassa / bank → «Excel orqali qo'shish»: Kassa jurnali ustunlaridagi fayl (Sana, Hisob, Kirim, Chiqim, Manba, Sub manba,
 * Kontragent, Izoh) — har qator Kirim-Chiqim formasidagi kabi qo'lda kirim yoki chiqim bo'lib yoziladi (`lib/cash-import.ts`).
 * Hisob va Manba qiymatlari tizimdagi hisob / kategoriyaga moslanadi.
 */
export default async function CashJournalImport() {
  await requireRoles(["CASHIER", "ACCOUNTING", "FINANCE"], { module: "payments", actions: ["import"] });
  const [accounts, incomeCats, expenseCats] = await Promise.all([
    db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } }),
    categoryOptions("INCOME"),
    categoryOptions("EXPENSE"),
  ]);
  const kind = (t: string) => (t === "CASH" ? "naqd" : "bank");
  // Namuna qatori — korxonaning o'z kategoriyalaridan (sub manbasi bor chiqim manbasi)
  const exCat = expenseCats.find((c) => c.subs.length && !c.needs) ?? expenseCats.find((c) => !c.needs);
  const exAcc = accounts.find((a) => a.type === "CASH") ?? accounts[0];

  return (
    <div>
      <PageHeader
        back={{ href: "/payments?tab=kassa", label: "Kassa / bank" }}
        title="Excel orqali qo'shish"
        subtitle="Kassa jurnali ustunlaridagi faylni yuklang: Sana, Hisob, Kirim, Chiqim, Manba, Sub manba, Kontragent, Izoh. Har qator kirim yoki chiqim bo'lib Kassa jurnaliga tushadi."
      />
      <Card className="max-w-6xl">
        {accounts.length === 0 ? (
          <Callout tone="warning" title="Kassa/hisob yo'q">
            Avval Sozlamalar → «Kassa va hisoblar» bo&apos;limida kamida bitta kassa yoki bank hisobini oching.
          </Callout>
        ) : (
          <ExcelImport
            action={importCashJournalFromExcel}
            submitLabel="Kassa jurnaliga qo'shish"
            templateName="kassa-jurnali-namuna"
            example={{
              date: dateRu(new Date()), account: exAcc.name, inc: "", exp: 250000,
              manba: exCat?.name ?? "", sub: exCat?.subs[0] ?? "", who: "Nomi / F.I.O.", note: "Nima uchun",
            }}
            fields={[
              { key: "date", label: "Sana", required: true, synonyms: ["sana", "сана", "дата", "date", "число"] },
              {
                key: "account", label: "Hisob", hint: "bo'sh bo'lsa — pastda tanlangan hisob", synonyms: ["hisob", "ҳисоб", "хисоб", "счёт", "счет", "касса", "kassa", "account"],
                valueMap: {
                  options: accounts.map((a) => ({ value: a.name, label: `${a.name} (${kind(a.type)})` })),
                  newLabel: "Topilmadi",
                  note: "Fayldagi hisob nomi tizimdagi kassa / bank hisobiga moslanadi. Moslanmagan nom bilan import to'xtaydi.",
                },
              },
              { key: "inc", label: "Kirim", hint: "so'm; kirim bo'lsa", synonyms: ["kirim", "кирим", "приход", "поступ", "доход", "income"] },
              { key: "exp", label: "Chiqim", hint: "so'm; chiqim bo'lsa", synonyms: ["chiqim", "чиқим", "чиким", "расход", "выдач", "expense"] },
              {
                key: "manba", label: "Manba", required: true, hint: "kategoriya", synonyms: ["manba", "манба", "kategoriya", "категор", "статья", "источник"],
                valueMap: {
                  options: [
                    ...incomeCats.map((c) => ({ value: c.name, label: c.name, group: "Kirim manbalari" })),
                    ...expenseCats.map((c) => ({ value: c.name, label: c.name, group: "Chiqim manbalari" })),
                  ],
                  newLabel: "Nomidan aniqlanadi",
                  note: `Manba tizimdagi kategoriyaga moslanadi; sub manba nomi yozilgan bo'lsa o'z manbasi topiladi. «${SALES_MANBA}» va «${PEREKIT_CATEGORY}» qatorlari yozilmaydi — jurnalda bor bo'lsa o'tkaziladi.`,
                },
              },
              { key: "sub", label: "Sub manba", hint: "shu manbaniki bo'lsin", synonyms: ["sub manba", "sub", "подкатег", "подстат"] },
              { key: "who", label: "Kontragent", hint: "kimdan / kimga", synonyms: ["kontragent", "контрагент", "kimdan", "kimga", "кимдан", "кимга", "получател", "плательщ"] },
              { key: "note", label: "Izoh", synonyms: ["izoh", "изох", "изоҳ", "примеч", "коммент", "назначен", "note"] },
            ]}
          >
            <Field label="Hisob ustuni bo'sh qatorlar qaysi hisobga *" className="max-w-sm">
              <Select name="cashAccountId" defaultValue={exAcc.id} required>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({kind(a.type)})</option>)}
              </Select>
            </Field>
            <p className="text-xs text-slate-500">
              Har qatorda Kirim yoki Chiqim summasidan bittasi to&apos;ldiriladi. Kassa jurnalida bor qator (kun, hisob, summa, manba bir xil) qayta yozilmaydi —
              jurnalning o&apos;zidan yuklab olingan faylni ham yuklash mumkin. Kredit va loyiha manbalari Kirim-Chiqim formasida kiritiladi.
              Naqd kassa minusga tushsa yoki biror qatorda xato bo&apos;lsa hech narsa yozilmaydi. Noto&apos;g&apos;ri yozuv Kirim-Chiqim jadvalida sabab bilan bekor qilinadi.
            </p>
          </ExcelImport>
        )}
      </Card>
    </div>
  );
}
