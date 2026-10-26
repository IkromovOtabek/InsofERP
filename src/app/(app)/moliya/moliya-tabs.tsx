import { BookOpen, Building2, CalendarRange, FolderTree, Landmark, ListChecks } from "lucide-react";
import { Tabs } from "@/components/ui";

/** Moliya bo'limi ichidagi sahifalar — menyuda bitta «Moliyaviy hisobotlar» bandi, qolganlari shu tablar orqali. */
const ITEMS = [
  { key: "/moliya", label: "Hisobotlar", href: "/moliya", icon: BookOpen },
  { key: "/moliya/kalendar", label: "To'lov kalendari", href: "/moliya/kalendar", icon: CalendarRange },
  { key: "/moliya/tolov-rejasi", label: "To'lov rejasi", href: "/moliya/tolov-rejasi", icon: ListChecks },
  { key: "/moliya/asosiy-vositalar", label: "Asosiy vositalar", href: "/moliya/asosiy-vositalar", icon: Building2 },
  { key: "/moliya/kreditlar", label: "Kreditlar va qarzlar", href: "/moliya/kreditlar", icon: Landmark },
  { key: "/moliya/kategoriyalar", label: "Kategoriyalar va loyihalar", href: "/moliya/kategoriyalar", icon: FolderTree },
];

export function MoliyaTabs({ current }: { current: string }) {
  return <Tabs current={current} items={ITEMS} />;
}
