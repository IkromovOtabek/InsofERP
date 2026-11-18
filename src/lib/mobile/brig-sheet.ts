import { myBrigades } from "@/lib/brigades";
import { shiftDay, today } from "@/lib/davomat";
import { brigadeSheet, saveBrigadeHours, saveBrigadeOutput, type BrigadeSheetData } from "@/lib/hr/brigade-sheet";
import { num } from "./fmt";
import { ListError, type MobileList } from "./list";
import type { MobileUser } from "./auth";
import type { DetailAction, DetailField, FormField, MobileDetail } from "./detail";
import type { HomeRow, Tone } from "./home";

/**
 * Brigadirning brigada varag'i (ilova): Ish haqi → Tabel → brigada varag'ining kunlik qismi — a'zolar soati va mahsulot soni.
 *   · `brig-sheet` ro'yxati — o'z brigadasi(lari)ning oxirgi 31 kuni (qator id: `<brigadeId>.<YYYY-MM-DD>`);
 *   · kartochka — shu kun: a'zolar soati (qo'lda / davomatdan) va oy qatorlari bo'yicha soni;
 *   · amallar `bsheet.hours` / `bsheet.output` — `lib/hr/brigade-sheet.ts` (`saveBrigadeHours` / `saveBrigadeOutput`, veb bilan bitta qoida:
 *     tabel qulfi, kelajak kuni, ishda bo'lmagan kun, AuditLog).
 * Faqat BRIGADIER va faqat o'z brigadasi (`ACTION_ROLES`, `ownBrigade`); oy narxlari va qatorlarini veb (Sekretar) belgilaydi.
 */

export const BSHEET_ACTIONS = new Set(["bsheet.hours", "bsheet.output"]);
const DAYS_BACK = 31;
const MONTHS_UZ = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const WEEKDAYS_UZ = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const dayTitle = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()}-${MONTHS_UZ[d.getMonth()]}, ${WEEKDAYS_UZ[d.getDay()]}`; };
const fail = (m: string, status = 400): never => { throw new ListError("ACTION_FAILED", m, status); };
/** Qator nomi forma maydoni kalitida — har qanday belgi bo'lishi mumkin, shuning uchun base64url. */
const lineKey = (name: string) => `q_${Buffer.from(name, "utf8").toString("base64url")}`;
const text = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, "").replace(",", ".");

function parseId(id: string) {
  const [brigadeId, iso] = id.split(".");
  if (!brigadeId || !iso || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso)) throw new ListError("NOT_FOUND", "Kun topilmadi", 404);
  return { brigadeId, iso, month: iso.slice(0, 7), day: Number(iso.slice(8, 10)) };
}

/** Brigadir — faqat o'z brigadasi; boshqa rol (direktor) kartani ko'radi, yozmaydi (`ACTION_ROLES`). */
async function ownBrigade(user: MobileUser, brigadeId: string, forAction: boolean) {
  if (user.role !== "BRIGADIER") { if (forAction) fail("Bu amalga ruxsatingiz yo'q", 403); return; }
  if (!(await myBrigades(user.id)).some((b) => b.id === brigadeId)) {
    if (forAction) fail("Bu brigada sizga biriktirilmagan", 403);
    throw new ListError("NOT_FOUND", "Brigada topilmadi", 404);
  }
}

/** Shu kuni ishda bo'lgan a'zolar (va boshqa brigadadan soati yozilganlar). */
const activeOn = (s: BrigadeSheetData, day: number) => s.members.filter((m) => day >= m.from && day <= m.to);
const hoursOf = (s: BrigadeSheetData, empId: string, day: number) => {
  const manual = s.hours[empId]?.[day];
  const auto = s.auto[empId]?.[day];
  return { manual: manual ?? null, auto: auto ?? null, value: manual ?? auto?.h ?? 0 };
};

// ───────────────────────── Ro'yxat ─────────────────────────

export async function brigSheetList(user: MobileUser, title: string): Promise<MobileList> {
  const mine = user.role === "BRIGADIER" ? await myBrigades(user.id) : [];
  const now = today();
  const from = shiftDay(now, -(DAYS_BACK - 1));
  const months = [...new Set([from.slice(0, 7), now.slice(0, 7)])];
  const many = mine.length > 1;
  const rows: { iso: string; row: HomeRow }[] = [];
  for (const b of mine) for (const m of months) {
    const s = await brigadeSheet(m, b.id);
    if (!s) continue;
    for (const d of s.days) {
      if (d.iso < from || d.iso > now) continue;
      const people = activeOn(s, d.day).map((x) => hoursOf(s, x.id, d.day).value).filter((h) => h > 0);
      const hours = people.reduce((a, h) => a + h, 0);
      const out = s.lines.map((l) => ({ name: l.name, qty: s.qty[l.name]?.[d.day] ?? 0 })).filter((x) => x.qty > 0);
      rows.push({ iso: d.iso, row: {
        id: `${b.id}.${d.iso}`,
        title: `${dayTitle(d.iso)}${d.iso === now ? " · bugun" : ""}${many ? ` · ${b.name}` : ""}`,
        subtitle: `${people.length} kishi${out.length ? ` · ${out.map((x) => `${x.name} ${num(x.qty)}`).join(", ")}` : " · mahsulot yozilmagan"}`,
        right: hours ? `${num(hours)} soat` : "—",
        ...(s.locked ? { status: "Yopiq" } : {}),
        tone: (s.locked ? "info" : hours && out.length ? "success" : d.weekend && !hours ? "info" : "warning") as Tone,
      } });
    }
  }
  rows.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
  return { key: "brig-sheet", title, rows: rows.map((r) => r.row) };
}

// ───────────────────────── Kartochka ─────────────────────────

/** `can` — `detail.ts` dagi ruxsat (aylana import bo'lmasin deb shu yerdan uzatiladi). */
export async function brigSheetDetail(user: MobileUser, id: string, can: (action: string) => boolean): Promise<MobileDetail> {
  const { brigadeId, iso, month, day } = parseId(id);
  await ownBrigade(user, brigadeId, false);
  if (iso > today()) throw new ListError("NOT_FOUND", "Kelajak kuni — hali yozilmaydi", 404);
  const s = await brigadeSheet(month, brigadeId);
  if (!s) throw new ListError("NOT_FOUND", "Brigada topilmadi", 404);
  const members = activeOn(s, day);
  const hrs = members.map((m) => ({ m, ...hoursOf(s, m.id, day) }));
  const total = hrs.reduce((a, x) => a + x.value, 0);
  const out = s.lines.map((l) => ({ name: l.name, qty: s.qty[l.name]?.[day] ?? null }));
  const fields: DetailField[] = [
    { label: "Brigada", value: s.brigade.name },
    { label: "Jami soat", value: `${num(total)} soat · ${hrs.filter((x) => x.value > 0).length} kishi`, tone: total ? "success" : "warning" },
    { label: "Mahsulot", value: out.some((x) => x.qty) ? out.filter((x) => x.qty).map((x) => `${x.name} ${num(x.qty!)}`).join(", ") : "yozilmagan", tone: out.some((x) => x.qty) ? "success" : "warning" },
    ...(s.locked ? [{ label: "Holat", value: s.locked, tone: "info" as Tone }] : []),
  ];
  const actions: DetailAction[] = [];
  if (!s.locked && members.length && can("bsheet.hours")) {
    actions.push({
      id: "bsheet.hours", label: "Soatlarni yozish", tone: "brand",
      form: hrs.map(({ m, manual, auto }): FormField => ({
        name: `h_${m.id}`, label: `${m.fullName}${m.guest ? " (boshqa brigadadan)" : ""}`, type: "number",
        value: manual != null ? String(manual) : "", placeholder: auto ? String(auto.h) : "soat",
        hint: auto ? `Davomatdan ${num(auto.h)} soat — bo'sh qolsa shu olinadi; 0 — brigadada ishlamadi` : "0 — brigadada ishlamadi; bo'sh — yozilmagan",
      })),
    });
  }
  if (!s.locked && s.lines.length && can("bsheet.output")) {
    actions.push({
      id: "bsheet.output", label: "Mahsulot sonini yozish", tone: "success",
      form: out.map((l): FormField => ({ name: lineKey(l.name), label: l.name, type: "number", value: l.qty != null ? String(l.qty) : "", hint: "Shu kuni chiqarilgan soni; bo'sh yoki 0 — o'chiriladi" })),
    });
  }
  return {
    key: "brig-sheet", id, title: dayTitle(iso), subtitle: `${s.brigade.name} · brigada varag'i`, status: s.locked ? "Yopiq" : undefined,
    fields,
    sections: [
      {
        title: "Soatlar", empty: "Shu kuni brigadada a'zo yo'q",
        rows: hrs.map(({ m, manual, auto }) => ({
          id: m.id, title: m.fullName, subtitle: `${m.position}${m.guest ? " · boshqa brigadadan" : ""}`,
          right: manual != null ? (manual ? `${num(manual)} soat` : "ishlamadi") : auto ? `${num(auto.h)} soat · davomatdan` : "—",
          tone: (manual != null ? (manual ? "success" : "info") : auto ? "info" : "warning") as Tone,
        })),
      },
      {
        title: "Mahsulot soni", empty: "Oy qatorlari belgilanmagan — Ish haqi → Tabel → brigada varag'ida qo'shiladi",
        rows: out.map((l) => ({ id: lineKey(l.name), title: l.name, right: l.qty != null ? num(l.qty) : "—", tone: (l.qty ? "success" : "warning") as Tone })),
      },
    ],
    actions,
  };
}

// ───────────────────────── Amallar ─────────────────────────

const savedText = (r: { saved: number; skipped: string[] }, what: string) =>
  `${what}: ${r.saved} ta saqlandi${r.skipped.length ? ` · yozilmadi: ${r.skipped.join("; ")}` : ""}`;

export async function runBrigSheetAction(user: MobileUser, action: string, id: string, payload: Record<string, unknown>): Promise<string> {
  const { brigadeId, iso, month, day } = parseId(id);
  await ownBrigade(user, brigadeId, true);
  if (iso > today()) fail("Kelajak kuniga yozilmaydi");
  const s = await brigadeSheet(month, brigadeId);
  if (!s) return fail("Brigada topilmadi", 404);
  if (s.locked) fail(s.locked);
  const who = { userId: user.id };

  if (action === "bsheet.hours") {
    const members = activeOn(s, day);
    const known = new Set(members.map((m) => `h_${m.id}`));
    if (Object.keys(payload).some((k) => k.startsWith("h_") && !known.has(k))) fail("Bu xodim shu kuni brigada varag'ida yo'q — kartani yangilang");
    const items: { employeeId: string; day: number; value: string }[] = [];
    for (const m of members) {
      const k = `h_${m.id}`;
      if (!Object.hasOwn(payload, k)) continue;
      const v = text(payload[k]);
      const cur = s.hours[m.id]?.[day];
      if (v === "" ? cur == null : cur != null && Number(v) === cur) continue; // o'zgarmagan — qayta yozilmaydi
      items.push({ employeeId: m.id, day, value: v });
    }
    if (!items.length) return "O'zgarish yo'q";
    const r = await saveBrigadeHours(who, month, brigadeId, items);
    if (r.error != null) return fail(r.error);
    return savedText({ saved: r.saved ?? 0, skipped: r.skipped ?? [] }, "Soat");
  }

  // bsheet.output
  const byKey = new Map(s.lines.map((l) => [lineKey(l.name), l.name]));
  if (Object.keys(payload).some((k) => k.startsWith("q_") && !byKey.has(k))) fail("Mahsulot qatori o'zgargan — kartani yangilang");
  const items: { line: string; day: number; value: string }[] = [];
  for (const [k, line] of byKey) {
    if (!Object.hasOwn(payload, k)) continue;
    const v = text(payload[k]);
    const cur = s.qty[line]?.[day];
    if (v === "" || Number(v) === 0 ? cur == null : cur != null && Number(v) === cur) continue;
    items.push({ line, day, value: v });
  }
  if (!items.length) return "O'zgarish yo'q";
  const r = await saveBrigadeOutput(who, month, brigadeId, items);
  if (r.error != null) return fail(r.error);
  return savedText({ saved: r.saved ?? 0, skipped: r.skipped ?? [] }, "Mahsulot soni");
}
