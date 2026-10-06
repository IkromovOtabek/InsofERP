import { execFile } from "node:child_process";

/**
 * Tashqi buyruq — faqat execFile (shell'siz), har doim timeout bilan. Hech qachon xato tashlamaydi:
 * natija `missing` (buyruq yo'q), `code` (chiqish kodi) va stdout/stderr bilan qaytadi.
 */
export type ExecResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** Buyruq topilmadi (ENOENT) — masalan macOS'da journalctl/ss yo'q */
  missing: boolean;
  timedOut: boolean;
};

export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; maxBuffer?: number; env?: Record<string, string | undefined> } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    try {
      execFile(
        cmd,
        args,
        {
          timeout: opts.timeoutMs ?? 15_000,
          cwd: opts.cwd,
          maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
          env: (opts.env ?? { PATH: process.env.PATH ?? "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" }) as NodeJS.ProcessEnv,
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: string | number; killed?: boolean; signal?: string }) | null;
          const missing = !!e && e.code === "ENOENT";
          const timedOut = !!e && !!e.killed && e.signal === "SIGTERM";
          const code = e ? (typeof e.code === "number" ? e.code : null) : 0;
          resolve({ ok: !e, code, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), missing, timedOut });
        },
      );
    } catch (e) {
      resolve({ ok: false, code: null, stdout: "", stderr: String(e), missing: true, timedOut: false });
    }
  });
}

/** Xato matnini topilmaga qo'yishdan oldin qisqartirish (sir bo'lishi mumkin bo'lgan uzun satrlarsiz). */
export function shortErr(r: ExecResult): string {
  if (r.missing) return "buyruq topilmadi";
  if (r.timedOut) return "vaqt tugadi";
  return (r.stderr || r.stdout).trim().split("\n").slice(0, 2).join(" ").slice(0, 200) || `chiqish kodi ${r.code}`;
}
