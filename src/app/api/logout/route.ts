import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  // cookies().delete() alohida yaratilgan redirect javobiga tushmaydi — javobning o'ziga yozamiz
  res.cookies.set("insof_session", "", { maxAge: 0, path: "/" });
  return res;
}
