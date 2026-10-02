"use client";

/**
 * Ildiz layout'ning o'zi yiqilganda (masalan, baza ulanmasa) chiqadigan sahifa.
 * Bu holatda `layout.tsx` va global CSS ishlamaydi — shuning uchun o'z <html>/<body> va oddiy inline uslub.
 * Production'da xato matni yashirin; foydalanuvchiga `digest` ko'rsatiladi — server jurnalida shu kod bo'yicha topiladi.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="uz">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f2f4f7", color: "#1e2530", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <div style={{ height: 6, borderRadius: 3, marginBottom: 20, background: "repeating-linear-gradient(-45deg, #ffa300 0 12px, #1e2530 12px 24px)" }} />
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Tizimda xatolik yuz berdi</h1>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "#5b6880", margin: "0 0 16px" }}>
            Sahifani yuklab bo&apos;lmadi. Birozdan keyin qayta urinib ko&apos;ring. Xato takrorlansa, quyidagi kodni administratorga yuboring.
          </p>
          {error.digest && <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#5b6880", margin: "0 0 20px" }}>Kod: {error.digest}</p>}
          <button
            onClick={() => reset()}
            style={{ minHeight: 44, padding: "0 20px", border: 0, borderRadius: 10, background: "#ffa300", color: "#111418", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
          >
            Qayta urinish
          </button>
        </main>
      </body>
    </html>
  );
}
