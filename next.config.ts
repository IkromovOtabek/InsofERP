import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: "16mb" } }, // imzolangan shartnoma fayli (15 MB gacha) server action orqali yuklanadi
};

export default nextConfig;
