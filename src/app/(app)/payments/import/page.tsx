import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { Callout, Card, Checkbox, Field, PageHeader, Select } from "@/components/ui";
import { ExcelImport } from "@/components/excel-import";
import { FIELD_SYNONYMS } from "@/lib/excel";
import { importSalesRegisterFromExcel } from "../actions";

/**
 * Kassa/bank → "Excel orqali qo'shish": buxgalteriya kunlik jo'natma jadvali
 * (Число, № маш, Наименование, ТТН, К-во, Кому, Деньги, Цена, НДС, Итого Сумма…) jurnalga tushadi.
 * Ustun nomlari rus/o'zbek aralash bo'lishi mumkin — mos ustun o'zi topiladi, keyin tekshirib tuzatiladi.
 */
export default async function SalesRegisterImport() {
  await requireSession(["CASHIER", "ACCOUNTING", "FINANCE"]);
  const accounts = await db.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const cash = accounts.filter((a) => a.type === "CASH");
  const bank = accounts.filter((a) => a.type === "BANK");

  return (
    <div>
      <PageHeader
        back={{ href: "/payments?tab=jurnal", label: "Kassa / bank" }}
        title="Excel orqali qo'shish"
        subtitle="Kunlik realizatsiya jadvalini yuklang — har qator jurnalga tushadi va «Деньги» ustuniga qarab pul naqd kassaga (н-к) yoki bank hisobiga (п-р) kirim bo'lib yoziladi."
      />
      <Card className="max-w-6xl">
        {accounts.length === 0 ? (
          <Callout tone="warning" title="Kassa/hisob yo'q">
            Avval Sozlamalar → «Kassa va hisoblar» bo&apos;limida kamida bitta naqd kassa va bitta bank hisobini oching.
          </Callout>
        ) : (
          <ExcelImport
            action={importSalesRegisterFromExcel}
            submitLabel="Jurnalga qo'shish"
            templateName="realizatsiya-namuna"
            example={{
              date: "01.05.2026", vehicleNo: "537", productName: "Beton M250", ttn: "1", unit: "m3", qty: 10,
              fromWho: "INSOF", customer: "Sam Golden Firm", payType: "п-р", deliverySum: 0, price: 508928.57,
              sum: 5089286, nds: 610714, totalSum: 5700000, address: "Yangiyo'l", contractNo: "1", invoiceNo: "6", monthNo: "1", note: "",
            }}
            fields={[
              { key: "date", label: "Sana (Число)", required: true, synonyms: ["число", "sana", "дата", "date", "kun"] },
              { key: "vehicleNo", label: "Mashina №", hint: "№ маш", synonyms: ["№ маш", "маш", "машина", "mashina", "avto", "транспорт", "gos"] },
              { key: "productName", label: "Mahsulot (Наименование)", required: true, synonyms: ["наимен", "nomi", ...FIELD_SYNONYMS.product] },
              { key: "ttn", label: "TTN", hint: "nakladnoy raqami", synonyms: ["ттн", "ttn", "накладн", "nakladnoy"] },
              { key: "unit", label: "Birlik (Ед Изм)", synonyms: FIELD_SYNONYMS.unit },
              { key: "qty", label: "Miqdor (К-во)", required: true, synonyms: FIELD_SYNONYMS.qty },
              { key: "fromWho", label: "Kimdan (От Кого)", synonyms: ["от кого", "от ково", "ково", "кого", "kimdan", "yuboruvchi"] },
              { key: "customer", label: "Mijoz (Кому)", required: true, hint: "shu nom bo'yicha mijoz topiladi", synonyms: ["кому", "mijoz", "клиент", "покупател", "заказчик", "xaridor", "kimga", "mijoz nomi"] },
              { key: "payType", label: "Deniga (п-р / н-к)", hint: "п-р → bank, н-к → naqd", synonyms: ["деньги", "деньга", "оплата", "to'lov", "tolov", "pul", "naqd"] },
              { key: "deliverySum", label: "Dostavka", hint: "summaga qo'shilgan bo'lsa ham qoladi", synonyms: ["доставка", "dostavka", "yetkazish", "yetkazib"] },
              { key: "price", label: "Narx (Цена)", synonyms: FIELD_SYNONYMS.price },
              { key: "sum", label: "Umumiy summa", hint: "bo'sh bo'lsa: miqdor × narx + dostavka", synonyms: ["общие сумма", "общая сумма", "общие", "общая", "сумма", "summa"] },
              { key: "nds", label: "NDS 12%", synonyms: FIELD_SYNONYMS.nds },
              { key: "totalSum", label: "Itogo summa", hint: "kassaga shu summa tushadi", synonyms: ["итого", "jami", "итог", "всего"] },
              { key: "address", label: "Manzil (Адрес)", synonyms: ["адрес", "manzil", "address", "obyekt"] },
              { key: "contractNo", label: "Shartnoma №", synonyms: ["договор", "shartnoma", "контракт", "dogovor"] },
              { key: "invoiceNo", label: "Schyot-faktura", synonyms: ["счёт фактура", "счет фактура", "фактура", "счёт", "счет", "schyot", "faktura", "invoice"] },
              { key: "monthNo", label: "Oy (Ой)", synonyms: ["ой", "месяц", "oy"] },
              { key: "note", label: "Izoh (Изох)", synonyms: ["изох", "izoh", "примеч", "коммент", "tavsif"] },
            ]}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Naqd (н-к) qaysi kassaga *" hint="«Деньги» ustunida н-к bo'lgan qatorlar">
                <Select name="cashAccountId" defaultValue={(cash[0] ?? accounts[0]).id} required>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "CASH" ? "naqd" : "bank"})</option>)}
                </Select>
              </Field>
              <Field label="O'tkazma (п-р) qaysi hisobga *" hint="п-р / перечисление qatorlari">
                <Select name="bankAccountId" defaultValue={(bank[0] ?? accounts[0]).id} required>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type === "CASH" ? "naqd" : "bank"})</option>)}
                </Select>
              </Field>
              <Field label="Sana tartibi" hint="«1/5/26» qanday o'qilsin">
                <Select name="dateOrder" defaultValue="dmy">
                  <option value="dmy">Kun / Oy / Yil — 1-may</option>
                  <option value="mdy">Oy / Kun / Yil — 5-yanvar</option>
                </Select>
              </Field>
            </div>
            <div className="space-y-2">
              <Checkbox name="toCash" defaultChecked label="Har qator summasi («Итого Сумма») kassaga kirim qilib yozilsin — kassa qoldig'i shunga qarab o'zgaradi" />
              <Checkbox name="createMissing" defaultChecked label="Ro'yxatda yo'q mijozlarni avtomatik yaratish" />
            </div>
            <p className="text-xs text-slate-500">
              Xato yuklansa — jurnaldagi «Import partiyasi» yonidagi tugma bilan butun partiyani qaytarib olasiz: qatorlar ham, ular yozgan kirimlar ham o&apos;chadi.
            </p>
          </ExcelImport>
        )}
      </Card>
    </div>
  );
}
