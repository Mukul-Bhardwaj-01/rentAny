-- CreateEnum
CREATE TYPE "ReviewDirection" AS ENUM ('RENTER_TO_OWNER', 'OWNER_TO_RENTER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_RECEIVED';

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingSum" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "ownerRatingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ownerRatingSum" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "renterRatingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "renterRatingSum" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "subjectId" INTEGER NOT NULL,
    "itemId" INTEGER,
    "direction" "ReviewDirection" NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Review_subjectId_direction_createdAt_idx" ON "Review"("subjectId", "direction", "createdAt");

-- CreateIndex
CREATE INDEX "Review_itemId_createdAt_idx" ON "Review"("itemId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_bookingId_authorId_key" ON "Review"("bookingId", "authorId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions.
-- ---------------------------------------------------------------------------
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
-- Nobody can review themselves, whatever the API does.
ALTER TABLE "Review" ADD CONSTRAINT "Review_not_self_check" CHECK ("authorId" <> "subjectId");
ALTER TABLE "Item" ADD CONSTRAINT "Item_rating_totals_check" CHECK ("ratingSum" >= 0 AND "ratingCount" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_rating_totals_check" CHECK (
  "ownerRatingSum" >= 0 AND "ownerRatingCount" >= 0 AND "renterRatingSum" >= 0 AND "renterRatingCount" >= 0
);
