"use client";

import Link from "next/link";

const MSG: Record<string, string> = {
  FORBIDDEN: "Bu amal uchun sizda ruxsat yo'q. Kerak bo'lsa administratorga murojaat qiling.",
  UNAUTHENTICATED: "Sessiya tugagan. Qaytadan kiring.",
};

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const known = MSG[error.message];
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-red-200 bg-red-50 p-6">
      <h1 className="text-lg font-semibold text-red-800">{known ? "Ruxsat yo'q" : "Xatolik"}</h1>
      <p className="mt-2 text-sm text-red-700">{known ?? error.message}</p>
      <div className="mt-4 flex gap-3 text-sm">
        <Link href="/" className="font-medium underline">Bosh sahifa</Link>
        {!known && <button onClick={reset} className="underline">Qayta urinish</button>}
      </div>
    </div>
  );
}
