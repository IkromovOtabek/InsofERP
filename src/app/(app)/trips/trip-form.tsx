"use client";

import { useActionState, useState } from "react";
import { ClipboardList, Package, Truck } from "lucide-react";
import { createTrip } from "./actions";
import { Badge, Button, Callout, Card, CardHeader, Checkbox, Field, FormActions, FormError, Input, LinkButton, Select, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { qty as fq } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Zayavka qatori (mahsulot birligida): jami, tayyor, jo'natilgan, hozir reysga mumkin. mixer — beton qatori (mikserda ketadi). */
type Line = { productId: string; name: string; unit: string; qty: number; ready: number; shipped: number; available: number; inProduction: number; mixer: boolean };
/**
 * remainingM3 — hozir reysga berish mumkin bo'lgan miqdor: brigada tayyorlagani − jo'natilgani (0 bo'lsa tanlab bo'lmaydi).
 * inProduction — hali sexda (brigada tasdiqlamagan). unit — zayavkadagi mahsulot birligi ("m³", "dona"…).
 */
type Order = {
  id: string; date: string; time: string | null; customer: string; address: string; remainingM3: number; inProduction: number; hasTasks: boolean;
  unit: string; plannedAt: string; mixed?: boolean; pieceUnit?: string; lines: Line[];
};
/** type — MIXER (beton) yoki TRUCK (dona mahsulot: plita, blok). */
type Vehicle = { id: string; plate: string; type: string; capacityM3: number | null; state?: string; mainDriverId?: string | null };
const TYPE_LABEL: Record<string, string> = { MIXER: "mikser", TRUCK: "yuk mashina", PUMP: "nasos" };
/** vehicleId — xodim kartasida biriktirilgan mikser; phoneOk — ECO topa oladigan +998… raqami bormi. */
type Driver = { id: string; fullName: string; vehicleId: string | null; phoneOk: boolean };
/** Avval chaqirilgan ko'cha mashinasi — raqami yozilsa haydovchisi va sig'imi o'zi to'ladi. */
type External = { plate: string; type: "MIXER" | "TRUCK"; capacity: number | null; driverName: string; driverPhone: string };
type ExtForm = { type: "MIXER" | "TRUCK"; plate: string; capacity: string; driverName: string; driverPhone: string };

const normPlate = (v: string) => v.toUpperCase().replace(/\s+/g, "");
/** Jamlanma jadvali ixcham: 7 ustun menyu ochiq turganda ham 1440 px ekranga sig'sin. */
const cell = "px-3";
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 1000) / 1000;

export function TripForm({ orders, vehicles, drivers, bruNames, externals, initialOrderId }: {
  orders: Order[]; vehicles: Vehicle[]; drivers: Driver[]; bruNames: string[]; externals: External[]; initialOrderId?: string;
}) {
  const [state, action, pending] = useActionState(createTrip, undefined);
  // Jadvalda tayyori yo'q zayavka ham ko'rinadi, lekin faqat tayyori borini tanlash mumkin
  const selectable = orders.filter((o) => o.remainingM3 > 0);
  const [orderId, setOrderId] = useState(selectable.find((o) => o.id === initialOrderId)?.id ?? selectable[0]?.id ?? "");
  const firstOrder = orders.find((o) => o.id === orderId);
  // Rejadagi yetkazish vaqti — zayavkadan olinadi, dispetcher o'zgartira oladi (kalendar va kechikish shunga qaraydi)
  const [plannedAt, setPlannedAt] = useState(firstOrder?.plannedAt ?? "");
  // Zayavka birligiga mos texnika: beton (m³) — mikser, dona mahsulot — yuk mashina
  // Aralash zayavkada (beton + dona) ikkala tur ham to'g'ri: mikser betonni, yuk mashina dona qatorini oladi
  const wantType = (o?: Order): "MIXER" | "TRUCK" => (o && o.unit !== "m³" && !o.mixed ? "TRUCK" : "MIXER");
  const fits = (o?: Order, type?: string) => !o || !type || (o.mixed ? type === "MIXER" || type === "TRUCK" : type === wantType(o));
  const firstOfType = (t: string) => vehicles.find((v) => v.type === t) ?? vehicles[0];
  const [vehicleId, setVehicleId] = useState(firstOfType(wantType(firstOrder))?.id ?? "");
  // Texnikaga biriktirilgan haydovchi — Xodimlar kartasidagi "biriktirilgan texnika". Smenali transportda bir nechta:
  // avval kartadagi asosiy haydovchi, u bo'lmasa birinchisi (smenadoshni dispetcher ro'yxatdan tanlaydi)
  const driverOfVehicle = (vid: string) => {
    const main = vehicles.find((v) => v.id === vid)?.mainDriverId;
    return drivers.find((d) => d.vehicleId === vid && d.id === main) ?? drivers.find((d) => d.vehicleId === vid);
  };
  const [driverId, setDriverId] = useState(driverOfVehicle(firstOfType(wantType(firstOrder))?.id ?? "")?.id ?? drivers[0]?.id ?? "");
  // Ko'chadan chaqirilgan mashina: o'z parkimiz hammasi band bo'lganda ish to'xtab qolmasin
  const [external, setExternal] = useState(false);
  const [ext, setExt] = useState<ExtForm>({ type: wantType(firstOrder), plate: "", capacity: "", driverName: "", driverPhone: "" });

  const order = orders.find((o) => o.id === orderId);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const driver = drivers.find((d) => d.id === driverId);
  const vType = external ? ext.type : vehicle?.type;
  const extCap = (e: ExtForm) => (e.type === "MIXER" && Number(e.capacity) > 0 ? Number(e.capacity) : null);
  const typeMismatch = !fits(order, vType);
  // Ko'rsatiladigan birlik: aralash zayavkada texnikaga qarab (mikser — m³, yuk mashina — dona)
  const unit = order?.mixed ? (vType === "MIXER" ? "m³" : order.pieceUnit ?? "dona") : order?.unit ?? "m³";
  const concrete = unit === "m³";
  // Aralash zayavkada reys bitta qatorni oladi — tayyor qoldiq shu qator bo'yicha
  const lineOf = (o: Order, type?: string) => (o.mixed ? o.lines.filter((l) => l.mixer === (type === "MIXER")) : o.lines);
  const availOf = (o?: Order, type?: string) => (!o ? 0 : o.mixed ? sum(lineOf(o, type).map((l) => l.available)) : o.remainingM3);
  const avail = availOf(order, vType);
  const inProd = !order ? 0 : order.mixed ? sum(lineOf(order, vType).map((l) => l.inProduction)) : order.inProduction;
  // Biriktirilgani ro'yxat boshida tursin
  const driverList = [...drivers].sort((a, b) => Number(b.vehicleId === vehicleId) - Number(a.vehicleId === vehicleId));
  const [qty, setQty] = useState(firstOrder ? String(Math.min(vehicle?.capacityM3 ?? availOf(firstOrder, vehicle?.type), availOf(firstOrder, vehicle?.type))) : "");
  const [bru, setBru] = useState(bruNames.length === 1 ? bruNames[0]! : "");
  const [search, setSearch] = useState("");
  // Tayyor qoldiqdan ko'p yozilsa — serverdagi bilan bir xil sabab, yuborishdan oldin
  const qtyNum = Number(qty);
  const overReady = !order || qtyNum <= avail + 0.001
    ? undefined
    : inProd > 0
      ? `Faqat ${avail} ${unit} tayyor. Qolgan ${inProd} ${unit} ishlab chiqarilmoqda — brigada tasdiqini kuting`
      : `Zayavkada faqat ${avail} ${unit} qoldi`;

  const suggest = (o: Order | undefined, type: string | undefined, cap: number | null | undefined) => {
    if (!o) return;
    const a = availOf(o, type);
    setQty(String(Math.min(cap ?? a, a)));
  };

  // Texnika almashtirilsa — o'sha mashinaning haydovchisiga o'tamiz (biriktirilmagan bo'lsa tanlov qoladi)
  const pickVehicle = (vid: string, o = order) => {
    setVehicleId(vid);
    const d = driverOfVehicle(vid);
    if (d) setDriverId(d.id);
    const v = vehicles.find((x) => x.id === vid);
    suggest(o, v?.type, v?.capacityM3);
  };
  // Haydovchi tanlansa — uning biriktirilgan texnikasi o'zi tushadi (teskari bog'lanish), lekin faqat
  // dispetcher texnikani hali qo'lda tanlamagan bo'lsa: qo'lda tanlangan mashina jimgina almashib ketmasin
  const [vehicleManual, setVehicleManual] = useState(false);
  const pickDriver = (did: string) => {
    setDriverId(did);
    if (vehicleManual) return;
    const d = drivers.find((x) => x.id === did);
    const v = d?.vehicleId ? vehicles.find((x) => x.id === d.vehicleId) : undefined;
    if (v && fits(order, v.type)) { setVehicleId(v.id); suggest(order, v.type, v.capacityM3); }
  };
  // Zayavka (jadval qatori) tanlansa — birligiga mos texnika turiga o'tamiz (mikser ↔ yuk mashina).
  // Aralash zayavkada bosilgan qator qaysi tur kerakligini aytadi: beton qatori — mikser, dona — yuk mashina
  const pickOrder = (oid: string, mixerLine?: boolean) => {
    setOrderId(oid);
    const o = orders.find((x) => x.id === oid);
    setPlannedAt(o?.plannedAt ?? "");
    if (!o) return;
    const type = o.mixed && mixerLine != null ? (mixerLine ? "MIXER" : "TRUCK") : wantType(o);
    if (external) {
      const e = { ...ext, type: fits(o, ext.type) && !(o.mixed && mixerLine != null) ? ext.type : type };
      setExt(e);
      suggest(o, e.type, extCap(e));
      return;
    }
    if (vehicle && fits(o, vehicle.type) && !(o.mixed && mixerLine != null && vehicle.type !== type)) { suggest(o, vehicle.type, vehicle.capacityM3); return; }
    const v = firstOfType(type);
    if (v) pickVehicle(v.id, o);
  };
  const toggleExternal = (on: boolean) => {
    setExternal(on);
    if (on) {
      const e = { ...ext, type: fits(order, vehicle?.type) && vehicle?.type !== "PUMP" ? (vehicle?.type === "TRUCK" ? "TRUCK" : "MIXER") as ExtForm["type"] : wantType(order) };
      setExt(e);
      suggest(order, e.type, extCap(e));
    } else suggest(order, vehicle?.type, vehicle?.capacityM3);
  };
  const setExtField = (patch: Partial<ExtForm>) => {
    const e = { ...ext, ...patch };
    // Avval chaqirilgan mashina raqami yozilsa — haydovchisi, telefoni va sig'imi o'zi to'ladi
    if (patch.plate != null) {
      const known = externals.find((x) => normPlate(x.plate) === normPlate(patch.plate!));
      if (known) Object.assign(e, { type: known.type, capacity: known.capacity != null ? String(known.capacity) : e.capacity, driverName: known.driverName || e.driverName, driverPhone: known.driverPhone || e.driverPhone });
    }
    setExt(e);
    if (patch.type != null || patch.capacity != null || patch.plate != null) suggest(order, e.type, extCap(e));
  };

  // Jamlanma: qaysi mijozga qanday mahsulot, jami qancha — qator bosilsa zayavka tanlanadi
  const rows = orders.flatMap((o) => o.lines.map((l, i) => ({ o, l, i })));
  const needle = search.trim().toLowerCase();
  const visible = needle ? rows.filter(({ o, l }) => `${o.customer} ${l.name} ${o.address}`.toLowerCase().includes(needle)) : rows;
  const totals = new Map<string, { name: string; unit: string; available: number; left: number; customers: Set<string> }>();
  for (const { o, l } of rows) {
    const k = `${l.name}|${l.unit}`;
    const t = totals.get(k) ?? { name: l.name, unit: l.unit, available: 0, left: 0, customers: new Set<string>() };
    t.available += l.available; t.left += Math.max(0, l.qty - l.shipped); t.customers.add(o.id);
    totals.set(k, t);
  }
  const totalList = [...totals.values()].sort((a, b) => b.available - a.available || b.left - a.left);

  return (
    <form action={action} className="space-y-5">
      <FormError error={state?.error} />
      <input type="hidden" name="orderId" value={orderId} />

      <Card>
        <CardHeader
          icon={ClipboardList}
          title="Jo'natishga tayyor mahsulotlar"
          description="Qaysi mijozga qanday mahsulot, jami qancha — qatorni bosib zayavkani tanlang"
          action={<Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Mijoz, mahsulot yoki manzil" className="w-full sm:w-72" aria-label="Jadvaldan qidirish" />}
        />
        {orders.length === 0 ? (
          <p className="text-sm text-amber-700">Jo&apos;natishga tayyor zayavka yo&apos;q — brigada tasdiqlagan mahsulot bo&apos;lishi kerak.</p>
        ) : (
          <Table maxHeight={460}>
            <thead><tr>
              <Th className={cell}>Mijoz</Th><Th className={cell}>Mahsulot</Th><Th className={cell}>Sana</Th>
              <Th right className={cell}>Zayavka</Th><Th right className={cell}>Jo&apos;natilgan</Th><Th right className={cell}>Tayyor</Th><Th className={cell}>Sexda</Th>
            </tr></thead>
            <tbody>
              {visible.map(({ o, l, i }) => {
                const can = o.remainingM3 > 0;
                const picked = o.id === orderId;
                // Aralash zayavkada tanlangan texnika turiga mos qator — reys aynan shuni oladi
                const active = picked && (!o.mixed || l.mixer === (vType === "MIXER"));
                return (
                  <Tr
                    key={`${o.id}-${i}`}
                    onClick={can ? () => pickOrder(o.id, l.mixer) : undefined}
                    aria-selected={picked}
                    className={cn(can ? "cursor-pointer" : "opacity-60", picked && "bg-brand-50/60 hover:bg-brand-50", active && "bg-brand-50")}
                  >
                    <Td className={cell}>
                      <label className="flex cursor-[inherit] items-start gap-2.5">
                        <input type="radio" checked={active} disabled={!can} onChange={() => pickOrder(o.id, l.mixer)} aria-label={`${o.customer} — ${l.name}`} className="mt-0.5 h-4 w-4 shrink-0 accent-slate-900" />
                        <span className="min-w-0">
                          <span className="block">{o.customer}</span>
                          <span className="block max-w-64 truncate text-xs font-normal text-slate-500" title={o.address}>{o.address}</span>
                        </span>
                      </label>
                    </Td>
                    <Td className={cell}>{l.name}{o.mixed && <span className="ml-1 text-xs text-slate-500">({l.mixer ? "mikser" : "yuk mashina"})</span>}</Td>
                    <Td className={cn(cell, "whitespace-nowrap")}>{o.date}{o.time && <span className="block text-xs text-slate-500">{o.time}</span>}</Td>
                    <Td right className={cell}>{fq(l.qty)} {l.unit}</Td>
                    <Td right className={cell}>{l.shipped > 0 ? `${fq(l.shipped)} ${l.unit}` : "—"}</Td>
                    <Td right className={cn(cell, "font-semibold", l.available > 0 ? "text-emerald-700" : "text-slate-400")}>{fq(l.available)} {l.unit}</Td>
                    {/* Tayyori yo'q qatorda — nima uchunligi: sexda, brigada yo'q yoki to'liq jo'natilgan */}
                    <Td className={cn(cell, "whitespace-nowrap")}>
                      {l.inProduction > 0
                        ? o.hasTasks ? <span className="text-amber-700">{fq(l.inProduction)} {l.unit}</span> : <Badge color="slate">Brigada yo&apos;q</Badge>
                        : l.shipped >= l.qty - 0.001 ? <Badge color="slate">Jo&apos;natilgan</Badge> : <span className="text-slate-400">—</span>}
                    </Td>
                  </Tr>
                );
              })}
              {visible.length === 0 && <tr><Td colSpan={7} className="text-center text-slate-500">Qidiruv bo&apos;yicha topilmadi</Td></tr>}
            </tbody>
          </Table>
        )}
        {totalList.length > 0 && (
          <>
            <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">Mahsulot bo&apos;yicha jami</h3>
            <Table maxHeight={320}>
              <thead><tr><Th>Mahsulot</Th><Th right>Zayavkalar</Th><Th right>Jo&apos;natilmagan qoldiq</Th><Th right>Reysga tayyor</Th></tr></thead>
              <tbody>
                {totalList.map((t) => (
                  <Tr key={`${t.name}|${t.unit}`}>
                    <Td>{t.name}</Td>
                    <Td right>{t.customers.size} ta</Td>
                    <Td right>{fq(t.left)} {t.unit}</Td>
                    <Td right className={cn("font-semibold", t.available > 0 ? "text-emerald-700" : "text-slate-400")}>{fq(t.available)} {t.unit}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Truck} title="Transport" description={external ? "Ko'chadan chaqirilgan mashina va haydovchi" : "O'z texnikamiz va haydovchimiz"} />
          <div className="mb-4">
            <Checkbox label="Ko'chadan mashina chaqirildi" checked={external} onChange={(e) => toggleExternal(e.target.checked)} />
          </div>
          {external ? (
            <>
              <input type="hidden" name="external" value="1" />
              <Callout tone="info">
                O&apos;z transportimiz hammasi band bo&apos;lsa, ish to&apos;xtab qolmasligi uchun tashqaridan mashina chaqiriladi. Mashina va haydovchi faqat
                reys uchun yoziladi: park, kadr va oylik ro&apos;yxatlariga kirmaydi, haydovchi ilovasiga yuborilmaydi — bosqichlarni (yuklandi, yo&apos;lga chiqdi, yetkazildi) dispetcher shu yerdan belgilaydi.
              </Callout>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Mashina kategoriyasi *" error={typeMismatch ? `Zayavka ${order?.unit} da — ${TYPE_LABEL[wantType(order)]} kerak` : undefined} hint={typeMismatch ? undefined : ext.type === "MIXER" ? "Beton — mikserda" : "Dona mahsulot (ustun, blok, plita)"}>
                  <Select name="extType" value={ext.type} onChange={(e) => setExtField({ type: e.target.value as ExtForm["type"] })}>
                    <option value="MIXER">Mikser (beton)</option>
                    <option value="TRUCK">Yuk mashina (dona mahsulot)</option>
                  </Select>
                </Field>
                <Field label="Mashina raqami *" hint={externals.some((x) => normPlate(x.plate) === normPlate(ext.plate)) ? "Avval chaqirilgan — ma'lumoti to'ldirildi" : "Masalan: 01 A 123 BC"}>
                  <Input name="extPlate" value={ext.plate} onChange={(e) => setExtField({ plate: e.target.value.toUpperCase() })} list="ext-plates" autoComplete="off" required />
                  <datalist id="ext-plates">{externals.map((x) => <option key={x.plate} value={x.plate}>{x.driverName}</option>)}</datalist>
                </Field>
                <Field label={`Sig'imi (yuk ko'tarishi), ${ext.type === "MIXER" ? "m³" : "tonna"}`} hint={ext.type === "MIXER" ? "Necha kub sig'adi — miqdor shundan oshmaydi" : "Necha tonna ko'taradi"}>
                  <Input name="extCapacity" type="number" step="0.5" min="0" value={ext.capacity} onChange={(e) => setExtField({ capacity: e.target.value })} />
                </Field>
                <Field label="Haydovchi ism-familiyasi *">
                  <Input name="extDriverName" value={ext.driverName} onChange={(e) => setExtField({ driverName: e.target.value })} autoComplete="off" required />
                </Field>
                <Field label="Haydovchi telefoni *" hint="+998 XX XXX XX XX">
                  <Input name="extDriverPhone" type="tel" value={ext.driverPhone} onChange={(e) => setExtField({ driverPhone: e.target.value })} placeholder="+998 90 123 45 67" autoComplete="off" required />
                </Field>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Texnika *"
                hint={typeMismatch ? undefined : order?.mixed ? (vehicle?.type === "MIXER" ? "Mikser — zayavkaning beton qatori" : "Yuk mashina — zayavkaning dona qatori") : order?.unit === "m³" ? "Beton — mikser" : `${order?.unit ?? "dona"} mahsulot — yuk mashina`}
                error={typeMismatch ? `Zayavka ${order?.unit} da — ${TYPE_LABEL[wantType(order)]} kerak, tanlangani ${TYPE_LABEL[vehicle?.type ?? ""] ?? vehicle?.type}` : undefined}
              >
                <Select name="vehicleId" value={vehicleId} onChange={(e) => { setVehicleManual(true); pickVehicle(e.target.value); }}>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {TYPE_LABEL[v.type] ?? v.type}{v.capacityM3 ? ` (${v.capacityM3} m³)` : ""}{v.state ? ` · ${v.state}` : ""}</option>)}
                </Select>
              </Field>
              <Field
                label="Haydovchi *"
                hint={driverOfVehicle(vehicleId) ? "Texnikaga biriktirilgan haydovchi — kerak bo'lsa almashtiring" : "Bu texnikaga haydovchi biriktirilmagan (Xodimlar kartasida biriktiriladi)"}
                error={driver && !driver.phoneOk ? "Telefon raqami yo'q — reys haydovchi ilovasiga bormaydi. Xodimlar sahifasida +998… formatida kiriting." : undefined}
              >
                {/* Haydovchi tanlansa uning texnikasi yuqorida o'zi tanlanadi */}
                <Select name="driverId" value={driverId} onChange={(e) => pickDriver(e.target.value)}>
                  {driverList.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}
                      {d.vehicleId === vehicleId ? (d.id === vehicle?.mainDriverId ? " · shu texnika (asosiy)" : " · shu texnika") : d.vehicleId ? "" : " · texnikasiz"}
                      {d.phoneOk ? "" : " · telefon yo'q"}
                    </option>
                  ))}
                </Select>
              </Field>
              {drivers.length === 0 && <p className="text-sm text-amber-700 sm:col-span-2">Haydovchi lavozimidagi faol xodim yo&apos;q — Otdel kadrda lavozimni &quot;haydovchi&quot; deb belgilang yoki ko&apos;chadan mashina chaqiring.</p>}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader icon={Package} title="Yuk" description={order ? `${order.customer} · ${order.date}${order.time ? ` ${order.time}` : ""}` : "Jadvaldan zayavkani tanlang"} />
          {order && (
            <div className="mb-4 space-y-1 text-sm text-slate-600">
              <p>Manzil: {order.address}</p>
              <p>
                Brigada tayyorlagan: <b className="text-slate-900">{avail} {unit}</b> reysga berish mumkin
                {inProd > 0 && <>, <b className="text-amber-700">{inProd} {unit}</b> hali ishlab chiqarilmoqda — brigada tasdiqini kuting</>}
              </p>
              {order.mixed && <p className="text-amber-700">Aralash zayavka (beton + {order.pieceUnit ?? "dona"}): mikser faqat betonni, yuk mashina faqat dona mahsulotni oladi. Bir turda bir nechta mahsulot bo&apos;lsa — zayavkani mahsulot bo&apos;yicha ajrating.</p>}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={`Miqdor, ${unit} *`} hint={overReady ? undefined : "Texnika sig'imi va tayyor qoldiqdan kichigi taklif qilinadi"} error={overReady}>
              <Input name="qtyM3" type="number" step="0.5" min="0.5" max={order ? avail : undefined} value={qty} onChange={(e) => setQty(e.target.value)} onFocus={() => !qty && suggest(order, vType, external ? extCap(ext) : vehicle?.capacityM3)} required />
            </Field>
            {concrete && (
              <Field label={`BRU${bruNames.length ? " *" : ""}`} hint={bruNames.length ? "Beton qaysi BRU dan olinadi — nakladnoyda ko'rinadi" : "BRU ro'yxati Logistika → Sozlamalar sahifasida kiritiladi"}>
                {bruNames.length ? (
                  <Select name="bru" value={bru} onChange={(e) => setBru(e.target.value)} required>
                    <option value="">— tanlang —</option>
                    {bruNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                ) : (
                  <Input name="bru" value={bru} onChange={(e) => setBru(e.target.value)} placeholder="Masalan: BRU-1" maxLength={80} />
                )}
              </Field>
            )}
            <Field label="Rejadagi yetkazish vaqti" hint="Zayavkadan olinadi. Dispetcher kalendari va kechikish hisobi shu vaqtga qaraydi" className={concrete ? "sm:col-span-2" : undefined}>
              <Input name="plannedAt" type="datetime-local" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
            </Field>
            <Field label="Izoh" className="sm:col-span-2"><Textarea name="note" /></Field>
          </div>
        </Card>
      </div>

      <FormActions>
        <Button disabled={pending || selectable.length === 0 || !order || !!overReady}>{pending ? "Yaratilmoqda…" : "Reys yaratish"}</Button>
        <LinkButton href="/trips" variant="secondary">Bekor</LinkButton>
      </FormActions>
    </form>
  );
}
