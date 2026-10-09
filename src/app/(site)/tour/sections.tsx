import { PROMISES } from "./content";

/**
 * Dizayndagi «Hamkorlik» bo'limi (#partners, matn so'zma-so'z). Ranglar zavod turi mavzusidan (`.it-root`
 * o'zgaruvchilari) — Kun/Tun va rang tanlovi bu yerga ham ta'sir qiladi.
 * Dizayndagi boshqa bo'limlar olinmadi: «Mijozlar fikri» (namuna ismlar), mahsulot rasmlari o'rni va aloqa formasi
 * o'rnida saytning haqiqiy katalogi va arizasi bor; «Eksport buyurtmasi» — saytdagi «Ish tartibi» bilan takror.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const mono = { fontFamily: "var(--font-jet-mono), 'JetBrains Mono', monospace" } as const;

export function PartnersSection() {
  return (
    <section id="partners" className="it-ui scroll-mt-24" style={{ background: "var(--bg)" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "clamp(64px,9vw,120px) clamp(20px,4vw,48px) 40px", display: "flex", flexDirection: "column", gap: 44 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%,420px),1fr))", gap: 32, alignItems: "end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ ...mono, fontSize: 11, color: "var(--acc-text)", letterSpacing: ".1em" }}>XALQARO HAMKORLAR UCHUN</span>
            <h2 style={{ margin: 0, fontSize: "clamp(38px,5.6vw,72px)", lineHeight: 0.98, fontWeight: 700, letterSpacing: "-.035em" }}>Loyihangiz tayanishi mumkin bo&apos;lgan hamkor.</h2>
          </div>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.55, color: "var(--muted)", maxWidth: 520, textWrap: "pretty" }}>
            Pudratchilar va quruvchilar yetkazib beruvchidan uch narsani kutadi: to&apos;g&apos;ri sifat, kelishilgan muddat va kutilmagan holatlarsiz ishlash. Butun ishlab chiqarish zanjirimiz aynan shunga qurilgan.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%,300px),1fr))", gap: 1, background: "var(--line)", border: "1px solid var(--line)", borderRadius: 18, overflow: "hidden" }}>
          {PROMISES.map(([name, text], i) => (
            <div key={name} className="it-promise" style={{ background: "var(--surface)", padding: "28px 26px 30px", display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ ...mono, fontSize: 11, color: "var(--acc-text)", letterSpacing: ".08em" }}>{pad(i + 1)}</span>
              <h3 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-.01em" }}>{name}</h3>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--muted)", textWrap: "pretty" }}>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
