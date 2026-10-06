"use client";

import { Sparkline } from "../_monitor/sparkline";

/** Daqiqalik so'rovlar / 5xx grafigi (server sahifadan funksiya berib bo'lmaydi — format shu yerda). */
export function PerMinute({ values, times, label, tone }: { values: number[]; times: number[]; label: string; tone?: "default" | "danger" }) {
  return <Sparkline values={values} times={times} label={label} tone={tone} format={(v) => `${v} / daq`} />;
}
