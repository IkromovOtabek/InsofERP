import { isTestMode } from "@/lib/test-mode";
import { db } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/nav";
import { ARENDA_DENIED } from "@/lib/arenda-host";
import { LoginForm, type TestUser } from "./login-form";

/**
 * Kirish sahifasi. Ikki yo'l: login+parol va telefon+kod (faqat Telegram: bot yoki Gateway). Test rejimida
 * qo'shimcha "Test xodimlar" bo'limi — `test.*` loginlarga bir bosishda kirish
 * (`isTestMode` orqali; production'da bu bo'lim umuman yuklanmaydi).
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ arenda?: string }> }) {
  const testMode = isTestMode();
  // Arenda domeni ruxsati yo'q hisobni shu yerga qaytaradi (lib/arenda-host.ts → arendaRedirect)
  const notice = (await searchParams).arenda === "yopiq" ? ARENDA_DENIED : undefined;
  let testUsers: TestUser[] = [];
  if (testMode) {
    const rows = await db.user.findMany({
      where: { login: { startsWith: "test." }, isActive: true },
      select: { login: true, fullName: true, role: true },
      orderBy: { login: "asc" },
    });
    testUsers = rows.map((u) => ({ login: u.login, fullName: u.fullName, roleLabel: ROLE_LABELS[u.role] }));
  }
  return <LoginForm testMode={testMode} testUsers={testUsers} notice={notice} />;
}
