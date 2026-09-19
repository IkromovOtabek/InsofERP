/**
 * Ovozli xabarni matnga o'girish (STT). Telegram ovozi — OGG/Opus.
 *
 * Uchta provayder qo'llab-quvvatlanadi, kalit qaysi biriga berilgan bo'lsa o'sha ishlaydi:
 *   MOHIR_API_KEY  — uzbekvoice.ai, o'zbek tili uchun eng aniq (pullik, tavsiya etiladi)
 *   GROQ_API_KEY   — Groq'dagi Whisper large-v3: bepul tarif, karta talab qilinmaydi (sinov uchun)
 *   OPENAI_API_KEY — OpenAI Whisper / gpt-4o-transcribe (pullik)
 * STT_PROVIDER = mohir | groq | openai — qo'lda tanlash (bo'lmasa kalitga qarab avtomatik).
 */

export type SttProvider = "mohir" | "groq" | "openai";

const KEY_ENV: Record<SttProvider, string> = { mohir: "MOHIR_API_KEY", groq: "GROQ_API_KEY", openai: "OPENAI_API_KEY" };

export function sttProvider(): SttProvider | null {
  const forced = process.env.STT_PROVIDER?.trim().toLowerCase() as SttProvider | undefined;
  if (forced && forced in KEY_ENV) return process.env[KEY_ENV[forced]] ? forced : null;
  // aniqlik bo'yicha: mohir → groq (bepul) → openai
  return (["mohir", "groq", "openai"] as const).find((p) => process.env[KEY_ENV[p]]) ?? null;
}

export const sttEnabled = () => sttProvider() !== null;

export class SttError extends Error {}

/**
 * Fayl nomi — provayderlar formatni aynan kengaytmaga qarab aniqlaydi va ro'yxatda
 * yo'q kengaytmani rad etadi. Telegram ovozli xabarni `.oga` bilan beradi (ichida OGG/Opus),
 * Groq/OpenAI esa `.oga` ni qabul qilmaydi — shuning uchun `.ogg` ga o'tkazamiz.
 */
const AUDIO_EXT = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"]);
const EXT_ALIAS: Record<string, string> = { oga: "ogg", opus: "ogg", ogv: "ogg", mov: "mp4", aac: "m4a" };

function fileName(path: string, mime?: string) {
  const raw = path.split(".").pop()?.toLowerCase() ?? "";
  const ext = EXT_ALIAS[raw] ?? raw;
  if (AUDIO_EXT.has(ext)) return `voice.${ext}`;

  const m = mime ?? "";
  if (m.includes("ogg") || m.includes("opus")) return "voice.ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "voice.m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "voice.mp3";
  if (m.includes("wav")) return "voice.wav";
  if (m.includes("webm")) return "voice.webm";
  return "voice.ogg"; // Telegram ovozli xabari — doim OGG/Opus
}

/** Ovoz baytlari → matn. Xato bo'lsa SttError (foydalanuvchiga ko'rsatiladigan matn bilan). */
export async function transcribe(bytes: Uint8Array, opts: { path: string; mime?: string }): Promise<{ text: string; provider: SttProvider }> {
  const provider = sttProvider();
  if (!provider) throw new SttError("Ovozni matnga o'giruvchi xizmat sozlanmagan (MOHIR_API_KEY, GROQ_API_KEY yoki OPENAI_API_KEY).");
  const blob = new Blob([bytes as BlobPart], { type: opts.mime || "audio/ogg" });
  const name = fileName(opts.path, opts.mime);
  const text = provider === "mohir" ? await viaMohir(blob, name) : await viaWhisper(provider, blob, name);
  const clean = text.trim();
  if (!clean) throw new SttError("Ovozdan matn ajratilmadi — biroz sekinroq va tinchroq joyda qayta aytib ko'ring.");
  return { text: clean, provider };
}

/* ───────────── Mohir AI / UzbekVoiceAI (o'zbek tili) ─────────────
   Hujjat: https://uzbekvoice.ai/developers/api/stt
   Javob: { id, result: { text }, state } · Authorization — kalitning o'zi (Bearer'siz)
   blocking=true faqat 1 daqiqagacha audio uchun — bot ham ovozni 60 soniya bilan cheklaydi. */

async function viaMohir(blob: Blob, name: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", blob, name);
  fd.append("return_offsets", "false");
  fd.append("run_diarization", "false");
  fd.append("language", process.env.MOHIR_STT_LANGUAGE ?? "uz"); // uz | ru | uz-ru
  fd.append("model", process.env.MOHIR_STT_MODEL ?? "general");   // general | enhanced-stt
  fd.append("blocking", "true");

  const res = await fetch(process.env.MOHIR_STT_URL ?? "https://uzbekvoice.ai/api/v1/stt", {
    method: "POST",
    headers: { Authorization: process.env.MOHIR_API_KEY! },
    body: fd,
  });
  const raw = await res.text();
  if (!res.ok) throw new SttError(`UzbekVoiceAI xatosi (${res.status}): ${raw.slice(0, 200)}`);

  let json: unknown;
  try { json = JSON.parse(raw); } catch { return raw; }
  const text = pickText(json);
  if (text === null) throw new SttError(`UzbekVoiceAI javobidan matn topilmadi: ${raw.slice(0, 200)}`);
  return text;
}

/** Javob shakli o'zgarishi mumkin — text/transcript maydonini rekursiv qidiramiz. */
function pickText(v: unknown, depth = 0): string | null {
  if (typeof v === "string") return v;
  if (!v || typeof v !== "object" || depth > 4) return null;
  const o = v as Record<string, unknown>;
  for (const k of ["text", "transcript", "transcription"]) {
    if (typeof o[k] === "string") return o[k] as string;
  }
  for (const k of ["result", "data", "response", "results", "segments"]) {
    if (k in o) {
      const nested = Array.isArray(o[k])
        ? (o[k] as unknown[]).map((x) => pickText(x, depth + 1)).filter(Boolean).join(" ")
        : pickText(o[k], depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

/* ───────────── Whisper (OpenAI-mos API): Groq yoki OpenAI ─────────────
   Groq bepul tarifda whisper-large-v3 beradi (karta shart emas) — sinov uchun qulay.
   Ikkalasining so'rov formati bir xil, faqat manzil, kalit va standart model farq qiladi. */

const WHISPER: Record<"groq" | "openai", { url: string; keyEnv: string; model: string; modelEnv: string }> = {
  groq: {
    url: "https://api.groq.com/openai/v1/audio/transcriptions",
    keyEnv: "GROQ_API_KEY", model: "whisper-large-v3", modelEnv: "GROQ_STT_MODEL",
  },
  openai: {
    url: "https://api.openai.com/v1/audio/transcriptions",
    keyEnv: "OPENAI_API_KEY", model: "whisper-1", modelEnv: "OPENAI_STT_MODEL",
  },
};

async function viaWhisper(provider: "groq" | "openai", blob: Blob, name: string): Promise<string> {
  const c = WHISPER[provider];
  const fd = new FormData();
  fd.append("file", blob, name);
  fd.append("model", process.env[c.modelEnv] ?? c.model);
  fd.append("language", "uz");
  fd.append("response_format", "json");

  const res = await fetch(c.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env[c.keyEnv]!}` },
    body: fd,
  });
  const raw = await res.text();
  if (!res.ok) throw new SttError(`${provider === "groq" ? "Groq" : "OpenAI"} STT xatosi (${res.status}): ${raw.slice(0, 200)}`);
  try {
    const json = JSON.parse(raw) as { text?: string };
    return json.text ?? "";
  } catch {
    return raw;
  }
}
