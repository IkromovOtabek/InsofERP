import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Faqat ommaviy sahifa ("/") indekslansin — ERP bo'limlari baribir login talab qiladi. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/login",
        "/taqdimot",
        "/dashboard",
        "/orders",
        "/sales",
        "/customers",
        "/leads",
        "/invoices",
        "/payments",
        "/cashflow",
        "/receipts",
        "/recipes",
        "/production",
        "/stock",
        "/suppliers",
        "/taminot",
        "/snabjeniye",
        "/trips",
        "/tasks",
        "/drivers",
        "/brigades",
        "/employees",
        "/otdel-kadr",
        "/bi-tahlil",
        "/qollanma",
        "/settings",
        "/mening-reyslarim",
        "/mening-topshiriqlarim",
        "/hisobim",
        "/kirim-qqs",
        "/ilova-foydalanuvchilari",
        "/agent",
        "/e-commerce",
        "/logistika",
        // QR tekshiruv sahifalari (hujjat bo'yicha) va IT panel — qidiruvga chiqmasin
        "/verify",
        "/superadmin",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
