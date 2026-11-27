import { CrmNav } from "./crm-nav";

/** Sotuv CRM qobig'i: bo'lim menyusi; telefonda pastki menyu uchun joy qoldiriladi. */
export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-20 lg:pb-0">
      <CrmNav />
      {children}
    </div>
  );
}
