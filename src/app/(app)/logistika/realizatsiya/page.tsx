import { redirect } from "next/navigation";

/** Realizatsiya Sotuv bo'limiga ko'chdi (2026-11-14) — eski havola va xatcho'plar yangi manzilga (filtrlar bilan). */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") sp.set(k, v);
  redirect(`/sales/realizatsiya${sp.size ? `?${sp}` : ""}`);
}
