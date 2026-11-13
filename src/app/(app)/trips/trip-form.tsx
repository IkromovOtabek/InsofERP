"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Package, Trash2, Truck } from "lucide-react";
import { createTrip, hideExternalVehicle, updateTrip } from "./actions";
import { Button, Callout, Card, CardHeader, Checkbox, Field, FormActions, FormError, Input, LinkButton, Select, Textarea } from "@/components/ui";

/** Zayavka qatori (mahsulot birligida): jami, tayyor, jo'natilgan, hozir reysga mumkin. mixer — beton qatori (mikserda ketadi). */
type Line = { productId: string; name: string; unit: string; qty: number; ready: number; shipped: number; available: number; inProduction: number; mixer: boolean };
/**
 * remainingM3 — hozir reysga berish mumkin bo'lgan miqdor: brigada tayyorlagani − jo'natilgani.
 * inProduction — hali sexda (brigada tasdiqlamagan). unit — zayavkadagi mahsulot birligi ("m³", "dona"…).
 * lines — aralash zayavkada tayyor qoldiq texnika turiga mos qator bo'yicha hisoblanadi.
 */
type Order = {
  id: string; date: string; time: string | null; customer: string; address: string; remainingM3: number; inProduction: number;
  unit: string; plannedAt: string; mixed?: boolean; pieceUnit?: string; lines: Line[];
};
/** Qoldig'i bor, lekin tayyor mahsuloti yo'q zayavka — ro'yxatga kirmaydi, sababi ko'rsatiladi. */
type Waiting = { id: string; date: string; customer: string; inProduction: number; unit: string; hasTasks: boolean };
/** type — MIXER (beton) yoki TRUCK (dona mahsulot: plita, blok). */
type Vehicle = { id: string; plate: string; type: string; capacityM3: number | null; state?: string; mainDriverId?: string | null };
const TYPE_LABEL: Record<string, string> = { MIXER: "mikser", TRUCK: "yuk mashina", PUMP: "nasos" };
/** vehicleId — xodim kartasida biriktirilgan mikser; phoneOk — ECO topa oladigan +998… raqami bormi. */
type Driver = { id: string; fullName: string; vehicleId: string | null; phoneOk: boolean };
/** Avval chaqirilgan ko'cha mashinasi — ro'yxatdan tanlansa yoki raqami yozilsa haydovchisi va sig'imi o'zi to'ladi. */
type External = { id: string; plate: string; type: "MIXER" | "TRUCK"; capacity: number | null; driverName: string; driverPhone: string };
type ExtForm = { type: "MIXER" | "TRUCK"; plate: string; capacity: string; driverName: string; driverPhone: string };
/**
 * Rejadagi reys tahriri (`/trips/[id]/edit`): forma shu reys qiymatlari bilan ochiladi, zayavka va TTN o'zgarmaydi.
 * external — reys ko'chadan mashinada bo'lsa uning ma'lumoti; externalLocked — ko'chadan mashinaga o'tkazib bo'lmasligi sababi.
 */
type Edit = {
  tripId: string; vehicleId: string; driverId: string; qty: number; bru: string; note: string; driverReason: string;
  external: ExtForm | null; externalLocked?: string;
};

const normPlate = (v: string) => v.toUpperCase().replace(/\s+/g, "");
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 1000) / 1000;

export function TripForm({ orders, waiting = [], vehicles, drivers, bruNames, externals, initialOrderId, edit }: {
  orders: Order[]; waiting?: Waiting[]; vehicles: Vehicle[]; drivers: Driver[]; bruNames: string[]; externals: External[]; initialOrderId?: string; edit?: Edit;
}) {
  // Tahrirda — shu reysning `updateTrip` i (qoidalar «Yangi reys» bilan bir xil, `lib/trips.ts`)
  const editId = edit?.tripId;
  const submit = useMemo(() => (editId ? updateTrip.bind(null, editId) : createTrip), [editId]);
  const [state, action, pending] = useActionState(submit, undefined);
  const [orderId, setOrderId] = useState(orders.find((o) => o.id === initialOrderId)?.id ?? orders[0]?.id ?? "");
  const firstOrder = orders.find((o) => o.id === orderId);
  // Rejadagi yetkazish vaqti — zayavkadan olinadi, dispetcher o'zgartira oladi (kalendar va kechikish shunga qaraydi)
  const [plannedAt, setPlannedAt] = useState(firstOrder?.plannedAt ?? "");
  // Zayavka birligiga mos texnika: beton (m³) — mikser, dona mahsulot — yuk mashina
  // Aralash zayavkada (beton + dona) ikkala tur ham to'g'ri: mikser betonni, yuk mashina dona qatorini oladi
  const wantType = (o?: Order): "MIXER" | "TRUCK" => (o && o.unit !== "m³" && !o.mixed ? "TRUCK" : "MIXER");
  const fits = (o?: Order, type?: string) => !o || !type || (o.mixed ? type === "MIXER" || type === "TRUCK" : type === wantType(o));
  const firstOfType = (t: string) => vehicles.find((v) => v.type === t) ?? vehicles[0];
  // Tahrirda reysning o'z texnikasi va haydovchisi (ko'chadan mashinada — ro'yxatdagi birinchi mos texnika, belgi olinsa)
  const ownEdit = edit && !edit.external ? edit : null;
  const [vehicleId, setVehicleId] = useState(ownEdit?.vehicleId ?? firstOfType(wantType(firstOrder))?.id ?? "");
  // Texnikaga biriktirilgan haydovchi — Xodimlar kartasidagi "biriktirilgan texnika". Smenali transportda bir nechta:
  // avval kartadagi asosiy haydovchi, u bo'lmasa birinchisi (smenadoshni dispetcher ro'yxatdan tanlaydi)
  const driverOfVehicle = (vid: string) => {
    const main = vehicles.find((v) => v.id === vid)?.mainDriverId;
    return drivers.find((d) => d.vehicleId === vid && d.id === main) ?? drivers.find((d) => d.vehicleId === vid);
  };
  const [driverId, setDriverId] = useState(ownEdit?.driverId ?? driverOfVehicle(firstOfType(wantType(firstOrder))?.id ?? "")?.id ?? drivers[0]?.id ?? "");
  // Ko'chadan chaqirilgan mashina: o'z parkimiz hammasi band bo'lganda ish to'xtab qolmasin
  const [external, setExternal] = useState(!!edit?.external);
  const [ext, setExt] = useState<ExtForm>(edit?.external ?? { type: wantType(firstOrder), plate: "", capacity: "", driverName: "", driverPhone: "" });
  // Saqlangan ko'cha mashinalari: ro'yxatdan olingani server javobini kutmay yo'qoladi
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const saved = externals.filter((x) => !hiddenIds.includes(x.id));
  const savedCar = saved.find((x) => normPlate(x.plate) === normPlate(ext.plate) && ext.plate.trim() !== "");
  const [hiding, startHide] = useTransition();
  const [hideError, setHideError] = useState<string>();

  const order = orders.find((o) => o.id === orderId);
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const driver = drivers.find((d) => d.id === driverId);
  // Texnikaning o'z haydovchisi bor, lekin boshqasi tanlangan — sabab majburiy (`createTrip` ham tekshiradi)
  const ownDriver = driverOfVehicle(vehicleId);
  const otherDriver = !external && !!driver && !!ownDriver && driver.vehicleId !== vehicleId;
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
  const [qty, setQty] = useState(edit ? String(edit.qty) : firstOrder ? String(Math.min(vehicle?.capacityM3 ?? availOf(firstOrder, vehicle?.type), availOf(firstOrder, vehicle?.type))) : "");
  const [bru, setBru] = useState(edit ? edit.bru : bruNames.length === 1 ? bruNames[0]! : "");
  // Reysdagi BRU ro'yxatdan olib tashlangan bo'lsa ham tanlovda ko'rinsin (aks holda forma uni jimgina bo'shatardi)
  const bruList = edit?.bru && !bruNames.includes(edit.bru) ? [...bruNames, edit.bru] : bruNames;
  // Boshqariladigan: xato bilan qaytganda (`<form action>` formani tozalaydi) yozilgan TTN, izoh va sabab yo'qolmasin
  const [ttn, setTtn] = useState("");
  const [note, setNote] = useState(edit?.note ?? "");
  const [driverReason, setDriverReason] = useState(edit?.driverReason ?? "");
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
    // Tahrirda yozilgan miqdor oshirilmaydi — faqat sig'im va qoldiqqa sig'diriladi
    const cur = edit ? Number(qty) || a : a;
    setQty(String(Math.min(cap ?? cur, cur, a)));
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
  // dispetcher texnikani hali qo'lda tanlamagan va tanlangan texnikaning o'z haydovchisi yo'q bo'lsa.
  // O'z haydovchisi bor texnikaga boshqa haydovchi berish mumkin — texnika joyida qoladi, sababi yoziladi
  const [vehicleManual, setVehicleManual] = useState(!!edit);
  const pickDriver = (did: string) => {
    setDriverId(did);
    if (vehicleManual || driverOfVehicle(vehicleId)) return;
    const d = drivers.find((x) => x.id === did);
    const v = d?.vehicleId ? vehicles.find((x) => x.id === d.vehicleId) : undefined;
    if (v && fits(order, v.type)) { setVehicleId(v.id); suggest(order, v.type, v.capacityM3); }
  };
  // Zayavka almashsa — birligiga mos texnika turiga o'tamiz (mikser ↔ yuk mashina)
  const pickOrder = (oid: string) => {
    setOrderId(oid);
    const o = orders.find((x) => x.id === oid);
    setPlannedAt(o?.plannedAt ?? "");
    if (!o) return;
    if (external) {
      const e = { ...ext, type: fits(o, ext.type) ? ext.type : wantType(o) };
      setExt(e);
      suggest(o, e.type, extCap(e));
      return;
    }
    if (vehicle && fits(o, vehicle.type)) { suggest(o, vehicle.type, vehicle.capacityM3); return; }
    const v = firstOfType(wantType(o));
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
      const known = saved.find((x) => normPlate(x.plate) === normPlate(patch.plate!));
      if (known) Object.assign(e, { type: known.type, capacity: known.capacity != null ? String(known.capacity) : e.capacity, driverName: known.driverName || e.driverName, driverPhone: known.driverPhone || e.driverPhone });
    }
    setExt(e);
    if (patch.type != null || patch.capacity != null || patch.plate != null) suggest(order, e.type, extCap(e));
  };
  // Saqlangan ro'yxatdan tanlash: mashina va haydovchi ma'lumoti to'liq to'ladi; «Yangi mashina» — maydonlar tozalanadi
  const pickSaved = (id: string) => {
    const x = saved.find((s) => s.id === id);
    const e: ExtForm = x
      ? { type: x.type, plate: x.plate, capacity: x.capacity != null ? String(x.capacity) : "", driverName: x.driverName, driverPhone: x.driverPhone }
      : { ...ext, plate: "", capacity: "", driverName: "", driverPhone: "" };
    setExt(e);
    suggest(order, e.type, extCap(e));
  };
  // Ro'yxatdan olish — mashina bazada qoladi (reyslari, nakladnoy), shu raqam yana chaqirilsa ro'yxatga qaytadi
  const hideSaved = () => {
    const x = savedCar;
    if (!x || !confirm(`${x.plate} ro'yxatdan olinsinmi?\nReyslari va nakladnoylari saqlanib qoladi; shu raqam yana chaqirilsa, ro'yxatga qaytadi.`)) return;
    setHideError(undefined);
    startHide(async () => {
      const r = await hideExternalVehicle(x.id);
      if (r?.error) { setHideError(r.error); return; }
      setHiddenIds((ids) => [...ids, x.id]);
      pickSaved("");
    });
  };

  return (
    <form action={action} className="space-y-5">
      <FormError error={state?.error} />

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Truck} title="Transport" description={external ? "Ko'chadan chaqirilgan mashina va haydovchi" : "O'z texnikamiz va haydovchimiz"} />
          <div className="mb-4">
            <Checkbox label="Ko'chadan mashina chaqirildi" checked={external} onChange={(e) => toggleExternal(e.target.checked)} disabled={!!edit?.externalLocked && !external} />
            {edit?.externalLocked && !external && <p className="mt-1 text-xs text-slate-500">{edit.externalLocked}</p>}
          </div>
          {external ? (
            <>
              <input type="hidden" name="external" value="1" />
              <Callout tone="info">
                O&apos;z transportimiz hammasi band bo&apos;lsa, ish to&apos;xtab qolmasligi uchun tashqaridan mashina chaqiriladi. Mashina va haydovchi faqat
                reys uchun yoziladi: park, kadr va oylik ro&apos;yxatlariga kirmaydi, haydovchi ilovasiga yuborilmaydi — bosqichlarni (yuklandi, yo&apos;lga chiqdi, yetkazildi) dispetcher shu yerdan belgilaydi.
              </Callout>
              {saved.length > 0 && (
                <Field
                  label="Avval chaqirilgan mashina"
                  className="mb-4"
                  hint={savedCar ? "Ma'lumoti quyida to'ldirildi — kerak bo'lsa o'zgartiring" : "Ro'yxatdan tanlang yoki yangi mashina ma'lumotini yozing"}
                  error={hideError}
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Select value={savedCar?.id ?? ""} onChange={(e) => pickSaved(e.target.value)} aria-label="Avval chaqirilgan mashina">
                      <option value="">— Yangi mashina —</option>
                      {saved.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.plate} · {TYPE_LABEL[x.type]}{x.capacity ? ` ${x.capacity} ${x.type === "MIXER" ? "m³" : "t"}` : ""}{x.driverName ? ` · ${x.driverName}` : ""}
                        </option>
                      ))}
                    </Select>
                    <Button type="button" variant="secondary" onClick={hideSaved} disabled={!savedCar || hiding} title="Mashina bazada qoladi, faqat shu ro'yxatda ko'rinmaydi">
                      <Trash2 size={16} /> {hiding ? "Olinmoqda…" : "Ro'yxatdan olish"}
                    </Button>
                  </div>
                </Field>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Mashina kategoriyasi *" error={typeMismatch ? `Zayavka ${order?.unit} da — ${TYPE_LABEL[wantType(order)]} kerak` : undefined} hint={typeMismatch ? undefined : ext.type === "MIXER" ? "Beton — mikserda" : "Dona mahsulot (ustun, blok, plita)"}>
                  <Select name="extType" value={ext.type} onChange={(e) => setExtField({ type: e.target.value as ExtForm["type"] })}>
                    <option value="MIXER">Mikser (beton)</option>
                    <option value="TRUCK">Yuk mashina (dona mahsulot)</option>
                  </Select>
                </Field>
                <Field label="Mashina raqami *" hint={savedCar ? "Avval chaqirilgan — ma'lumoti to'ldirildi" : "Masalan: 01 A 123 BC"}>
                  <Input name="extPlate" value={ext.plate} onChange={(e) => setExtField({ plate: e.target.value.toUpperCase() })} autoComplete="off" required />
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
                hint={otherDriver ? `Texnikaning o'z haydovchisi: ${ownDriver!.fullName} — boshqasini berish sababini yozing` : ownDriver ? "Texnikaga biriktirilgan haydovchi — kerak bo'lsa boshqasini tanlang" : "Bu texnikaga haydovchi biriktirilmagan (Transport yoki Haydovchi kartasida biriktiriladi)"}
                error={driver && !driver.phoneOk ? "Telefon raqami yo'q — reys haydovchi ilovasiga bormaydi. Xodimlar sahifasida +998… formatida kiriting." : undefined}
              >
                {/* Texnikaning o'z haydovchisi bo'lmasa — tanlangan haydovchining texnikasi yuqorida o'zi tanlanadi */}
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
              {otherDriver && (
                <Field label="Boshqa haydovchi sababi *" hint="Reys kartasida va jurnalda saqlanadi" className="sm:col-span-2">
                  <Input name="driverReason" value={driverReason} onChange={(e) => setDriverReason(e.target.value)} placeholder="Masalan: asosiy haydovchi kasal" minLength={3} maxLength={200} autoComplete="off" required />
                </Field>
              )}
              {drivers.length === 0 && <p className="text-sm text-amber-700 sm:col-span-2">Haydovchi lavozimidagi faol xodim yo&apos;q — Otdel kadrda lavozimni &quot;haydovchi&quot; deb belgilang yoki ko&apos;chadan mashina chaqiring.</p>}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader icon={Package} title="Yuk" description={edit ? "Zayavka o'zgarmaydi — miqdor, BRU, vaqt va izohni tahrirlang" : "Jo'natishga tayyor zayavka va miqdor"} />
          <Field label="Zayavka *" className="mb-3">
            <Select name="orderId" value={orderId} onChange={(e) => pickOrder(e.target.value)} disabled={!!edit}>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.customer} · {o.date} · tayyor {o.remainingM3} {o.unit}{o.inProduction > 0 ? ` · sexda ${o.inProduction} ${o.unit}` : ""}{o.mixed ? " · aralash" : ""}</option>)}
            </Select>
          </Field>
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
                    {bruList.map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                ) : (
                  <Input name="bru" value={bru} onChange={(e) => setBru(e.target.value)} placeholder="Masalan: BRU-1" maxLength={80} />
                )}
              </Field>
            )}
            {/* Tahrirda TTN reys sahifasidagi alohida formada (band raqam tekshiruvi bilan) */}
            {!edit && (
              <Field label="TTN raqami" hint="Nakladnoy blankasidagi raqam — nakladnoyda va Realizatsiyada shu ko'rinadi. Bo'sh qolsa tizim raqami (N-…)">
                <Input name="ttn" value={ttn} onChange={(e) => setTtn(e.target.value)} maxLength={40} autoComplete="off" placeholder="Masalan: 000161" className="tabular" />
              </Field>
            )}
            <Field label="Rejadagi yetkazish vaqti" hint="Zayavkadan olinadi. Dispetcher kalendari va kechikish hisobi shu vaqtga qaraydi" className={concrete ? undefined : "sm:col-span-2"}>
              <Input name="plannedAt" type="datetime-local" value={plannedAt} onChange={(e) => setPlannedAt(e.target.value)} />
            </Field>
            <Field label="Izoh" className="sm:col-span-2"><Textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        </Card>
      </div>

      <FormActions>
        <Button disabled={pending || orders.length === 0 || !order || !!overReady}>{pending ? (edit ? "Saqlanmoqda…" : "Yaratilmoqda…") : edit ? "Saqlash" : "Reys yaratish"}</Button>
        <LinkButton href={edit ? `/trips/${edit.tripId}` : "/trips"} variant="secondary">Bekor</LinkButton>
      </FormActions>
      {orders.length === 0 && <p className="text-sm text-amber-700">Jo&apos;natishga tayyor zayavka yo&apos;q — brigada tasdiqlagan mahsulot bo&apos;lishi kerak.</p>}
      {waiting.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">Brigada tasdiqini kutayotgan zayavkalar (reysga hali berilmaydi):</p>
          <ul className="mt-1 space-y-0.5">
            {waiting.map((w) => (
              <li key={w.id}>
                <Link href={`/orders/${w.id}`} className="font-medium hover:underline">{w.customer}</Link> · {w.date} —{" "}
                {w.hasTasks ? `${w.inProduction} ${w.unit} ishlab chiqarilmoqda` : "brigada tayinlanmagan"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
