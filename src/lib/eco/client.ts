/**
 * Insof ECO (haydovchi ilovasi backend'i) HTTP klienti — kutubxonasiz fetch.
 * Sozlash: ECO_API_URL, ECO_API_KEY (ECO'da `integration:create` skripti beradi).
 * Endpointlar ECO tomonida `/v1/erp/*` — faqat X-Api-Key bilan ochiladi.
 */

export const ECO_STATUSES = ["ASSIGNED", "ACCEPTED", "DECLINED", "LOADING", "EN_ROUTE", "ARRIVED", "UNLOADING", "COMPLETED", "DISPUTED", "FAILED", "CANCELLED"] as const;
export type EcoStatus = (typeof ECO_STATUSES)[number];

export type EcoDriver = {
  userId: string; fullName: string | null; phone: string; isActive: boolean; isAvailable: boolean;
  activeDelivery: { id: string; externalRef: string | null; status: EcoStatus } | null;
};
export type EcoVehicle = { id: string; plateNumber: string; capacityM3: string | number; type: string; isActive: boolean };
export type EcoDelivery = {
  id: string; externalRef: string | null; sequence: number; status: EcoStatus;
  plannedM3: string; loadedM3: string | null; acceptedM3: string | null; plannedAt: string;
  departedAt: string | null; arrivedAt: string | null; completedAt: string | null; slaBreached: boolean; signatureKey: string | null;
  order: { id: string; number: number; externalRef: string | null; address: string; status: string; client: { id: string; name: string } };
  driver: { id: string; userId: string; user: { id: string; fullName: string | null; phone: string } } | null;
  vehicle: { id: string; plateNumber: string; capacityM3: string } | null;
  events: { from: EcoStatus | null; to: EcoStatus; at: string; receivedAt: string; note: string | null; lat: number | null; lng: number | null; byRole: string }[];
};
export type EcoTripPayload = {
  orderRef: string;
  customer: { name: string; inn?: string; phone?: string };
  address: string;
  location?: { lat: number; lng: number };
  scheduledAt: string;
  product: { grade: string; name: string; unitPrice: number };
  plannedM3: number;
  driverPhone?: string;
  driverName?: string;
  vehiclePlate?: string;
  vehicleCapacityM3?: number;
  note?: string;
};

export class EcoError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly details?: unknown) { super(message); }
}

export function ecoEnabled() {
  return !!(process.env.ECO_API_URL && process.env.ECO_API_KEY);
}
export const ecoUrl = () => (process.env.ECO_API_URL ?? "").replace(/\/+$/, "");

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!ecoEnabled()) throw new EcoError("ECO_DISABLED", "ECO ulanmagan: .env da ECO_API_URL va ECO_API_KEY yo'q", 503);
  let res: Response;
  try {
    res = await fetch(`${ecoUrl()}/v1/erp${path}`, {
      method,
      headers: { "content-type": "application/json", "x-api-key": process.env.ECO_API_KEY! },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (e) {
    throw new EcoError("ECO_UNREACHABLE", `ECO serveriga ulanib bo'lmadi (${ecoUrl()}): ${(e as Error).message}`, 502);
  }
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* matn */ }
  if (!res.ok) {
    const err = (json ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new EcoError(err.code ?? `HTTP_${res.status}`, err.message ?? text.slice(0, 200) ?? res.statusText, res.status, err.details);
  }
  return json as T;
}

export const eco = {
  ping: () => call<{ ok: boolean; client: string; organization: { id: string; name: string; inn: string | null }; serverTime: string }>("GET", "/ping"),
  drivers: () => call<EcoDriver[]>("GET", "/drivers"),
  upsertDriver: (phone: string, fullName: string) => call<{ userId: string; phone: string; fullName: string; isActive: boolean }>("PUT", "/drivers", { phone, fullName }),
  vehicles: () => call<EcoVehicle[]>("GET", "/vehicles"),
  upsertVehicle: (plateNumber: string, capacityM3: number, type?: "MIXER" | "PUMP" | "TRUCK") =>
    call<EcoVehicle>("PUT", "/vehicles", { plateNumber, capacityM3, type: type === "TRUCK" ? "TRUCK" : type }),
  trips: (date?: string) => call<EcoDelivery[]>("GET", `/trips${date ? `?date=${date}` : ""}`),
  trip: (ref: string) => call<EcoDelivery>("GET", `/trips/${encodeURIComponent(ref)}`),
  upsertTrip: (ref: string, p: EcoTripPayload) => call<{ created: boolean; changed: boolean; delivery: EcoDelivery }>("PUT", `/trips/${encodeURIComponent(ref)}`, p),
  setStatus: (ref: string, to: "ACCEPTED" | "LOADING" | "EN_ROUTE" | "COMPLETED" | "CANCELLED", extra?: { at?: Date; note?: string; loadedM3?: number; acceptedM3?: number }) =>
    call<EcoDelivery>("POST", `/trips/${encodeURIComponent(ref)}/status`, { to, ...extra, at: extra?.at?.toISOString() }),
};

/** ERP'dagi erkin formatdagi telefon → ECO talab qiladigan +998XXXXXXXXX. Mos kelmasa null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const d = digits.length === 9 ? `998${digits}` : digits;
  return /^998\d{9}$/.test(d) ? `+${d}` : null;
}
