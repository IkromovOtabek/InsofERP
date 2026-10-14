"use client";

import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/ui";
import { SupplierAdd, WithAdd } from "@/components/quick-add";

type Sup = { id: string; name: string; vatPayer: boolean; rate: number };

/**
 * Excel kirimidagi «Kimdan» — ichida «+» bilan. Tanlov boshqarilmaydigan (uncontrolled): skaner nakladnoydagi yetkazuvchini
 * DOM orqali qo'yadi. Yangi yetkazuvchi qo'shilgach u tanlanadi va `change` hodisasi qo'lda chiqariladi —
 * ExcelImport QQS oldindan ko'rishni shu hodisa bilan qayta hisoblaydi (stavka — `data-vat-rate`).
 * `vatRate` — QQS to'lovchisi yetkazuvchining stavkasi (serverdagi `supplierVatRate` bilan bir xil).
 */
export function SupplierSelect({ suppliers: init, canAdd, vatRate }: { suppliers: Sup[]; canAdd: boolean; vatRate: number }) {
  const [list, setList] = useState(init);
  const box = useRef<HTMLSpanElement>(null);
  const pick = useRef<string | null>(null);
  useEffect(() => {
    const el = box.current?.querySelector("select");
    if (!pick.current || !el) return;
    el.value = pick.current;
    pick.current = null;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, [list]);

  return (
    <span ref={box} className="contents">
      <WithAdd add={canAdd && <SupplierAdd onCreated={(x) => {
        const vatPayer = x.vatPayer ?? true;
        setList((l) => [...l, { id: x.id, name: x.name, vatPayer, rate: vatPayer ? vatRate : 0 }].sort((a, b) => a.name.localeCompare(b.name)));
        pick.current = x.id;
      }} />}>
        <Select name="supplierId" defaultValue="" required>
          <option value="" disabled>Tanlang…</option>
          {list.map((s) => <option key={s.id} value={s.id} data-vat-rate={s.rate}>{s.name}{s.vatPayer ? "" : " (QQS'siz)"}</option>)}
        </Select>
      </WithAdd>
    </span>
  );
}
