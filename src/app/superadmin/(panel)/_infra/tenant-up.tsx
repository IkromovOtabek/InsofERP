import { control } from "@/lib/control/db";
import { domainAllowed, domainPolicyFromEnv } from "@/lib/control/infra/contract";
import { toActionView } from "@/lib/control/monitor/snapshot";
import { ActionButton } from "../_monitor/action-dialog";
import { ActionOutput, ActionStatusBadge, Ago } from "../_monitor/bits";
import { InfraRefresh } from "./client";

/**
 * Korxona sahifasida: «Serverda ishga tushirish» (TENANT_UP) tugmasi va oxirgi urinish natijasi.
 * Agent root egaligidagi /usr/local/sbin/insof-tenant-up ni chaqiradi (systemd, health, nginx, certbot).
 */
export async function TenantUpPanel({ slug, domain, compact }: { slug: string; domain: string | null; compact?: boolean }) {
  const last = await control.agentAction.findFirst({
    where: { type: "TENANT_UP", params: { path: ["slug"], equals: slug } },
    orderBy: { requestedAt: "desc" },
  });
  const a = last ? toActionView(last, new Map()) : null;
  const busy = a?.status === "PENDING" || a?.status === "RUNNING";
  const pol = domainPolicyFromEnv();
  const domainOk = !domain || domainAllowed(domain, pol.base, pol.list);
  return (
    <div className="space-y-2">
      <InfraRefresh keys={[]} types={["TENANT_UP"]} />
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton type="TENANT_UP" params={domain ? { slug, domain } : { slug }} icon="rocket" variant={compact ? "secondary" : "primary"}
          disabled={busy || !domainOk} label={busy ? "Ishga tushirilmoqda…" : compact ? "Serverda qayta sozlash" : "Serverda ishga tushirish"} />
        {a && <span className="flex items-center gap-2 text-sm"><ActionStatusBadge s={a.status} /> <Ago iso={a.finishedAt ?? a.requestedAt} /></span>}
      </div>
      {!domainOk && <p className="text-sm text-red-700">Domen <code>{domain}</code> ruxsat etilmagan: faqat {pol.base ? <code>*.{pol.base}</code> : "TENANT_BASE_DOMAIN ostida"} yoki control.env dagi TENANT_DOMAINS ro&apos;yxatida.</p>}
      {a?.output && <ActionOutput output={a.output} open={a.status === "FAILED" || a.status === "REJECTED"} />}
    </div>
  );
}
