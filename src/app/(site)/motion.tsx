"use client";

import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { fmtNum } from "@/lib/format";

/** Butun saytda bitta uyg'un harakat egri chizig'i — "expo out": tez boshlanadi, yumshoq to'xtaydi. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Skrollab kelganda (yoki `mount`da) pastdan yumshoq chiqib keladigan bo'lak.
 * `prefers-reduced-motion` yoqilgan bo'lsa harakatsiz, to'g'ridan-to'g'ri ko'rinadi.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 22,
  mode = "view",
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  mode?: "view" | "mount";
  as?: "div" | "li";
}) {
  const reduce = useReducedMotion();
  const hidden = { opacity: 0, y };
  const shown = { opacity: 1, y: 0 };
  const MotionTag = as === "li" ? motion.li : motion.div;

  if (reduce) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <MotionTag
      className={className}
      initial={hidden}
      {...(mode === "mount"
        ? { animate: shown }
        : { whileInView: shown, viewport: { once: true, margin: "-10% 0px -10% 0px" } })}
      transition={{ duration: 0.65, delay, ease: EASE }}
    >
      {children}
    </MotionTag>
  );
}

/** Kartalar uchun: soyasi bilan birga bir bosqich ko'tariladi — sichqoncha ustiga kelganda. */
export function Lift({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      whileHover={{ y: -6 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Statistika raqami: bo'lim ko'rinishga kirganda 0 dan haqiqiy qiymatgacha sanaydi,
 * minglik ajratgichi bilan (`fmtNum`). `suffix` ("m³", " yil") animatsiya davomida o'zgarmaydi.
 */
export function StatValue({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? fmtNum(value) : "0");

  useEffect(() => {
    if (!inView || reduce) { setDisplay(fmtNum(value)); return; }
    const controls = animate(0, value, {
      duration: 1.2,
      ease: EASE,
      onUpdate(v) { setDisplay(fmtNum(v)); },
    });
    return () => controls.stop();
  }, [inView, reduce, value]);

  return <span ref={ref} className={className}>{display}{suffix}</span>;
}

/** Qadamlarni bog'lovchi chiziq — bo'lim ko'rinishga kirganda chapdan o'ngga chiziladi. */
export function GrowLine({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <span aria-hidden className={className} />;
  return (
    <motion.span
      aria-hidden
      className={className}
      style={{ transformOrigin: "left" }}
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
      transition={{ duration: 1, ease: EASE, delay: 0.15 }}
    />
  );
}
