-- Ishchi lavozim: Injener (ishlab chiqarish bo'limi). Korxonada shu nom allaqachon bo'lsa — tegilmaydi.
INSERT INTO "WorkPosition" ("id", "name", "note", "department", "isDriver", "sortOrder", "updatedAt")
VALUES ('wp_injener', 'Injener', 'Texnik nazorat, texnologiya va uskunalar', 'PRODUCTION', false, 55, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
