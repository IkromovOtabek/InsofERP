"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const loginName = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!loginName || !password) return { error: "Login va parolni kiriting" };
  const s = await login(loginName, password);
  if (!s) return { error: "Login yoki parol noto'g'ri" };
  redirect("/dashboard");
}
