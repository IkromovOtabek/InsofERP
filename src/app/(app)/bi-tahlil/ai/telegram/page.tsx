import { Bot, Mic, Sparkles, Link2, ShieldAlert } from "lucide-react";
import { biContext } from "../../shell";
import { Panel, Note } from "../../ui";
import { Badge, Button, Table, Td, Th, Tr, Empty } from "@/components/ui";
import { db } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/nav";
import { llmEnabled, llmProvider, PROVIDER_LABEL } from "@/lib/ai/llm";
import { botEnabled, getMe } from "@/lib/telegram/api";
import { sttProvider } from "@/lib/telegram/stt";
import { LinkCodeForm } from "./link-form";
import { unlinkAccount, toggleBlock } from "./actions";

export const dynamic = "force-dynamic";

const STT_LABEL: Record<string, string> = { mohir: "uzbekvoice.ai (o'zbek tili)", groq: "Groq · Whisper large-v3 (bepul tarif)", openai: "OpenAI Whisper" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { s, range } = await biContext(searchParams);
  const isDirector = s.role === "DIRECTOR";

  const bot = botEnabled() ? await getMe().catch(() => null) : null;
  const stt = sttProvider();

  const [mine, all, messages] = await Promise.all([
    db.telegramAccount.findMany({ where: { userId: s.userId }, orderBy: { linkedAt: "desc" } }),
    isDirector
      ? db.telegramAccount.findMany({ where: { userId: { not: null } }, orderBy: { linkedAt: "desc" }, include: { user: true } })
      : Promise.resolve([]),
    db.telegramMessage.findMany({
      where: isDirector ? {} : { account: { userId: s.userId } },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { account: { include: { user: true } } },
    }),
  ]);

  const ready = Boolean(bot) && Boolean(stt);

  return (
    <div>
      <div className="mb-6">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-600">Insof AI</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Telegram bot</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Telegramga ovozli xabar yuborasiz — bot uni matnga o'giradi, ERP ma'lumotlari asosida javob qaytaradi.
          Javob shu sahifadagi tahlil raqamlaridan olinadi, bot hech qanday ma'lumotni o'zgartirmaydi.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" eyebrow="1-qadam" title={<span className="inline-flex items-center gap-1.5"><Link2 size={15} className="text-brand-500" /> Hisobingizni ulash</span>}
               info="Kod bir marta ishlaydi va 15 daqiqada kuchini yo'qotadi. Kodsiz bot hech kimga javob bermaydi.">
          {bot ? (
            <>
              <ol className="mb-4 space-y-1.5 text-[13px] text-slate-700">
                <li>1. Telegramda <b>@{bot.username}</b> botini oching va <code className="rounded bg-slate-100 px-1">/start</code> bosing</li>
                <li>2. Quyidagi tugma bilan 6 xonali kod oling</li>
                <li>3. Kodni botga yuboring — shundan keyin ovozli savol berishingiz mumkin</li>
              </ol>
              <LinkCodeForm botUsername={bot.username} />
            </>
          ) : (
            <Note>Bot hali sozlanmagan. <code>.env</code> ga <code>TELEGRAM_BOT_TOKEN</code> qo'shing (@BotFather) va <code>npm run bot</code> ni ishga tushiring.</Note>
          )}

          {mine.length > 0 && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Ulangan chatlaringiz</div>
              <ul className="space-y-2">
                {mine.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <span>
                      {a.username ? `@${a.username}` : a.firstName ?? a.chatId}
                      {a.isBlocked && <Badge color="red">bloklangan</Badge>}
                      <span className="ml-2 text-xs text-slate-400">{a.linkedAt ? dateTime(a.linkedAt) : ""}</span>
                    </span>
                    <form action={unlinkAccount.bind(null, a.id)}>
                      <Button variant="secondary" className="px-2 py-1 text-xs">Uzish</Button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Holat" title={<span className="inline-flex items-center gap-1.5"><Bot size={15} /> Tizim holati</span>}>
          <ul className="space-y-2.5 text-[13px]">
            <Status ok={Boolean(bot)} label="Telegram bot" value={bot ? `@${bot.username}` : "TELEGRAM_BOT_TOKEN yo'q"} />
            <Status ok={Boolean(stt)} label="Ovoz → matn" value={stt ? STT_LABEL[stt] : "MOHIR_API_KEY / GROQ_API_KEY / OPENAI_API_KEY yo'q"} icon={Mic} />
            <Status ok={llmEnabled()} label="Erkin savollar" value={llmProvider() ? PROVIDER_LABEL[llmProvider()!] : "qoida asosidagi javoblar"} icon={Sparkles} soft />
          </ul>
          {!ready && (
            <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <ShieldAlert size={13} className="mr-1 inline" />
              Ovozli savol ishlashi uchun bot tokeni va ovoz→matn kaliti kerak. Sozlamalar <code>.env</code> faylida.
            </div>
          )}
        </Panel>
      </div>

      {isDirector && (
        <Panel className="mt-6" eyebrow="Direktor" title="Botga ulangan hamma hisoblar" info="Shubhali chatni bloklang — bot unga javob bermay qo'yadi." padded={false}>
          {all.length ? (
            <Table>
              <thead><tr><Th>Xodim</Th><Th>Rol</Th><Th>Telegram</Th><Th>Ulangan</Th><Th>Oxirgi faollik</Th><Th>Holat</Th><Th></Th></tr></thead>
              <tbody>
                {all.map((a) => (
                  <Tr key={a.id}>
                    <Td className="font-medium">{a.user?.fullName}</Td>
                    <Td>{a.user ? ROLE_LABELS[a.user.role] : "—"}</Td>
                    <Td>{a.username ? `@${a.username}` : a.firstName ?? a.chatId}</Td>
                    <Td className="whitespace-nowrap">{a.linkedAt ? dateTime(a.linkedAt) : "—"}</Td>
                    <Td className="whitespace-nowrap">{dateTime(a.lastSeen)}</Td>
                    <Td>{a.isBlocked ? <Badge color="red">Bloklangan</Badge> : <Badge color="green">Faol</Badge>}</Td>
                    <Td className="flex gap-1">
                      <form action={toggleBlock.bind(null, a.id)}><Button variant="secondary" className="px-2 py-1 text-xs">{a.isBlocked ? "Ochish" : "Bloklash"}</Button></form>
                      <form action={unlinkAccount.bind(null, a.id)}><Button variant="secondary" className="px-2 py-1 text-xs">Uzish</Button></form>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : <div className="p-5"><Empty text="Hali hech kim botni ulamagan." /></div>}
        </Panel>
      )}

      <Panel className="mt-6" eyebrow="Jurnal" title="Oxirgi savollar" info="Bot orqali kelgan har bir savol va javob saqlanadi." padded={false}>
        {messages.length ? (
          <Table>
            <thead><tr><Th>Vaqt</Th>{isDirector && <Th>Kim</Th>}<Th>Tur</Th><Th>Savol</Th><Th>Javob</Th></tr></thead>
            <tbody>
              {messages.map((m) => (
                <Tr key={m.id}>
                  <Td className="whitespace-nowrap">{dateTime(m.createdAt)}</Td>
                  {isDirector && <Td>{m.account.user?.fullName ?? "—"}</Td>}
                  <Td>{m.kind === "voice" ? <Badge color="violet">🎙 ovoz</Badge> : <Badge>matn</Badge>}</Td>
                  <Td className="max-w-xs truncate">{m.question}</Td>
                  <Td className="max-w-md truncate text-slate-500">{m.answer}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : <div className="p-5"><Empty text="Hali savol berilmagan. Botga ovozli xabar yuboring — shu yerda ko'rinadi." /></div>}
      </Panel>

      <div className="mt-6 text-xs text-slate-400">Davr: {range.label} · Bot javoblari tanlangan davrga emas, joriy holatga asoslanadi.</div>
    </div>
  );
}

function Status({ ok, label, value, icon: Icon = Bot, soft = false }: { ok: boolean; label: string; value: string; icon?: React.ElementType; soft?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : soft ? "bg-slate-300" : "bg-red-500"}`} />
      <div className="min-w-0">
        <div className="font-medium"><Icon size={13} className="mr-1 inline text-slate-400" />{label}</div>
        <div className="truncate text-xs text-slate-500">{value}</div>
      </div>
    </li>
  );
}
