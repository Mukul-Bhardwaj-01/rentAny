-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('RENTER', 'OWNER');

-- CreateTable
CREATE TABLE "Booking" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "renterId" INTEGER NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "startTime" TIMESTAMPTZ(3) NOT NULL,
    "endTime" TIMESTAMPTZ(3) NOT NULL,
    "hours" INTEGER NOT NULL,
    "pricePerHour" DECIMAL(10,2) NOT NULL,
    "rentalAmount" DECIMAL(10,2) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "renterNote" TEXT,
    "responseNote" TEXT,
    "cancelledBy" "CancelledBy",
    "cancelReason" TEXT,
    "respondedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Booking_itemId_startTime_idx" ON "Booking"("itemId", "startTime");

-- CreateIndex
CREATE INDEX "Booking_renterId_createdAt_idx" ON "Booking"("renterId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_ownerId_createdAt_idx" ON "Booking"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_renterId_fkey" FOREIGN KEY ("renterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma can't express in schema.prisma (hand-written).
-- Prisma doesn't model CHECK or EXCLUDE constraints, so it leaves them alone.
-- ---------------------------------------------------------------------------

-- Basic sanity rules, enforced even if a bug in the API slips past validation.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hours_check" CHECK ("hours" BETWEEN 1 AND 72);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_time_order_check" CHECK ("endTime" > "startTime");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_rentalAmount_check" CHECK ("rentalAmount" >= 0);

-- No two ACCEPTED/ACTIVE bookings for the same item may overlap in time.
-- Intervals are half-open [start, end), so back-to-back bookings are allowed.
-- btree_gist lets the GiST index combine "=" on itemId with "&&" on ranges.
-- PENDING requests are deliberately excluded: they don't reserve a slot.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "itemId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
  )
  WHERE ("status" IN ('ACCEPTED', 'ACTIVE'));
