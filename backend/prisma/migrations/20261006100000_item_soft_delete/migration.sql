-- Owners can delete listings. The row is kept (soft delete) because past
-- bookings, payments, deposit claims and reviews still reference it; a
-- deleted listing is hidden everywhere and can never take bookings again.
ALTER TABLE "Item" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- A deleted listing is never available.
ALTER TABLE "Item" ADD CONSTRAINT "Item_deleted_not_available"
  CHECK ("deletedAt" IS NULL OR "isAvailable" = false);

CREATE INDEX "Item_ownerId_idx" ON "Item"("ownerId");
