"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export const THEME_KEY = "insof-theme";
type Theme = "light" | "dark";

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {}
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}

/** Header'dagi quyosh/oy tugmasi. Tanlov localStorage'da saqlanadi, layout'dagi inline skript flashni oldini oladi. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => { setTheme(readTheme()); }, []);

  const dark = theme === "dark";
  const toggle = () => { const next: Theme = dark ? "light" : "dark"; applyTheme(next); setTheme(next); };

  return (
    <button type="button" onClick={toggle} aria-label={dark ? "Ochiq rejim" : "Qorong'i rejim"} title={dark ? "Ochiq rejim" : "Qorong'i rejim"}
      className={cn("relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900", className)}>
      <Sun size={17} className={cn("absolute transition-all duration-300", dark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100")} />
      <Moon size={17} className={cn("absolute transition-all duration-300", dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0")} />
    </button>
  );
}
