import { requireAdmin } from "@/lib/control/auth";
import { loadMonitorSnapshot } from "@/lib/control/monitor/snapshot";
import type { MonitorSnapshot } from "@/lib/control/monitor/shared";
import { MonitoringView } from "./view";

export const metadata = { title: "Server va xizmatlar" };
export const dynamic = "force-dynamic";

/** Server va xizmatlar — birinchi holat serverda chiziladi, keyin SSE oqimi (useLiveMonitor) yangilaydi. */
export default async function MonitoringPage() {
  await requireAdmin(); // layout ham tekshiradi; sahifa o'zi ham himoyalangan bo'lsin (layout'siz render/qayta foydalanish)
  let initial: MonitorSnapshot | null = null;
  let loadError: string | undefined;
  try {
    initial = await loadMonitorSnapshot();
  } catch (e) {
    console.error("[monitoring] snapshot", e);
    loadError = (e as Error).message.split("\n").pop()?.slice(0, 200);
  }
  return <MonitoringView initial={initial} loadError={loadError} />;
}
