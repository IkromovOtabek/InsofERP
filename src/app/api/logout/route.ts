import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  // cookies().delete() alohida yaratilgan redirect javobiga tushmaydi — javobning o'ziga yozamiz
  res.cookies.set("insof_session", "", { maxAge: 0, path: "/" });
  // Instruksiya holati ham o'chadi — qayta kirilganda yo'riqnoma boshidan boshlanadi
  res.cookies.set("insof_tour", "", { maxAge: 0, path: "/" });
  return res;
}

/**
 * Eskirgan sessiya: token imzosi to'g'ri, lekin bazada bekor qilingan (parol almashgan, hisob
 * bloklangan). Middleware bunday cookie bilan /login ni /dashboard ga qaytaradi, layout esa
 * yana /login ga — foydalanuvchi aylanib qolardi. Sahifa shu yerga yuboradi: cookie o'chadi.
 */
export async function GET(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.set("insof_session", "", { maxAge: 0, path: "/" });
  return res;
}
