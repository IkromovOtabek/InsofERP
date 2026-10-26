"use client";

import { Children, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button, Table } from "@/components/ui";

/** "To'lanmagan kirimlar" jadvali: hammasi ko'rinadi, «Yig'ish» bosilsa birinchi `keep` qator qoladi.
 *  Qolganlari o'chirilmaydi, faqat yashiriladi — qatordagi to'lash formasiga yozilgan summa yo'qolmaydi.
 *  Har qator o'z <tbody> sida (jadvalda bir nechta tbody — to'g'ri HTML), shunda server qatorini o'zgartirmay yashiramiz. */
export function CollapsibleRows({ head, keep = 3, children }: { head: React.ReactNode; keep?: number; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const rows = Children.toArray(children);
  const hidden = rows.length - keep;
  return (
    <>
      <Table>
        <thead>{head}</thead>
        {rows.map((r, i) => <tbody key={i} className={collapsed && i >= keep ? "hidden" : undefined}>{r}</tbody>)}
      </Table>
      {hidden > 0 && (
        <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <><ChevronDown size={14} /> Hammasini ko&apos;rsatish ({hidden} ta yana)</> : <><ChevronUp size={14} /> Yig&apos;ish</>}
        </Button>
      )}
    </>
  );
}
