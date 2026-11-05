import { requirePage } from "@/lib/page-guard";
import { canDo } from "@/lib/permissions";
import { PAY_GROUPS } from "@/lib/order-day-sheet";
import { Callout, Card, PageHeader } from "@/components/ui";
import { RealizationImport } from "./realization-import";

/** Logistika → Realizatsiya → «Excel'dan import»: varaqdagi jo'natmalar qo'lda qator bo'lib tushadi (`lib/realization-log.ts`). */
export default async function RealizatsiyaImportPage() {
  const s = await requirePage("/logistika/realizatsiya");
  return (
    <div>
      <PageHeader
        back={{ href: "/logistika/realizatsiya", label: "Realizatsiya" }}
        title="Excel'dan import"
        subtitle="Google varag'idagi (yoki shu reestrdan yuklab olingan) jo'natmalar «Qo'lda» qator bo'lib qo'shiladi. Reestrda bor jo'natma o'tkazib yuboriladi."
      />
      {canDo(s, "logistika", "real_manual") ? (
        <Card className="max-w-6xl">
          <RealizationImport pays={PAY_GROUPS} />
        </Card>
      ) : (
        <Callout tone="warning" title="Ruxsat yo'q">Import qo&apos;lda qator qo&apos;shadi — buning uchun «Realizatsiya: qo&apos;lda qator kiritish» ruxsati kerak.</Callout>
      )}
    </div>
  );
}
