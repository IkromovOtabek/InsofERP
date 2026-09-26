/**
 * Insof AI'ga terminaldan savol berish — bot va chat panelidagi aynan shu yo'l ishlatiladi.
 *   npm run ai -- "1-sentabrdan 10-sentabrgacha savdo qancha?"
 * Chiqishda javob, ishlatilgan asboblar va vaqt ko'rsatiladi (asbob chaqiruvlari log'da).
 */
import { loadEnv } from "./env";
loadEnv();

import { askInsofAi } from "../src/lib/bi/answer";
import { llmProvider, PROVIDER_LABEL } from "../src/lib/ai/llm";

async function main() {
  const q = process.argv.slice(2).join(" ").trim();
  if (!q) { console.error('Foydalanish: npm run ai -- "savol"'); process.exit(1); }
  const p = llmProvider();
  console.log(`Provayder: ${p ? PROVIDER_LABEL[p] : "yo'q — qoida asosida"}\nSavol: ${q}\n`);
  const t0 = Date.now();
  const r = await askInsofAi(q);
  console.log(r.answer.text);
  if (r.answer.bullets?.length) console.log(r.answer.bullets.map((b) => `• ${b}`).join("\n"));
  if (r.answer.href) console.log(`Havola: ${r.answer.href.label} — ${r.answer.href.href}`);
  console.log(`\n— ${r.level ? r.model : "qoida (0 token)"} · asboblar: ${r.tools?.length ? r.tools.join(", ") : "—"} · ${Date.now() - t0} ms`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
