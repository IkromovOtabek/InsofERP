import { redirect } from "next/navigation";

// Kunlik realizatsiya hisoboti Tahlil → Sotuvlar ichiga ko'chdi (eski havolalar uchun)
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of [v].flat()) if (x != null) sp.append(k, x);
  const q = sp.toString();
  redirect(`/bi-tahlil/sotuvlar/realizatsiya${q ? `?${q}` : ""}`);
}
