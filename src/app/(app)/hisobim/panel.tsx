import { KeyRound, Palette, UserRound } from "lucide-react";
import type { Session } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/nav";
import { selfAccount } from "@/lib/self-account";
import { Badge, Card, CardHeader } from "@/components/ui";
import { PalettePicker } from "@/components/palette-picker";
import { CredentialsForm, ProfileForm } from "./forms";

/**
 * "Mening hisobim" — `/hisobim` sahifasi va direktorning Sozlamalar → "Mening hisobim" tabi bir xil.
 * Har qanday xodim: login va parol (Telegram kodi bilan), fon (palitra). Direktor qo'shimcha: o'z F.I.O. si.
 */
export async function SelfAccountPanel({ s }: { s: Session }) {
  const acc = await selfAccount(s.userId);
  if (!acc) return null;
  const director = s.role === "DIRECTOR";

  return (
    <div className="grid max-w-3xl gap-5">
      <Card>
        <CardHeader icon={UserRound} title="Shaxsiy ma'lumot" description={director ? "Ismingiz menyu va hujjatlarda shunday ko'rinadi" : "F.I.O. va telefon raqamini Otdel kadr yuritadi"} />
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Badge color="blue">{s.superadmin ? ROLE_LABELS.SUPERADMIN : ROLE_LABELS[s.role]}</Badge>
          <span>Login: <b data-no-translit className="text-slate-900">{acc.login}</b></span>
          <span>· Telefon: <b data-no-translit className="text-slate-900">{acc.phone ?? "kiritilmagan"}</b></span>
        </div>
        {director ? <ProfileForm fullName={acc.fullName} /> : <div className="text-sm font-medium text-slate-900">{acc.fullName}</div>}
      </Card>

      <Card>
        <CardHeader icon={KeyRound} title="Login va parol" description={acc.phone ? "O'zgartirish Telegram'ga keladigan kod bilan tasdiqlanadi" : "Telefon raqamingiz kiritilmagan — joriy parol bilan tasdiqlanadi"} />
        {acc.eco
          ? <p className="text-sm text-slate-600">Siz Insof ECO ilovasi hisobi bilan kirasiz — parolni ilovaning o'zida o'zgartiring.</p>
          : <CredentialsForm login={acc.login} phone={acc.phone} />}
      </Card>

      <Card>
        <CardHeader icon={Palette} title="Fon" description="ERP ranglari — faqat sizda va shu qurilmada o'zgaradi" />
        <PalettePicker />
      </Card>
    </div>
  );
}
