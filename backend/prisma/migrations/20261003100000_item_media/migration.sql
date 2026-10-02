-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "ItemMedia" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "type" "MediaType" NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemMedia_itemId_sortOrder_key" ON "ItemMedia"("itemId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ItemMedia" ADD CONSTRAINT "ItemMedia_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions.
-- ---------------------------------------------------------------------------

ALTER TABLE "ItemMedia" ADD CONSTRAINT "ItemMedia_sortOrder_check" CHECK ("sortOrder" >= 0);

-- Backfill: every existing single image becomes the item's first media entry.
-- "imageUrl" itself is left untouched (it stays the listing's cover image).
-- The Cloudinary public id is recovered from the URL so the asset can be
-- deleted later; for a non-Cloudinary URL it stays NULL.
INSERT INTO "ItemMedia" ("itemId", "type", "url", "publicId", "sortOrder")
SELECT
  "id",
  'IMAGE',
  "imageUrl",
  substring("imageUrl" from '^https://res\.cloudinary\.com/[^/]+/image/upload/(?:v[0-9]+/)?(.+)\.[A-Za-z0-9]+$'),
  0
FROM "Item"
WHERE "imageUrl" IS NOT NULL AND "imageUrl" <> '';
