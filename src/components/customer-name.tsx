import Link from "next/link";
import { ShieldAlert, FileSignature } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Qora ro'yxat belgisi — mijoz nomi chiqadigan har bir joyda ishlatiladi.
 * Qora ro'yxat saqlanmaydi, `blacklistedIds()` / `customerCredit()` orqali hisoblanadi.
 */
export function BlacklistMark({ className, short = false }: { className?: string; short?: boolean }) {
  return (
    <span
      title="Mijoz qora ro'yxatda: kredit limiti to'liq ishlatilgan. Yangi zayavka ochilmaydi, qarz to'langach avtomatik chiqadi."
      className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white", className)}
    >
      <ShieldAlert size={11} strokeWidth={2.5} />
      {short ? null : "Qora ro'yxat"}
    </span>
  );
}

/** Shartnoma belgisi — mijoz bilan shartnoma tuzilgan (bekor qilinmagan shartnomali zayavkasi bor). */
export function ContractMark({ className, short = false }: { className?: string; short?: boolean }) {
  return (
    <span
      title="Mijoz bilan shartnoma tuzilgan. Zayavka sahifasida shartnoma summasi, qoldig'i va PDF bor."
      className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white", className)}
    >
      <FileSignature size={11} strokeWidth={2.5} />
      {short ? null : "Shartnoma"}
    </span>
  );
}

/**
 * Mijoz nomi + (kerak bo'lsa) qora ro'yxat va shartnoma belgilari. `href` berilsa nom havola bo'ladi.
 * Qora ro'yxatdagi mijoz nomi qizil rangda — jadvalni ko'zdan kechirganda darhol ajralib turadi.
 */
export function CustomerName({ name, blacklisted, contracted = false, href, className, short }: { name: string; blacklisted: boolean; contracted?: boolean; href?: string; className?: string; short?: boolean }) {
  const label = <span className={cn(blacklisted && "font-semibold text-red-700", className)}>{name}</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      {href ? <Link href={href} className="truncate hover:underline">{label}</Link> : label}
      {blacklisted && <BlacklistMark short={short} />}
      {contracted && <ContractMark short={short} />}
    </span>
  );
}
