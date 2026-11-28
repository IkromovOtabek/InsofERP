import { getSession } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { pbxEnabled } from "@/lib/pbx/onlinepbx";
import { CrmNav } from "./crm-nav";
import { LiveCall } from "./live-call";

/** Sotuv CRM qobig'i: bo'lim menyusi; telefonda pastki menyu uchun joy qoldiriladi. Telefoniya ulangan bo'lsa — kiruvchi qo'ng'iroq oynasi. */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const calls = !!s && canDo(s, "crm", "calls");
  return (
    <div className="pb-20 lg:pb-0">
      <CrmNav callCenter={calls} />
      {children}
      {calls && pbxEnabled() && <LiveCall />}
    </div>
  );
}
