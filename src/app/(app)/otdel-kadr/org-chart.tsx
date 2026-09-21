"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Calculator, ChevronRight, Compass, Crown, Factory, Handshake, IdCard, Maximize2, Minus, Package,
  Phone, Plus, ShieldCheck, Truck, User, Users, Wallet, X, Eye, EyeOff, FileText, CircleSlash,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@/generated/prisma";
import { ORG_STAGES, ORG_TREE, chainTo, departmentOf, type OrgDept, type OrgTone } from "@/lib/orgchart";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui";

/* ═══════════════════════ Kiruvchi ma'lumot ═══════════════════════ */

export type OrgEmployee = {
  id: string; fullName: string; position: string; phone: string | null;
  hiredAt: string | null; photo: boolean; isActive: boolean; login: boolean; docs: number;
};
export type OrgPosition = { id: string; name: string; note: string | null; department: string | null; isDriver: boolean };

/* ═══════════════════════ Chizma o'lchamlari ═══════════════════════ */

const CARD_W = 208, CARD_H = 86;   // bo'lim kartochkasi
const GAP_X = 24, LEVEL_H = 140;   // ustunlar orasi / qavat balandligi
const CHIP_W = 176, CHIP_H = 44, CHIP_GAP = 8, STACK_TOP = 28;
const SPINE_DX = -84, CHIP_DX = -72; // vertikal chiziq va chip kartochka markazidan qancha chapda
const PAD_X = 28, PAD_TOP = 8, PAD_BOTTOM = 24;

/* ═══════════════════════ Ranglar ═══════════════════════ */

const TONES: Record<OrgTone, { card: string; icon: string; ring: string; chip: string; num: string; bar: string }> = {
  slate:   { card: "border-slate-300",   icon: "bg-slate-900 text-white",       ring: "ring-slate-400/50",   chip: "hover:border-slate-300",  num: "bg-slate-100 text-slate-700",     bar: "bg-slate-400" },
  violet:  { card: "border-violet-300",  icon: "bg-violet-100 text-violet-700", ring: "ring-violet-400/50",  chip: "hover:border-violet-300", num: "bg-violet-50 text-violet-700",    bar: "bg-violet-500" },
  amber:   { card: "border-amber-300",   icon: "bg-amber-100 text-amber-700",   ring: "ring-amber-400/50",   chip: "hover:border-amber-300",  num: "bg-amber-50 text-amber-700",      bar: "bg-amber-500" },
  orange:  { card: "border-orange-200",  icon: "bg-orange-100 text-orange-700", ring: "ring-orange-400/50",  chip: "hover:border-orange-200", num: "bg-orange-50 text-orange-700",    bar: "bg-orange-500" },
  blue:    { card: "border-blue-300",    icon: "bg-blue-100 text-blue-700",     ring: "ring-blue-400/50",    chip: "hover:border-blue-300",   num: "bg-blue-50 text-blue-700",        bar: "bg-blue-500" },
  emerald: { card: "border-emerald-300", icon: "bg-emerald-100 text-emerald-700", ring: "ring-emerald-400/50", chip: "hover:border-emerald-300", num: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  sky:     { card: "border-sky-200",     icon: "bg-sky-100 text-sky-700",       ring: "ring-sky-400/50",     chip: "hover:border-sky-200",    num: "bg-sky-50 text-sky-700",          bar: "bg-sky-500" },
};

const ICONS: Record<string, LucideIcon> = {
  crown: Crown, compass: Compass, factory: Factory, package: Package, truck: Truck,
  handshake: Handshake, calculator: Calculator, wallet: Wallet, users: Users, shieldCheck: ShieldCheck,
};

/* ═══════════════════════ Tuzilmani yig'ish ═══════════════════════ */

type PosNode = { id: string; name: string; note: string | null; isDriver: boolean; staff: OrgEmployee[] };
type Node = {
  dept: OrgDept; children: Node[]; positions: PosNode[]; staff: OrgEmployee[];
  x: number; y: number; total: number; logins: number;
};

const key = (s: string) => s.trim().toLowerCase();

function buildTree(employees: OrgEmployee[], positions: OrgPosition[], showEmpty: boolean) {
  const byPos = new Map<string, OrgEmployee[]>();
  for (const e of employees) {
    const k = key(e.position);
    const list = byPos.get(k);
    if (list) list.push(e); else byPos.set(k, [e]);
  }

  const posByDept = new Map<Role, PosNode[]>();
  const orphanPositions: PosNode[] = [];
  for (const p of positions) {
    const staff = byPos.get(key(p.name)) ?? [];
    const node: PosNode = { id: p.id, name: p.name, note: p.note, isDriver: p.isDriver, staff };
    if (!showEmpty && staff.length === 0) continue;
    const dept = departmentOf(p);
    if (!dept) { orphanPositions.push(node); continue; }
    const list = posByDept.get(dept);
    if (list) list.push(node); else posByDept.set(dept, [node]);
  }

  const make = (dept: OrgDept): Node => {
    const staff = byPos.get(key(dept.label)) ?? [];
    const children = ORG_TREE.filter((d) => d.parent === dept.role).map(make);
    const own = posByDept.get(dept.role) ?? [];
    const positionsSorted = [...own].sort((a, b) => b.staff.length - a.staff.length || a.name.localeCompare(b.name));
    const node: Node = { dept, children, positions: positionsSorted, staff, x: 0, y: 0, total: 0, logins: 0 };
    node.total = staff.length
      + positionsSorted.reduce((s, p) => s + p.staff.length, 0)
      + children.reduce((s, c) => s + c.total, 0);
    node.logins = staff.filter((e) => e.login).length + children.reduce((s, c) => s + c.logins, 0);
    return node;
  };

  const root = make(ORG_TREE.find((d) => !d.parent)!);

  // Tuzilmaga tushmagan xodimlar: lavozimi na bo'lim, na ishchi lavozim (eski nomlar)
  const known = new Set<string>([...ORG_TREE.map((d) => key(d.label)), ...positions.map((p) => key(p.name))]);
  const strays = employees.filter((e) => !known.has(key(e.position)));
  const strayGroups = [...strays.reduce((m, e) => {
    const list = m.get(e.position); if (list) list.push(e); else m.set(e.position, [e]);
    return m;
  }, new Map<string, OrgEmployee[]>())].map(([name, staff]) => ({ name, staff }));

  return { root, orphanPositions, strayGroups };
}

/** Kenglik → joylashuv: har tugun bolalari ustida markazlashadi. */
function layout(root: Node) {
  const widths = new Map<Node, number>();
  const measure = (n: Node): number => {
    const cached = widths.get(n);
    if (cached !== undefined) return cached;
    const kids = n.children.reduce((s, c) => s + measure(c), 0) + Math.max(0, n.children.length - 1) * GAP_X;
    const w = Math.max(CARD_W, kids);
    widths.set(n, w);
    return w;
  };
  measure(root);

  const all: Node[] = [];
  const place = (n: Node, left: number, depth: number) => {
    all.push(n);
    n.y = PAD_TOP + depth * LEVEL_H;
    const w = widths.get(n)!;
    if (n.children.length === 0) { n.x = left + w / 2; return; }
    const kids = n.children.reduce((s, c) => s + widths.get(c)!, 0) + (n.children.length - 1) * GAP_X;
    let cur = left + (w - kids) / 2;
    for (const c of n.children) { place(c, cur, depth + 1); cur += widths.get(c)! + GAP_X; }
    n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
  };
  place(root, PAD_X, 0);

  const stackH = (n: Node) => (n.positions.length ? STACK_TOP + n.positions.length * CHIP_H + (n.positions.length - 1) * CHIP_GAP : 0);
  const width = widths.get(root)! + PAD_X * 2;
  const height = Math.max(...all.map((n) => n.y + CARD_H + stackH(n))) + PAD_BOTTOM;
  return { nodes: all, width, height };
}

/** Yumshoq burchakli ulagich: pastga → yon tomonga → pastga. */
function elbow(x1: number, y1: number, x2: number, y2: number) {
  if (Math.abs(x2 - x1) < 1) return `M${x1},${y1} V${y2}`;
  const my = y1 + (y2 - y1) / 2;
  const dir = x2 > x1 ? 1 : -1;
  const r = Math.min(14, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  return `M${x1},${y1} V${my - r} Q${x1},${my} ${x1 + dir * r},${my} H${x2 - dir * r} Q${x2},${my} ${x2},${my + r} V${y2}`;
}

/* ═══════════════════════ Asosiy komponent ═══════════════════════ */

type Sel =
  | { kind: "dept"; node: Node }
  | { kind: "pos"; pos: PosNode; dept: OrgDept | null }
  | { kind: "stray"; name: string; staff: OrgEmployee[] };

export function OrgChart({ employees, positions, stageCounts }: {
  employees: OrgEmployee[]; positions: OrgPosition[]; stageCounts: Record<string, number>;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  // `null` — chizma kartochka eniga o'zi moslashadi; raqam — foydalanuvchi qo'lda tanlagan masshtab
  const [zoom, setZoom] = useState<number | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);

  const { root, orphanPositions, strayGroups } = useMemo(() => buildTree(employees, positions, showEmpty), [employees, positions, showEmpty]);
  const { nodes, width, height } = useMemo(() => layout(root), [root]);

  // Ekranga sig'ishi uchun boshlang'ich masshtab. 70% dan pastga tushmaydi: undan kichigida yozuv
  // o'qilmay qoladi, shuning uchun tor ekranda chizma gorizontal aylantiriladi.
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setFit(Math.max(0.7, Math.min(1, +((el.clientWidth - 8) / width).toFixed(2))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  const z = zoom ?? fit;

  const emptyCount = useMemo(() => positions.filter((p) => !employees.some((e) => key(e.position) === key(p.name))).length, [positions, employees]);
  const activeStage = ORG_STAGES.find((s) => s.key === stage) ?? null;
  const lit = (role: Role) => !activeStage || activeStage.roles.includes(role);

  return (
    <div className="space-y-4">
      <StageRibbon counts={stageCounts} active={stage} onPick={(k) => { setStage(k === stage ? null : k); setSel(null); }} />

      <div className="relative overflow-hidden rounded-(--radius-card) border border-slate-200/80 bg-white shadow-(--shadow-card)">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Tashkiliy tuzilma</h2>
            <p className="text-xs text-slate-500">
              {activeStage ? <><span className="font-medium text-slate-700">{activeStage.label}</span> etapida ishlaydigan bo&apos;limlar yoritildi</> : "Lavozim yoki bo'lim ustiga bosing — xodimlari chiqadi"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button" onClick={() => setShowEmpty((v) => !v)}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition",
                showEmpty ? "border-slate-300 bg-slate-100 text-slate-900" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
            >
              {showEmpty ? <Eye size={13} /> : <EyeOff size={13} />} Bo&apos;sh lavozim
              <span className="rounded-full bg-slate-200/70 px-1.5 tabular">{emptyCount}</span>
            </button>
            <div className="flex items-center rounded-lg border border-slate-200">
              <button type="button" aria-label="Kichraytirish" onClick={() => setZoom(Math.max(0.5, +(z - 0.15).toFixed(2)))} className="flex h-8 w-8 items-center justify-center text-slate-500 hover:text-slate-900"><Minus size={14} /></button>
              <button type="button" title="Ekranga moslash" onClick={() => setZoom(null)} className="h-8 w-12 text-[11px] font-medium text-slate-600 tabular hover:text-slate-900">{Math.round(z * 100)}%</button>
              <button type="button" aria-label="Kattalashtirish" onClick={() => setZoom(Math.min(1.5, +(z + 0.15).toFixed(2)))} className="flex h-8 w-8 items-center justify-center text-slate-500 hover:text-slate-900"><Plus size={14} /></button>
            </div>
          </div>
        </div>

        <div ref={boxRef} className="overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgb(148_163_184/0.22)_1px,transparent_0)] [background-size:22px_22px]">
          <div style={{ width: width * z, height: height * z }} className="relative">
            <div style={{ width, height, transform: `scale(${z})` }} className="absolute left-0 top-0 origin-top-left">
              <svg width={width} height={height} className="absolute inset-0" fill="none" strokeLinecap="round">
                {nodes.map((n) => n.children.map((c) => (
                  <path key={`${n.dept.role}-${c.dept.role}`} d={elbow(n.x, n.y + CARD_H, c.x, c.y)}
                    className={cn("transition-colors", lit(n.dept.role) && lit(c.dept.role) ? "stroke-slate-400" : "stroke-slate-200")} strokeWidth={1.75} />
                )))}
                {nodes.filter((n) => n.positions.length > 0).map((n) => {
                  const top = n.y + CARD_H, sx = n.x + SPINE_DX;
                  const cy = (i: number) => top + STACK_TOP + i * (CHIP_H + CHIP_GAP) + CHIP_H / 2;
                  const cls = lit(n.dept.role) ? "stroke-slate-300" : "stroke-slate-200";
                  return (
                    <g key={`stack-${n.dept.role}`} className={cn("transition-colors", cls)} strokeWidth={1.5}>
                      <path d={elbow(n.x, top, sx, top + STACK_TOP)} />
                      <path d={`M${sx},${top + STACK_TOP} V${cy(n.positions.length - 1)}`} />
                      {n.positions.map((p, i) => <path key={p.id} d={`M${sx},${cy(i)} H${n.x + CHIP_DX}`} />)}
                    </g>
                  );
                })}
              </svg>

              {nodes.map((n) => (
                <DeptCard key={n.dept.role} node={n} dim={!lit(n.dept.role)}
                  selected={sel?.kind === "dept" && sel.node.dept.role === n.dept.role}
                  onPick={() => setSel({ kind: "dept", node: n })} />
              ))}

              {nodes.flatMap((n) => n.positions.map((p, i) => (
                <PosChip key={p.id} pos={p} tone={n.dept.tone} dim={!lit(n.dept.role)}
                  selected={sel?.kind === "pos" && sel.pos.id === p.id}
                  left={n.x + CHIP_DX} top={n.y + CARD_H + STACK_TOP + i * (CHIP_H + CHIP_GAP)}
                  onPick={() => setSel({ kind: "pos", pos: p, dept: n.dept })} />
              )))}
            </div>
          </div>
        </div>

        {(orphanPositions.length > 0 || strayGroups.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500"><CircleSlash size={13} /> Bo&apos;limga biriktirilmagan:</span>
            {orphanPositions.map((p) => (
              <button key={p.id} type="button" onClick={() => setSel({ kind: "pos", pos: p, dept: null })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-slate-400">
                {p.name}<span className="tabular text-slate-400">{p.staff.length}</span>
              </button>
            ))}
            {strayGroups.map((g) => (
              <button key={g.name} type="button" onClick={() => setSel({ kind: "stray", name: g.name, staff: g.staff })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300 bg-white px-2.5 py-1 text-xs text-amber-700 hover:border-amber-400">
                {g.name}<span className="tabular opacity-70">{g.staff.length}</span>
              </button>
            ))}
          </div>
        )}

        {sel && <DetailPanel sel={sel} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

/* ═══════════════════════ Etaplar lentasi ═══════════════════════ */

function StageRibbon({ counts, active, onPick }: { counts: Record<string, number>; active: string | null; onPick: (k: string) => void }) {
  return (
    <div className="rounded-(--radius-card) border border-slate-200/80 bg-white p-4 shadow-(--shadow-card)">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Ish qaysi etapda ketadi</h2>
          <p className="text-xs text-slate-500">Zayavka zavod ichida shu yo&apos;ldan o&apos;tadi. Etap ustiga bossangiz — javobgar bo&apos;limlar pastdagi tuzilmada yoritiladi.</p>
        </div>
      </div>
      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {ORG_STAGES.map((s, i) => {
          const Icon = ICONS[s.icon] ?? Factory;
          const on = active === s.key;
          const n = counts[s.key] ?? 0;
          return (
            <li key={s.key} className="flex shrink-0 items-center">
              <button type="button" onClick={() => onPick(s.key)}
                className={cn("w-[168px] rounded-xl border bg-white px-3 py-2.5 text-left transition",
                  on ? "border-slate-900 shadow-sm ring-2 ring-slate-900/12" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50")}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", on ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")}><Icon size={14} /></span>
                  <span className={cn("text-lg font-semibold leading-none tabular", n > 0 || on ? "text-slate-900" : "text-slate-300")}>{n}</span>
                </div>
                <div className="mt-1.5 text-[13px] font-semibold text-slate-900">{s.label}</div>
                <div className="text-[11px] leading-tight text-slate-500">{s.hint}</div>
              </button>
              {i < ORG_STAGES.length - 1 && <ChevronRight size={16} className="mx-0.5 shrink-0 text-slate-300" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ═══════════════════════ Kartochka va chip ═══════════════════════ */

function DeptCard({ node, selected, dim, onPick }: { node: Node; selected: boolean; dim: boolean; onPick: () => void }) {
  const t = TONES[node.dept.tone];
  const Icon = ICONS[node.dept.icon] ?? Users;
  const own = node.staff.length;
  return (
    <button type="button" onClick={onPick}
      style={{ left: node.x - CARD_W / 2, top: node.y, width: CARD_W, height: CARD_H }}
      className={cn("absolute rounded-xl border-2 bg-white px-3 py-2.5 text-left shadow-(--shadow-card) transition hover:-translate-y-0.5 hover:shadow-md",
        t.card, selected && cn("ring-4", t.ring), dim && "opacity-35 saturate-50")}>
      <div className="flex items-start gap-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", t.icon)}><Icon size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-slate-900">{node.dept.label}</div>
          <div className="truncate text-[11px] leading-tight text-slate-500">{node.dept.duty}</div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium tabular", t.num)}><Users size={11} />{node.total}</span>
        {own > 0 && <span className="text-slate-400">shundan {own} o&apos;zida</span>}
        {node.logins > 0 && <span className="ml-auto inline-flex items-center gap-0.5 text-slate-400"><IdCard size={11} />{node.logins}</span>}
      </div>
    </button>
  );
}

function PosChip({ pos, tone, left, top, selected, dim, onPick }: {
  pos: PosNode; tone: OrgTone; left: number; top: number; selected: boolean; dim: boolean; onPick: () => void;
}) {
  const t = TONES[tone];
  const n = pos.staff.length;
  return (
    <button type="button" onClick={onPick}
      style={{ left, top, width: CHIP_W, height: CHIP_H }}
      className={cn("absolute flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left shadow-xs transition hover:-translate-y-0.5 hover:shadow-sm",
        t.chip, selected && cn("ring-4", t.ring), dim && "opacity-35 saturate-50")}>
      <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular", n > 0 ? t.num : "bg-slate-50 text-slate-300")}>{n}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-slate-800">{pos.name}</span>
        {pos.note && <span className="block truncate text-[10px] leading-tight text-slate-400">{pos.note}</span>}
      </span>
      {pos.isDriver && <Truck size={12} className="shrink-0 text-slate-400" />}
    </button>
  );
}

/* ═══════════════════════ Xodimlar paneli ═══════════════════════ */

function DetailPanel({ sel, onClose }: { sel: Sel; onClose: () => void }) {
  const title = sel.kind === "dept" ? sel.node.dept.label : sel.kind === "pos" ? sel.pos.name : sel.name;
  const staff = sel.kind === "dept" ? sel.node.staff : sel.kind === "pos" ? sel.pos.staff : sel.staff;
  const chain = sel.kind === "dept" ? chainTo(sel.node.dept.role) : sel.kind === "pos" && sel.dept ? chainTo(sel.dept.role) : [];
  const subtitle =
    sel.kind === "dept" ? sel.node.dept.duty
    : sel.kind === "pos" ? (sel.pos.note ?? "Ishchi lavozim")
    : "Tuzilmada yo'q eski lavozim — Ishchi lavozimlar ro'yxatiga qo'shing";

  const sorted = [...staff].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.fullName.localeCompare(b.fullName));
  const activeCount = staff.filter((e) => e.isActive).length;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[380px] flex-col border-l border-slate-200 bg-white/95 shadow-(--shadow-pop) backdrop-blur animate-fade-up">
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          {chain.length > 0 && (
            <div className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-400">
              {chain.map((d, i) => (
                <span key={d.role} className="inline-flex items-center gap-1">
                  {i > 0 && <ChevronRight size={10} />}
                  <span className={cn(i === chain.length - 1 && sel.kind === "dept" && "font-medium text-slate-600")}>{d.label}</span>
                </span>
              ))}
              {sel.kind === "pos" && <><ChevronRight size={10} /><span className="font-medium text-slate-600">{sel.pos.name}</span></>}
            </div>
          )}
          <h3 className="truncate text-[15px] font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Yopish" className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"><X size={15} /></button>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center">
        <Stat label="Xodim" value={sel.kind === "dept" ? sel.node.total : staff.length} />
        <Stat label="Faol" value={activeCount} />
        <Stat label="Login" value={staff.filter((e) => e.login).length} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sel.kind === "dept" && sel.node.children.length > 0 && (
          <SubList title="Bo'ysunuvchi bo'limlar" items={sel.node.children.map((c) => ({ id: c.dept.role, name: c.dept.label, n: c.total }))} />
        )}
        {sel.kind === "dept" && sel.node.positions.length > 0 && (
          <SubList title="Tarkibidagi lavozimlar" items={sel.node.positions.map((p) => ({ id: p.id, name: p.name, n: p.staff.length }))} />
        )}

        <div className="px-4 py-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {sel.kind === "dept" ? "Shu lavozimdagi xodimlar" : "Xodimlar"}
          </div>
          {sorted.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
              Bu lavozimda xodim yo&apos;q — bo&apos;sh o&apos;rin
            </div>
          ) : (
            <ul className="space-y-1.5">{sorted.map((e) => <EmployeeRow key={e.id} e={e} />)}</ul>
          )}
        </div>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-2 py-2.5">
      <div className="text-base font-semibold text-slate-900 tabular">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function SubList({ title, items }: { title: string; items: { id: string; name: string; n: number }[] }) {
  return (
    <div className="border-b border-slate-100 px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <span key={i.id} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700">
            {i.name}<span className="tabular text-slate-400">{i.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function EmployeeRow({ e }: { e: OrgEmployee }) {
  return (
    <li className="group flex items-center gap-2.5 rounded-lg border border-slate-100 px-2 py-2 transition hover:border-slate-200 hover:bg-slate-50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-slate-400">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {e.photo ? <img src={`/employees/${e.id}/surat`} alt="" className="h-full w-full object-cover" /> : <User size={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <Link href={`/employees/${e.id}`} className="block truncate text-[13px] font-medium text-slate-900 hover:underline">{e.fullName}</Link>
        <span className="flex items-center gap-2 text-[11px] text-slate-500">
          {e.phone ? <span className="inline-flex items-center gap-1"><Phone size={10} />{e.phone}</span> : <span className="text-slate-300">telefon yo&apos;q</span>}
          {e.hiredAt && <span className="truncate">· {e.hiredAt} dan</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {!e.isActive && <Badge>Nofaol</Badge>}
        {e.login && <span title="Tizimga kiradi" className="text-slate-400"><IdCard size={13} /></span>}
        {e.docs > 0 && <span title={`${e.docs} hujjat`} className="text-slate-400"><FileText size={13} /></span>}
        <Link href={`/employees/${e.id}`} aria-label="Karta" className="text-slate-300 transition group-hover:text-slate-600"><Maximize2 size={12} /></Link>
      </span>
    </li>
  );
}
