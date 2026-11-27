import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { flatName, headerRowIndex, numMoney, parseDate, str } from "@/lib/excel";
import { isoDate } from "@/lib/format";
import { normalizePhone } from "@/lib/phone";
import { customerNameKey } from "@/lib/customer-name";
import { cleanInn, cleanText, matchExisting, resultIndex, userIndex, type Plan, type PlanClient, type PlanContact } from "./plan";

/**
 * Google Sheets «Mijozlar bazasi» (CRM_SPEC 6): butun fayl (.xlsx — Fayl → Yuklab olish) yoki varaqlar CSV qilib.
 * Varaqlar nomi bo'yicha: Mijozlar, Aloqalar, Zayafkalar. Ustunlar sarlavha nomi bo'yicha moslanadi; hisoblanadigan
 * ustunlar (Oxirgi aloqa, Faollik…) o'tkazib yuboriladi.
 */

type Col = { key: string; syn: string[] };
const CLIENT_COLS: Col[] = [
  { key: "name", syn: ["mijoznomi", "nomi", "mijoz", "firma", "firmanomi", "kompaniya", "tashkilot"] },
  { key: "inn", syn: ["stir", "inn"] },
  { key: "contactPerson", syn: ["aloqashaxsi", "masulshaxs", "fio", "kontakt", "rahbar"] },
  { key: "phone", syn: ["telefon", "tel", "telefonraqami", "raqam", "telefonlar"] },
  { key: "region", syn: ["viloyatshahar", "viloyat", "shahar", "hudud", "manzil"] },
  { key: "district", syn: ["tuman"] },
  { key: "objectType", syn: ["nimaqurilmoqda", "obyekt", "obyektturi", "qurilish"] },
  { key: "foremanPhone", syn: ["prorabtelefoni", "prorabtel", "prorabraqami"] },
  { key: "foremanName", syn: ["prorab", "prorabismi"] },
  { key: "clientType", syn: ["mijozturi", "turi"] },
  { key: "source", syn: ["manba", "lidmanbasi", "manbasi"] },
  { key: "owner", syn: ["masulxodim", "xodim", "masul", "operator", "menejer"] },
  { key: "link", syn: ["havola", "link", "url", "tenderhavolasi"] },
  { key: "note", syn: ["izoh", "eslatma", "izohlar"] },
];
const CONTACT_COLS: Col[] = [
  { key: "client", syn: ["mijoz", "mijoznomi", "firma", "nomi"] },
  { key: "date", syn: ["sana", "aloqasanasi", "qongiroqsanasi"] },
  { key: "channel", syn: ["aloqaturi", "kanal", "turi"] },
  { key: "result", syn: ["natija", "natijasi"] },
  { key: "product", syn: ["mahsulot"] },
  { key: "price", syn: ["taklifnarxisom", "taklifnarxi", "narx", "narxi"] },
  { key: "next", syn: ["keyingialoqasanasi", "keyingialoqa", "keyingisana", "qaytaaloqa"] },
  { key: "user", syn: ["masulxodim", "xodim", "operator", "masul"] },
  { key: "leadSource", syn: ["lidmanbasi", "manba"] },
  { key: "objectName", syn: ["obyektnomiishtavsifi", "obyektnomi", "ishtavsifi"] },
  { key: "objectArea", syn: ["obyekthududi", "hudud"] },
  { key: "note", syn: ["izoh", "izohlar"] },
];

/** Sarlavhalarni ustunlarga moslash: avval to'liq mos, keyin boshlanishi bo'yicha; bir ustun bir marta. */
function mapHeaders(headers: string[], cols: Col[]): { map: Record<string, number>; used: string[]; unused: string[] } {
  const flat = headers.map((h) => flatName(h));
  const taken = new Set<number>();
  const map: Record<string, number> = {};
  for (const pass of ["exact", "prefix"] as const) {
    for (const c of cols) {
      if (map[c.key] !== undefined) continue;
      for (const s of c.syn) {
        const i = flat.findIndex((f, j) => !taken.has(j) && f && (pass === "exact" ? f === s : f.startsWith(s)));
        if (i >= 0) { map[c.key] = i; taken.add(i); break; }
      }
    }
  }
  return {
    map,
    used: Object.entries(map).map(([k, i]) => `${headers[i]} → ${k}`),
    unused: headers.filter((h, i) => h.trim() && !taken.has(i)),
  };
}

type Sheet = { name: string; aoa: unknown[][] };

/** Fayl(lar)ni o'qish: .xlsx — barcha varaqlar, .csv — fayl nomi varaq nomi. */
export async function readSheets(files: File[]): Promise<Sheet[]> {
  const out: Sheet[] = [];
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    const csv = /\.csv$/i.test(f.name);
    // CSV — matn holicha (raw): «25.11.2026» oy/kun deb o'girilib ketmasin
    const wb = XLSX.read(buf, { type: "buffer", raw: csv, codepage: 65001 });
    for (const n of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: true, defval: "" });
      out.push({ name: csv ? f.name.replace(/\.csv$/i, "") : n, aoa });
    }
  }
  return out;
}

const kindOf = (name: string) => {
  const f = flatName(name);
  if (/aloqa|контакт|zvon|qongiroq/.test(f)) return "contacts";
  if (/zayaf|zayav|заяв|buyurtma/.test(f)) return "orders";
  if (/mijoz|klient|клиент/.test(f)) return "clients";
  return null;
};

const iso = (v: unknown): string | null => { const d = parseDate(v); return d ? isoDate(d) : null; };
const firstPhone = (v: unknown): { norm: string | null; raw: string | null } => {
  const raw = cleanText(v, 60);
  if (!raw) return { norm: null, raw: null };
  for (const part of raw.split(/[,;/]|\s{2,}/)) { const n = normalizePhone(part); if (n) return { norm: n, raw: part.trim() }; }
  return { norm: normalizePhone(raw), raw };
};

export async function planFromSheets(files: File[]): Promise<Plan> {
  const plan: Plan = { clients: [], contacts: [], errors: [], warnings: [], info: [] };
  const sheets = await readSheets(files);
  const pick = (k: string) => sheets.find((s) => kindOf(s.name) === k);
  const cs = pick("clients"), ks = pick("contacts"), os = pick("orders");
  plan.info.push(`Varaqlar: ${sheets.map((s) => `${s.name}${kindOf(s.name) ? "" : " (o'tkazildi)"}`).join(", ")}`);
  if (!cs) { plan.errors.push("«Mijozlar» varag'i topilmadi (varaq yoki CSV fayl nomida «Mijozlar» bo'lsin)"); return plan; }

  const [resolveResult, resolveUser] = await Promise.all([resultIndex(), userIndex()]);
  const unknownUsers = new Set<string>(), unknownResults = new Map<string, number>();
  const user = (v: unknown) => { const s = cleanText(v, 80); if (!s) return null; const id = resolveUser(s); if (!id) unknownUsers.add(s); return id; };

  // ── Mijozlar ──
  const h = headerRowIndex(cs.aoa);
  const head = (cs.aoa[h] ?? []).map((x) => str(x));
  const m = mapHeaders(head, CLIENT_COLS);
  plan.info.push(`Mijozlar ustunlari: ${m.used.join(", ")}`);
  if (m.unused.length) plan.info.push(`Mijozlar — import qilinmaydigan ustunlar: ${m.unused.join(", ")}`);
  if (m.map.name === undefined) { plan.errors.push("Mijozlar varag'ida «Mijoz nomi» ustuni topilmadi"); return plan; }
  const byKey = new Map<string, PlanClient>();
  let empty = 0;
  for (let r = h + 1; r < cs.aoa.length; r++) {
    const row = cs.aoa[r] ?? [];
    const get = (k: string) => (m.map[k] === undefined ? null : row[m.map[k]]);
    const name = cleanText(get("name"), 200);
    if (!name) { if (row.some((x) => str(x))) empty++; continue; }
    const key = customerNameKey(name);
    if (byKey.has(key)) { plan.warnings.push(`Mijozlar: «${name}» ikki marta yozilgan (${r + 1}-qator) — birinchisi olinadi`); continue; }
    const ph = firstPhone(get("phone"));
    const fph = firstPhone(get("foremanPhone"));
    if (get("phone") && !ph.norm) plan.warnings.push(`«${name}»: telefon o'qilmadi (${cleanText(get("phone"), 40)}) — o'zicha saqlanadi`);
    const c: PlanClient = {
      key, name, inn: cleanInn(get("inn")), phone: ph.norm, rawPhone: ph.raw,
      contactPerson: cleanText(get("contactPerson"), 120), region: cleanText(get("region"), 120), district: cleanText(get("district"), 120),
      objectType: cleanText(get("objectType"), 200), foremanName: cleanText(get("foremanName"), 120), foremanPhone: fph.norm ?? fph.raw,
      clientType: cleanText(get("clientType"), 80), source: cleanText(get("source"), 80), ownerId: user(get("owner")),
      link: (() => { const l = cleanText(get("link"), 500); return l && /^https?:\/\//i.test(l) ? l : l ? `https://${l}` : null; })(),
      note: cleanText(get("note"), 2000),
    };
    byKey.set(key, c);
    plan.clients.push(c);
  }
  if (empty) plan.info.push(`Mijozlar: nomsiz ${empty} ta qator o'tkazib yuborildi`);

  // ── Aloqalar ──
  if (ks) {
    const hk = headerRowIndex(ks.aoa);
    const hd = (ks.aoa[hk] ?? []).map((x) => str(x));
    const mk = mapHeaders(hd, CONTACT_COLS);
    plan.info.push(`Aloqalar ustunlari: ${mk.used.join(", ")}`);
    if (mk.unused.length) plan.info.push(`Aloqalar — import qilinmaydigan ustunlar: ${mk.unused.join(", ")}`);
    if (mk.map.client === undefined || mk.map.date === undefined) plan.errors.push("Aloqalar varag'ida «Mijoz» yoki «Sana» ustuni topilmadi");
    else {
      const unlinked = new Map<string, number>();
      const seen = new Map<string, number>();
      let noResult = 0;
      for (let r = hk + 1; r < ks.aoa.length; r++) {
        const row = ks.aoa[r] ?? [];
        const get = (k: string) => (mk.map[k] === undefined ? null : row[mk.map[k]]);
        const cname = cleanText(get("client"), 200);
        if (!cname) continue;
        const client = byKey.get(customerNameKey(cname));
        if (!client) { unlinked.set(cname, (unlinked.get(cname) ?? 0) + 1); continue; }
        const date = iso(get("date"));
        if (!date) { plan.warnings.push(`Aloqalar ${r + 1}-qator (${cname}): sana o'qilmadi — o'tkazildi`); continue; }
        const resText = cleanText(get("result"), 120);
        const resultId = resolveResult(resText);
        if (resText && !resultId) unknownResults.set(resText, (unknownResults.get(resText) ?? 0) + 1);
        if (!resText) noResult++;
        const x: Omit<PlanContact, "importKey"> = {
          clientKey: client.key, date, channel: cleanText(get("channel"), 80), resultId,
          product: cleanText(get("product"), 80), offeredPrice: (() => { const n = numMoney(get("price")); return n > 0 ? n : null; })(),
          next: iso(get("next")), userId: user(get("user")), leadSource: cleanText(get("leadSource"), 80),
          objectName: cleanText(get("objectName"), 300), objectArea: cleanText(get("objectArea"), 200), note: cleanText(get("note"), 2000),
        };
        // Barqaror kalit: qator mazmuni (+ bir xil qatorlar tartibi) — qayta importda dublikat bo'lmaydi
        const sig = createHash("sha1").update(JSON.stringify([x.clientKey, x.date, resText, x.userId, x.note, x.channel, x.next])).digest("hex").slice(0, 20);
        const n = (seen.get(sig) ?? 0) + 1;
        seen.set(sig, n);
        plan.contacts.push({ ...x, importKey: `gs:${sig}:${n}` });
      }
      if (unlinked.size) plan.warnings.push(`Mijozi topilmagan aloqalar (${[...unlinked.values()].reduce((a, b) => a + b, 0)} ta): ${[...unlinked.entries()].map(([k, v]) => `${k} (${v})`).join(", ")}`);
      if (noResult) plan.info.push(`Natijasi bo'sh aloqalar: ${noResult} ta — import qilinadi, voronkada faqat 1-bosqich`);
      if (unknownResults.size) plan.warnings.push(`Tanilmagan natijalar (natijasiz yoziladi): ${[...unknownResults.entries()].map(([k, v]) => `«${k}» (${v})`).join(", ")}`);
    }
  } else plan.warnings.push("«Aloqalar» varag'i topilmadi — faqat mijozlar import qilinadi");

  // Manbasi bo'sh mijozlar — shu mijozning birinchi aloqasidagi «Lid manbasi» (CRM_SPEC 6)
  let filled = 0;
  const firstContact = new Map<string, PlanContact>();
  for (const x of [...plan.contacts].sort((a, b) => a.date.localeCompare(b.date))) if (x.leadSource && !firstContact.has(x.clientKey)) firstContact.set(x.clientKey, x);
  for (const c of plan.clients) if (!c.source) { const s = firstContact.get(c.key)?.leadSource; if (s) { c.source = s; filled++; } }
  if (filled) plan.info.push(`Manbasi bo'sh ${filled} ta mijozga birinchi aloqadagi «Lid manbasi» qo'yildi`);
  const noSource = plan.clients.filter((c) => !c.source).length;
  if (noSource) plan.warnings.push(`Manbasiz qolgan mijozlar: ${noSource} ta (keyin kartada tanlanadi)`);
  if (unknownUsers.size) plan.warnings.push(`Tanilmagan xodimlar (import qiluvchi nomidan yoziladi): ${[...unknownUsers].join(", ")}`);

  if (os) {
    const n = os.aoa.slice(headerRowIndex(os.aoa) + 1).filter((r) => (r ?? []).some((x) => str(x))).length;
    plan.info.push(`Zayafkalar varag'i: ${n} qator — ERP zayavkalariga avtomatik yozilmaydi (sklad, qarz va kassaga ta'sir qiladi); voronkada «Zayafka oldim» aloqalari hisoblanadi`);
  }

  await matchExisting(plan.clients, { byName: true });
  return plan;
}
