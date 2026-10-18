/**
 * Chop etiladigan hujjat (zayavka, tijorat taklifi) sarlavhasidagi rasm: minorali kran va binolar —
 * korxonaning eski Excel blankasidagi rasm qayta chizilgan. SVG: PDF'da tiniq chiqadi, fayl talab qilmaydi.
 */
const NAVY = "#25236b";
const SKY = "#8ec5ec";

/** Och ko'k minoradagi derazalar to'ri. */
function Windows({ x, y, cols, rows }: { x: number; y: number; cols: number; rows: number }) {
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(<rect key={`${r}-${c}`} x={x + c * 9} y={y + r * 9} width={5} height={5} fill="#fff" />);
  return <>{cells}</>;
}

export function PrintHeaderArt({ className }: { className?: string }) {
  // Kran strelasi va minorasi panjarasi (zigzag)
  const jib = Array.from({ length: 13 }, (_, i) => `${10 + i * 17},${i % 2 ? 62 - i * 3.1 : 48 - i * 3.1}`).join(" ");
  const mast = Array.from({ length: 12 }, (_, i) => `${i % 2 ? 84 : 72},${58 + i * 12.5}`).join(" ");
  return (
    <svg viewBox="0 0 470 210" className={className} role="img" aria-label="Kran va binolar">
      {/* kran */}
      <line x1="10" y1="48" x2="225" y2="10" stroke={NAVY} strokeWidth="3" />
      <line x1="10" y1="62" x2="225" y2="24" stroke={NAVY} strokeWidth="3" />
      <polyline points={jib} fill="none" stroke={NAVY} strokeWidth="1.6" />
      <line x1="225" y1="10" x2="225" y2="24" stroke={NAVY} strokeWidth="3" />
      <rect x="70" y="48" width="4" height="152" fill={NAVY} />
      <rect x="82" y="44" width="4" height="156" fill={NAVY} />
      <polyline points={mast} fill="none" stroke={NAVY} strokeWidth="1.6" />
      <path d="M70 48 L78 18 L86 44" fill="none" stroke={NAVY} strokeWidth="2.5" />
      <line x1="78" y1="18" x2="10" y2="48" stroke={NAVY} strokeWidth="1.4" />
      <line x1="78" y1="18" x2="200" y2="15" stroke={NAVY} strokeWidth="1.4" />
      <rect x="4" y="50" width="16" height="16" fill={NAVY} />
      <line x1="40" y1="56" x2="40" y2="100" stroke={NAVY} strokeWidth="1.4" />
      <rect x="35" y="100" width="10" height="7" fill={NAVY} />
      <path d="M40 107 v6 a4 4 0 1 1 -6 2" fill="none" stroke={NAVY} strokeWidth="2" />
      <rect x="58" y="96" width="38" height="12" fill={NAVY} />

      {/* past qavatli binolar */}
      <rect x="135" y="138" width="24" height="62" fill={NAVY} />
      <rect x="162" y="168" width="22" height="32" fill={NAVY} />
      <rect x="340" y="120" width="26" height="80" fill={NAVY} />
      <rect x="370" y="178" width="44" height="22" fill={NAVY} />
      <rect x="418" y="186" width="34" height="14" fill={NAVY} />

      {/* och ko'k minoralar */}
      <rect x="188" y="62" width="48" height="138" fill={SKY} />
      <Windows x={193} y={68} cols={5} rows={14} />
      <rect x="282" y="66" width="42" height="134" fill={SKY} />
      <Windows x={286} y={72} cols={4} rows={14} />

      {/* markaziy baland bino va shpil */}
      <rect x="240" y="40" width="38" height="160" fill={NAVY} />
      <rect x="250" y="22" width="18" height="20" fill={NAVY} />
      <rect x="257" y="2" width="4" height="22" fill={NAVY} />

      {/* yer chizig'i */}
      <rect x="40" y="198" width="420" height="5" fill={NAVY} />
    </svg>
  );
}

/** Sarlavhadagi katta nom: yuridik nom shakli (MChJ, ООО…) olib tashlanadi — «INSOF BETON MChJ» → «INSOF BETON». */
export const brandTitle = (c: { name: string; legalName: string | null }) =>
  (c.legalName ?? c.name).replace(/\s*["«»]?\s*(MChJ|МЧЖ|ООО|OOO|XK|ХК|AJ|АЖ|АО)\.?\s*$/i, "").replace(/^["«]|["»]$/g, "").trim();
