/**
 * QA (C) — ma'lumot doirasi (IDOR), direktor ruxsatlari (perms) va geofence.
 *   npx tsx scripts/qa/c-mobile-scope.ts                 — koordinata talabi o'chiq (standart)
 *   QA_GEOFENCE=on npx tsx scripts/qa/c-mobile-scope.ts  — server MOBILE_SITE_COORDS_REQUIRED=true bilan ishga tushirilgan bo'lsa
 */
import { api, check, done, section, tok } from "./c-lib";
import { PrismaClient } from "@/generated/prisma";

const db = new PrismaClient();
const GEO_ON = process.env.QA_GEOFENCE === "on";
const DEST = { lat: 41.311081, lng: 69.240562 };
const near = (m: number) => ({ lat: DEST.lat + m / 111_320, lng: DEST.lng });

async function main() {
  const drvUser = await db.user.findUniqueOrThrow({ where: { login: "test.haydovchi" }, include: { employee: true } });
  const drvEmp = drvUser.employee!.id;
  const drv = await tok("test.haydovchi");

  section("Haydovchi — faqat o'z reyslari (IDOR)");
  const list = await api("GET", "/api/mobile/list?key=trips", { token: drv });
  const ids: string[] = (list.json?.rows ?? []).map((r: { id: string }) => r.id);
  const own = await db.trip.findMany({ where: { id: { in: ids } }, select: { driverId: true } });
  check(`ro'yxatdagi ${ids.length} reysning hammasi o'ziniki`, ids.length > 0 && own.length === ids.length && own.every((t) => t.driverId === drvEmp), { ids: ids.length, own: own.length });
  const foreign = await db.trip.findFirst({ where: { driverId: { not: drvEmp } }, select: { id: true, orderId: true } });
  if (!foreign) { check("begona reys topilmadi — test ma'lumoti yetarli emas", false); }
  else {
    let r = await api("GET", `/api/mobile/detail?key=trips&id=${foreign.id}`, { token: drv });
    check("begona reys kartochkasi → 404", r.status === 404, r.status);
    r = await api("GET", `/api/mobile/trip-route?id=${foreign.id}`, { token: drv });
    check("begona reys marshruti → 404", r.status === 404, r.status);
    r = await api("POST", "/api/mobile/track", { token: drv, body: { tripId: foreign.id, points: [{ lat: 41.3, lng: 69.2, at: new Date().toISOString() }] } });
    check("begona reysga GPS iz → 403", r.status === 403, r.json);
    for (const a of ["trip.arrived", "trip.unloading", "trip.delivered", "trip.fuel", "trip.problem", "trip.returned"]) {
      r = await api("POST", "/api/mobile/action", { token: drv, body: { action: a, id: foreign.id, payload: { receiverName: "X", kind: "OTHER", liters: 10, pricePerL: 1000 } } });
      check(`begona reysda ${a} → 403`, r.status === 403, `${r.status} ${r.json?.message}`);
    }
    r = await api("POST", "/api/mobile/action", { token: drv, body: { action: "trip.arrived", id: `trips:${foreign.id}` } });
    check("`trips:<id>` havola orqali ham → 403", r.status === 403, r.status);
    r = await api("GET", `/api/mobile/detail?key=orders&id=${foreign.orderId}`, { token: drv });
    check("haydovchi zayavka kartochkasi → 403", r.status === 403, r.status);
    r = await api("GET", `/api/mobile/detail?key=trips&id=${encodeURIComponent(`orders:${foreign.orderId}`)}`, { token: drv });
    check("`orders:<id>` havola orqali → 403", r.status === 403, r.status);
  }
  const inv = await db.invoice.findFirst({ select: { id: true } });
  if (inv) {
    const r = await api("GET", `/api/mobile/detail?key=invoices&id=${inv.id}`, { token: drv });
    check("haydovchi schyot kartochkasi → 403", r.status === 403, r.status);
  }

  section("Brigadir — faqat o'z brigadasi");
  const brg = await tok("test.brigadir");
  const myBr = await db.brigade.findMany({ where: { leader: { userId: (await db.user.findUniqueOrThrow({ where: { login: "test.brigadir" } })).id } }, select: { id: true } });
  const otherTask = await db.brigadeTask.findFirst({ where: { brigadeId: { notIn: myBr.map((b) => b.id) } }, select: { id: true } });
  if (otherTask) {
    let r = await api("POST", "/api/mobile/action", { token: brg, body: { action: "task.progress", id: otherTask.id, payload: { qty: 1 } } });
    check("begona brigada topshirig'iga fakt → 403", r.status === 403, `${r.status} ${r.json?.message}`);
    r = await api("GET", `/api/mobile/detail?key=tasks&id=${otherTask.id}`, { token: brg });
    check("begona brigada topshirig'i kartochkasi → 403/404", r.status === 403 || r.status === 404, r.status);
  } else check("begona brigada topshirig'i yo'q — o'tkazib yuborildi", true);
  const ord = await db.order.findFirst({ select: { id: true } });
  if (ord) {
    const r = await api("GET", `/api/mobile/detail?key=orders&id=${ord.id}`, { token: brg });
    check("brigadir zayavka kartochkasi → 403", r.status === 403, r.status);
  }

  section("Boshqa rollar — begona bo'lim");
  const kassa = await tok("test.kassa");
  const trip1 = await db.trip.findFirst({ select: { id: true } });
  let r = await api("GET", `/api/mobile/trip-route?id=${trip1!.id}`, { token: kassa });
  check("kassir reys marshruti → 403", r.status === 403, r.status);
  r = await api("GET", `/api/mobile/trip-route?id=${trip1!.id}`, { token: await tok("test.logistika") });
  check("logist reys marshruti → 200", r.status === 200, r.json);
  r = await api("POST", "/api/mobile/action", { token: kassa, body: { action: "order.confirm", id: ord!.id } });
  check("kassir order.confirm → 403", r.status === 403, r.status);
  r = await api("GET", "/api/mobile/list?key=employees", { token: kassa });
  check("kassir xodimlar ro'yxati → 403", r.status === 403, r.status);

  section("Direktor ruxsatlari (User.perms)");
  const sotuv = await db.user.findUniqueOrThrow({ where: { login: "test.sotuv" } });
  const st = await tok("test.sotuv");
  try {
    await db.user.update({ where: { id: sotuv.id }, data: { perms: { orders: "none" } } });
    r = await api("GET", "/api/mobile/list?key=orders", { token: st });
    check("orders=none → ro'yxat 403", r.status === 403, r.status);
    r = await api("GET", `/api/mobile/detail?key=orders&id=${ord!.id}`, { token: st });
    check("orders=none → kartochka 403", r.status === 403, r.status);
    r = await api("GET", `/api/mobile/detail?key=sales&id=${ord!.id}`, { token: st });
    check("orders=none → `sales` kaliti orqali kartochka ham 403", r.status === 403, r.status);
    r = await api("GET", "/api/mobile/form?key=orders", { token: st });
    check("orders=none → forma 403", r.status === 403, r.status);
    r = await api("GET", "/api/mobile/home", { token: st });
    const quick = JSON.stringify(r.json?.quick ?? r.json ?? {});
    check("orders=none → bosh sahifa ishlaydi", r.status === 200, r.status);
    check("orders=none → tezkor amallarda 'Zayavkalar' ro'yxati yo'q", !/"key":"orders","label":"Zayavkalar"/.test(quick), quick.slice(0, 200));

    await db.user.update({ where: { id: sotuv.id }, data: { perms: { orders: "view" } } });
    r = await api("GET", "/api/mobile/list?key=orders", { token: st });
    check("orders=view → ro'yxat 200", r.status === 200, r.status);
    r = await api("GET", "/api/mobile/form?key=orders", { token: st });
    check("orders=view → yangi zayavka formasi 403", r.status === 403, r.status);
    r = await api("POST", "/api/mobile/create", { token: st, body: { key: "orders", payload: {} } });
    check("orders=view → yaratish 403", r.status === 403, r.status);
    r = await api("POST", "/api/mobile/action", { token: st, body: { action: "order.confirm", id: ord!.id } });
    check("orders=view → order.confirm 403", r.status === 403, r.status);

    await db.user.update({ where: { id: sotuv.id }, data: { perms: { orders: ["confirm"] } } });
    r = await api("GET", "/api/mobile/form?key=orders", { token: st });
    check("orders=[confirm] → yangi zayavka formasi 403 (create berilmagan)", r.status === 403, r.status);
    await db.user.update({ where: { id: sotuv.id }, data: { perms: { orders: ["create"] } } });
    r = await api("GET", "/api/mobile/form?key=orders", { token: st });
    check("orders=[create] → forma 200", r.status === 200, r.status);
    r = await api("POST", "/api/mobile/action", { token: st, body: { action: "order.confirm", id: ord!.id } });
    check("orders=[create] → order.confirm 403", r.status === 403, r.status);

    await db.user.update({ where: { id: sotuv.id }, data: { perms: { customers: "none" } } });
    r = await api("GET", "/api/mobile/list?key=customers", { token: st });
    check("customers=none → mijozlar 403", r.status === 403, r.status);
    r = await api("GET", "/api/mobile/form?key=customers", { token: st });
    check("customers=none → mijoz formasi 403", r.status === 403, r.status);
    r = await api("GET", "/api/mobile/list?key=orders", { token: st });
    check("customers=none → zayavkalar ochiq qoladi", r.status === 200, r.status);
  } finally {
    await db.$executeRaw`UPDATE "User" SET perms = NULL WHERE id = ${sotuv.id}`;
  }
  r = await api("GET", "/api/mobile/form?key=orders", { token: st });
  check("perms tozalangach — forma yana 200", r.status === 200, r.status);

  section(`Geofence (koordinata talabi: ${GEO_ON ? "YOQILGAN" : "o'chiq — standart"})`);
  const trip = await db.trip.findFirst({ where: { driverId: drvEmp }, orderBy: { createdAt: "desc" }, select: { id: true, orderId: true } });
  if (!trip) { check("haydovchining reysi yo'q", false); await db.$disconnect(); done(); }
  await db.order.update({ where: { id: trip!.orderId }, data: { lat: DEST.lat, lng: DEST.lng } });
  await db.trip.update({ where: { id: trip!.id }, data: { status: "ON_ROAD", departedAt: new Date(Date.now() - 30 * 60_000), arrivedAt: null, unloadingAt: null, deliveredAt: null, closedAt: null, returnedAt: null, receiverName: null } });
  await db.tripPosition.deleteMany({ where: { tripId: trip!.id } });
  const at = (s: number) => new Date(Date.now() - s * 1000);
  await db.tripPosition.createMany({ data: [180, 120, 30].map((s) => ({ tripId: trip!.id, ...near(15), at: at(s) })) });
  const act = (action: string, payload: Record<string, unknown>) => api("POST", "/api/mobile/action", { token: drv, body: { action, id: trip!.id, payload } });

  r = await act("trip.arrived", { ...near(5000) });
  check("5 km uzoqdagi (soxta) koordinata → 400 TOO_FAR", r.status === 400 && /Obyektgacha/.test(r.json?.message ?? ""), r.json);
  r = await act("trip.arrived", { lat: 999, lng: 69 });
  check("diapazondan tashqari koordinata → 400", r.status === 400, r.json);
  r = await act("trip.arrived", { lat: "abc", lng: 69.2 });
  check("matnli koordinata → 400", r.status === 400, r.json);
  r = await act("trip.arrived", { lat: 0, lng: 0 });
  check("(0,0) koordinata → 400", r.status === 400, r.json);
  r = await act("trip.delivered", { receiverName: "Ali", ...near(400) });
  check("400 m (radiusdan tashqari) yetkazdim → 400", r.status === 400, r.json);
  r = await act("trip.unloading", { ...near(2000) });
  check("2 km dan tushirish → 400", r.status === 400, r.json);
  const still = await db.trip.findUniqueOrThrow({ where: { id: trip!.id }, select: { arrivedAt: true, deliveredAt: true } });
  check("rad etilgan amallar holatni o'zgartirmadi", !still.arrivedAt && !still.deliveredAt, still);

  r = await act("trip.arrived", {});
  if (GEO_ON) check("koordinatasiz (eski ilova) → 426 APP_UPDATE_REQUIRED", r.status === 426 && r.json?.code === "APP_UPDATE_REQUIRED", r.json);
  else check("koordinatasiz (eski ilova) → saqlangan GPS izi bo'yicha o'tadi (200)", r.status === 200, r.json);
  if (GEO_ON) {
    r = await act("trip.arrived", { ...near(50), accuracy: 12 });
    check("50 m ichida → 200", r.status === 200, r.json);
  }
  const arr = await db.trip.findUniqueOrThrow({ where: { id: trip!.id }, select: { arrivedAt: true } });
  check("arrivedAt yozildi", !!arr.arrivedAt, arr);

  // Saqlangan iz soxta "ko'chish"ni ushlaydi: payload yaqin, lekin GPS izi 5 km uzoqda
  await db.trip.update({ where: { id: trip!.id }, data: { arrivedAt: null } });
  await db.tripPosition.deleteMany({ where: { tripId: trip!.id } });
  await db.tripPosition.createMany({ data: [120, 30].map((s) => ({ tripId: trip!.id, ...near(5000), at: at(s) })) });
  r = await act("trip.arrived", { ...near(10) });
  check("payload yaqin, lekin GPS izi uzoq → 400", r.status === 400, r.json);

  section("GPS iz (track)");
  r = await api("POST", "/api/mobile/track", { token: drv, body: { tripId: trip!.id, points: [{ lat: DEST.lat, lng: DEST.lng, at: new Date().toISOString() }] } });
  check("o'z reysiga iz → 200", r.status === 200 && r.json?.ok, r.json);
  r = await api("POST", "/api/mobile/track", { token: drv, body: { tripId: trip!.id, points: [{ lat: 999, lng: 0, at: new Date().toISOString() }] } });
  check("noto'g'ri nuqta → 400 yoki rejected", r.status === 400 || (r.status === 200 && r.json?.rejected >= 1), r.json);
  r = await api("POST", "/api/mobile/track", { token: await tok("test.logistika"), body: { tripId: trip!.id, points: [] } });
  check("logist iz yubora olmaydi → 400/403", r.status === 403 || r.status === 400, r.status);

  await db.$disconnect();
  done();
}
void main();
