-- Kirim manbasi «Savdo»: mahsulot sotuvidan tushgan, mijoz to'lovi bo'lib yozilmagan pul (Kirim-Chiqim, Kassa / bank importi).
-- Cash Flow'da «Savdo tushumi» qatoriga qo'shiladi (lib/fin-report/sheet-lines.ts), PNL daromadiga kirmaydi — daromad realizatsiyadan.
-- Korxonada shu nomli kategoriya allaqachon bo'lsa — o'zinikidek qoladi.
INSERT INTO "CashCategory" ("id","name","type","parentId","flow","pnlLine","needs","loanPart","aliases","isSystem","sort","updatedAt") VALUES
  ('cc_savdo', 'Savdo', 'INCOME', NULL, 'OPERATING', 'NONE', NULL, NULL, ARRAY['sotuv','savdodan tushum','sotuvdan tushum']::TEXT[], true, 15, NOW())
ON CONFLICT ("name") DO NOTHING;
