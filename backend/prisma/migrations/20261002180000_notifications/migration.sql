-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BOOKING_REQUESTED', 'BOOKING_ACCEPTED', 'BOOKING_REJECTED', 'BOOKING_AUTO_REJECTED', 'BOOKING_CANCELLED_BY_RENTER', 'BOOKING_CANCELLED_BY_OWNER', 'BOOKING_EXPIRED', 'BOOKING_STARTED', 'BOOKING_COMPLETED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "bookingId" INTEGER,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_bookingId_recipientId_type_key" ON "Notification"("bookingId", "recipientId", "type");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

