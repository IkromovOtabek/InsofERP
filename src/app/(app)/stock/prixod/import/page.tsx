import { redirect } from "next/navigation";

/** Eski manzil: Sklad → Kirim → Excel endi daftar ustunlari bilan bitta sahifada (`../jurnal`). */
export default function PrixodImportPage() {
  redirect("/stock/prixod/jurnal");
}
