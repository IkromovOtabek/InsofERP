import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canDo } from "@/lib/permissions";
import { aiAllowed } from "@/lib/rate-limit";
import { MARKETING_MODEL, MARKETING_SYSTEM, marketingTools } from "@/lib/ai/marketing-agent";

/**
 * Marketing AI agenti — oqimli javob (NDJSON):
 *   {"type":"chat","id"} · {"type":"text","text"} · {"type":"tool","name"} · {"type":"done"} · {"type":"error","message"}
 * Suhbat tarixi bazada (MarketingChat/Message); modelga faqat matnli navbatlar qayta yuboriladi.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const HISTORY_LIMIT = 30;
const ndjson = (o: unknown) => JSON.stringify(o) + "\n";
const ndHeaders = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" };

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  if (!canDo(s, "marketing", "agent")) return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  // LLM so'rovlari pulli — bitta hisob tsiklda so'rov yog'dirmasin (umumiy AI cheklovi)
  if (!aiAllowed(s.userId)) return new Response(ndjson({ type: "error", message: "So'rovlar ko'p — bir daqiqadan keyin qayta urinib ko'ring." }), { headers: ndHeaders });
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return new Response(ndjson({ type: "error", message: "AI kaliti sozlanmagan: korxona .env fayliga ANTHROPIC_API_KEY qo'shilishi kerak." }), { headers: ndHeaders });
  }

  let body: { chatId?: unknown; message?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "BAD_JSON" }, { status: 400 }); }
  const text = typeof body?.message === "string" ? body.message.trim().slice(0, 8000) : "";
  if (!text) return Response.json({ error: "EMPTY" }, { status: 422 });

  // Suhbatni faqat egasi davom ettiradi
  let chat = typeof body.chatId === "string" ? await db.marketingChat.findFirst({ where: { id: body.chatId, userId: s.userId } }) : null;
  if (!chat) chat = await db.marketingChat.create({ data: { userId: s.userId, title: text.replace(/\s+/g, " ").slice(0, 70) } });
  const chatId = chat.id;

  const history = await db.marketingMessage.findMany({ where: { chatId }, orderBy: { createdAt: "desc" }, take: HISTORY_LIMIT });
  await db.marketingMessage.create({ data: { chatId, role: "user", content: text } });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.reverse().map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
    { role: "user", content: text },
  ];
  while (messages[0]?.role === "assistant") messages.shift(); // tarix kesilganda birinchi navbat user bo'lsin

  const client = new Anthropic();
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(ndjson(o)));
      send({ type: "chat", id: chatId });
      let answer = "";
      const used = new Set<string>();
      const note = (t: string) => { answer += t; send({ type: "text", text: t }); };
      try {
        const runner = client.beta.messages.toolRunner({
          model: MARKETING_MODEL,
          max_tokens: 32000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default", // xavfsizlik filtri rad etsa — server mos zaxira modelda davom ettiradi
          output_config: { effort: "medium" },
          system: [{ type: "text", text: MARKETING_SYSTEM, cache_control: { type: "ephemeral" } }],
          tools: [
            ...marketingTools(s),
            { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "UZ", city: "Tashkent" } },
          ],
          messages,
          max_iterations: 10,
          stream: true,
        });
        for await (const turn of runner) {
          for await (const ev of turn) {
            if (ev.type === "content_block_start" && (ev.content_block.type === "tool_use" || ev.content_block.type === "server_tool_use")) {
              used.add(ev.content_block.name);
              send({ type: "tool", name: ev.content_block.name });
            } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              answer += ev.delta.text;
              send({ type: "text", text: ev.delta.text });
            }
          }
          const msg = await turn.finalMessage();
          if (msg.stop_reason === "pause_turn") runner.pushMessages({ role: "assistant", content: msg.content });
          else if (msg.stop_reason === "refusal") note("\n\n_Bu so'rovga javob berib bo'lmadi — savolni boshqacha ifodalang._");
          else if (msg.stop_reason === "max_tokens") note("\n\n_Javob uzunlik chegarasiga yetdi — «davom et» deb yozing._");
          if (answer && !answer.endsWith("\n")) note("\n\n"); // iteratsiyalar matni yopishmasin
        }
        send({ type: "done" });
      } catch (e) {
        let message = "Agent javob bera olmadi. Birozdan keyin qayta urinib ko'ring.";
        if (e instanceof Anthropic.AuthenticationError) message = "AI kaliti noto'g'ri: ANTHROPIC_API_KEY ni tekshiring.";
        else if (e instanceof Anthropic.RateLimitError) message = "AI xizmati chegarasi — bir daqiqadan keyin qayta urinib ko'ring.";
        else if (e instanceof Anthropic.APIError) message = `AI xizmati xatosi (${e.status ?? "tarmoq"}).`;
        console.error("[marketing-agent]", e instanceof Error ? e.message : e);
        send({ type: "error", message });
      } finally {
        const content = answer.trim();
        if (content) {
          await db.marketingMessage.create({ data: { chatId, role: "assistant", content, tools: [...used] } }).catch(() => null);
          await db.marketingChat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }).catch(() => null);
        }
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: ndHeaders });
}
