import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: ["node_modules/**", ".next/**", "src/generated/**", "next-env.d.ts"] },
  // O'zbek matnida apostrof (so'm, qo'shish) ko'p — bu qoida faqat shovqin beradi
  { rules: { "react/no-unescaped-entities": "off" } },
];

export default config;
