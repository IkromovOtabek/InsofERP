/**
 * Tab kirish belgisi — `components/tab-gate.tsx` izohiga qarang. Bu modul serverda ham ishlaydi:
 * `tabGateScript` layout'da inline skript beradi (kontent ko'rinmasdan oldin tekshiruv).
 */
export const TAB_KEY = "insof-tab";
export const HANDOFF_KEY = "insof-tab-handoff";
export const TAB_LOGIN_URL = "/login?yangi=1";

/** Login sahifasi: shu tabda kirish kutilmoqda — keyingi ilova sahifasi belgini o'rnatadi. */
export function markTabLoginPending() {
  try { sessionStorage.setItem(TAB_KEY, "pending"); } catch { /* sessionStorage yo'q — tekshiruv ham ishlamaydi */ }
}

/**
 * Tekshiruv: `true` — tab shu foydalanuvchiniki (belgi qo'yildi), `false` — login sahifasiga yuborildi.
 * Inline skript sifatida ham ishlatiladi (`toString`) — tashqi o'zgaruvchiga murojaat qilmaydi.
 */
export function tabCheck(uid: string): boolean {
  try {
    const K = "insof-tab", H = "insof-tab-handoff";
    let v = sessionStorage.getItem(K);
    if (location.hash === "#kirish") {
      v = "pending";
      history.replaceState(history.state, "", location.pathname + location.search);
    }
    let ok = v === uid || v === "pending";
    if (!v) {
      const h = JSON.parse(localStorage.getItem(H) || "null") as { u?: string; t?: number } | null;
      ok = !!h && h.u === uid && Date.now() - (h.t || 0) < 30000;
    }
    if (ok) {
      if (v !== uid) {
        sessionStorage.setItem(K, uid);
        try { new BroadcastChannel("insof-tab").postMessage(uid); } catch { /* eski brauzer */ }
      }
      return true;
    }
    document.documentElement.style.visibility = "hidden";
    location.replace("/login?yangi=1");
    return false;
  } catch {
    return true; // saqlash joyi bloklangan — eski xatti-harakat
  }
}

/** Birinchi yuklanishda gidratsiyani kutmasdan tekshiruv (layout `<script>` ichida). */
export function tabGateScript(userId: string) {
  return `(${tabCheck.toString()})(${JSON.stringify(userId).replace(/</g, "\\u003c")})`;
}
