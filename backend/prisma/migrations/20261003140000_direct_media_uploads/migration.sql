-- CreateTable
CREATE TABLE "MediaUpload" (
    "id" SERIAL NOT NULL,
    "publicId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "type" "MediaType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaUpload_publicId_key" ON "MediaUpload"("publicId");

-- CreateIndex
CREATE INDEX "MediaUpload_userId_idx" ON "MediaUpload"("userId");

-- CreateIndex
CREATE INDEX "MediaUpload_itemId_idx" ON "MediaUpload"("itemId");

-- CreateIndex
CREATE INDEX "MediaUpload_expiresAt_idx" ON "MediaUpload"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ItemMedia_publicId_key" ON "ItemMedia"("publicId");

-- AddForeignKey
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

