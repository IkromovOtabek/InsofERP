import { KeyRound, Palette, SlidersHorizontal, UserRound } from "lucide-react";
import type { Session } from "@/lib/auth";
import { OWN_PAGE_ONLY, ROLE_LABELS } from "@/lib/nav";
import { db } from "@/lib/db";
import { menuBase, menuPrefs, sortByOrder } from "@/lib/menu-prefs";
import { selfAccount } from "@/lib/self-account";
import { Badge, Card, CardHeader } from "@/components/ui";
import { PalettePicker } from "@/components/palette-picker";
import { CredentialsForm, ProfileForm } from "./forms";
import { MenuPrefsForm } from "./menu-form";

/**
 * "Mening hisobim" — `/hisobim` sahifasi va direktorning Sozlamalar → "Mening hisobim" tabi bir xil.
 * Har qanday xodim: login va parol (Telegram kodi bilan), fon (palitra), «Kabinetim» — o'z menyusi. Direktor qo'shimcha: o'z F.I.O. si.
 */
export async function SelfAccountPanel({ s }: { s: Session }) {
  const acc = await selfAccount(s.userId);
  if (!acc) return null;
  const director = s.role === "DIRECTOR";
  const base = menuBase(s);
  const prefs = menuPrefs((await db.user.findUnique({ where: { id: s.userId }, select: { menuPrefs: true } }))?.menuPrefs, s.role);

  return (
    <div className="grid max-w-3xl gap-5">
      <Card>
        <CardHeader icon={UserRound} title="Shaxsiy ma'lumot" info={director ? "Ismingiz menyu va hujjatlarda shunday ko'rinadi" : "F.I.O. va telefon raqamini Otdel kadr yuritadi"} />
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Badge color="blue">{s.superadmin ? ROLE_LABELS.SUPERADMIN : ROLE_LABELS[s.role]}</Badge>
          <span>Login: <b data-no-translit className="text-slate-900">{acc.login}</b></span>
          <span>· Telefon: <b data-no-translit className="text-slate-900">{acc.phone ?? "kiritilmagan"}</b></span>
        </div>
        {director ? <ProfileForm fullName={acc.fullName} /> : <div className="text-sm font-medium text-slate-900">{acc.fullName}</div>}
      </Card>

      <Card>
        <CardHeader icon={KeyRound} title="Login va parol" info={acc.phone ? "O'zgartirish Telegram'ga keladigan kod bilan tasdiqlanadi" : "Telefon raqamingiz kiritilmagan — joriy parol bilan tasdiqlanadi"} />
        {acc.eco
          ? <p className="text-sm text-slate-600">Siz Insof ECO ilovasi hisobi bilan kirasiz — parolni ilovaning o'zida o'zgartiring.</p>
          : <CredentialsForm login={acc.login} phone={acc.phone} />}
      </Card>

      <Card>
        <CardHeader icon={Palette} title="Fon" info="ERP ranglari — faqat sizda va shu qurilmada o'zgaradi" />
        <PalettePicker />
      </Card>

      {/* Sidebar pastidagi «Menyuni sozlash» tugmasi shu yerga (#kabinet) olib keladi */}
      <div id="kabinet" className="scroll-mt-20">
        <Card>
          <CardHeader icon={SlidersHorizontal} title="Kabinetim — menyu" info="Chap menyuni o'zingizga moslang: bo'limlarsiz ko'rinish, keraksiz bandlarni yashirish, tartib va kirish sahifasi" />
          <MenuPrefsForm
            items={sortByOrder(base, prefs.order).map((i) => ({ href: i.href, label: i.label, group: i.group }))}
            hidden={prefs.hidden.filter((h) => base.some((i) => i.href === h))}
            flat={prefs.flat} home={prefs.home} showHome={!OWN_PAGE_ONLY[s.role]}
            defaultOrder={base.map((i) => i.href)} flatDefault={menuPrefs(null, s.role).flat} />
        </Card>
      </div>
    </div>
  );
}
