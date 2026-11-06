import { PencilLine } from "lucide-react";
import { dateTime } from "@/lib/format";
import type { LastEdit } from "@/lib/audit";

/**
 * «Tahrirlangan» belgisi — yozuv ochilgandan keyin o'zgartirilgan (`lastEdits`, AuditLog).
 * `full` — kim va qachon matn bilan (detal sahifasi); aks holda ixcham belgi, kim/qachon — sichqoncha ustida.
 */
export function EditedMark({ edit, full }: { edit?: LastEdit | null; full?: boolean }) {
  if (!edit) return null;
  const who = `${edit.by} · ${dateTime(edit.at)}`;
  return (
    <span title={`Tahrirlangan: ${who}`} className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-px text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
      <PencilLine size={11} /> Tahrirlangan{full && <span className="font-normal text-sky-600">— {who}</span>}
    </span>
  );
}
