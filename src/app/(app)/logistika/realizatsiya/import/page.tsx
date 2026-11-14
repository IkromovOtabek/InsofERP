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
        info={<>
          <p>Google varag&apos;idagi (yoki shu reestrdan yuklab olingan) jo&apos;natmalar «Qo&apos;lda» qator bo&apos;lib qo&apos;shiladi. Reestrda bor jo&apos;natma o&apos;tkazib yuboriladi.</p>
          <p>Har qator «Qo&apos;lda» qator bo&apos;ladi: faqat reestr — mijoz qarzi, kassa va skladga ta&apos;sir qilmaydi, keyin tuzatish yoki sabab bilan bekor qilish mumkin.</p>
          <p>Reestrda bor jo&apos;natma qo&apos;shilmaydi: shu TTN reysdan yoki avval kiritilgan bo&apos;lsa (±1 kun), TTN&apos;siz qatorda — o&apos;sha kuni xaridor, mahsulot va miqdori bir xil qator bo&apos;lsa.
            Shuning uchun reestrning o&apos;zidan yuklab olingan faylni ham, bir faylni qayta ham yuklash mumkin — ikki marta yozilmaydi.</p>
          <p>«Summa», «QQS», «Jami», «Manba» ustunlari kerak emas. Ro&apos;yxatda yo&apos;q xaridor mijozlarga qo&apos;shiladi (standart kredit limiti bilan);
            ro&apos;yxatda yo&apos;q mahsulot katalogga qo&apos;shiladi (narxi 0, o&apos;lchovi fayldan yoki nomidan, papkasi «Guruh» ustunidan — bunday papka bo&apos;lsa).</p>
          <p>Sanasi, to&apos;lov turi yoki miqdori o&apos;qilmagan qator importni to&apos;xtatmaydi — u qo&apos;shilmaydi va sababi bilan ko&apos;rsatiladi, qolganlari qo&apos;shiladi.</p>
        </>}
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
