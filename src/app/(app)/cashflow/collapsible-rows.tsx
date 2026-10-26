"use client";

import { Children, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button, Table } from "@/components/ui";

/** "To'lanmagan kirimlar" jadvali: hammasi ko'rinadi, «Yig'ish» bosilsa birinchi `keep` qator qoladi.
 *  Qolganlari o'chirilmaydi, faqat yashiriladi — qatordagi to'lash formasiga yozilgan summa yo'qolmaydi.
 *  Har qator o'z <tbody> sida (jadvalda bir nechta tbody — to'g'ri HTML), shunda server qatorini o'zgartirmay yashiramiz.
 *  Tugma sarlavha qatorining o'ng burchagida turadi. */
export function CollapsibleRows({ title, intro, head, keep = 3, children }: { title: React.ReactNode; intro?: React.ReactNode; head: React.ReactNode; keep?: number; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const rows = Children.toArray(children);
  const hidden = rows.length - keep;
  return (
    <>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {hidden > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? <><ChevronDown size={14} /> Hammasini ko&apos;rsatish ({hidden} ta yana)</> : <><ChevronUp size={14} /> Yig&apos;ish</>}
          </Button>
        )}
      </div>
      {intro}
      <Table>
        <thead>{head}</thead>
        {rows.map((r, i) => <tbody key={i} className={collapsed && i >= keep ? "hidden" : undefined}>{r}</tbody>)}
      </Table>
    </>
  );
}
