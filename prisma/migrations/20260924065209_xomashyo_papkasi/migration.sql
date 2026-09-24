-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "MaterialGroup" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialGroup_code_key" ON "MaterialGroup"("code");

-- CreateIndex
CREATE INDEX "MaterialGroup_parentId_idx" ON "MaterialGroup"("parentId");

-- CreateIndex
CREATE INDEX "Material_groupId_idx" ON "Material"("groupId");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MaterialGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialGroup" ADD CONSTRAINT "MaterialGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MaterialGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
