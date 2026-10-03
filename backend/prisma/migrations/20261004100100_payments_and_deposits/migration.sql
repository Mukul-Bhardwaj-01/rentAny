-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('NOT_COLLECTED', 'HELD', 'CLAIM_OPEN', 'RELEASE_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'CAPTURED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RefundPurpose" AS ENUM ('CANCELLATION', 'DEPOSIT_RELEASE', 'BOOKING_NOT_PAYABLE', 'DUPLICATE_PAYMENT', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('RENTER', 'OWNER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DepositClaimReason" AS ENUM ('DAMAGE', 'LATE_RETURN', 'MISSING_PARTS', 'OTHER');

-- CreateEnum
CREATE TYPE "DepositClaimStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISPUTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "PaymentEventSource" AS ENUM ('CHECKOUT_CALLBACK', 'WEBHOOK', 'RECONCILIATION', 'USER', 'ADMIN', 'SYSTEM');

-- DropIndex (replaced by the dedupeKey unique index below)
DROP INDEX "Notification_bookingId_recipientId_type_key";

-- AlterTable: Booking financial snapshot + payment/deposit state.
-- Existing (pre-payment) bookings are grandfathered: no fee, no deposit,
-- total = rental, policy "LEGACY". Defaults are only used for this backfill.
ALTER TABLE "Booking" ADD COLUMN     "depositReleaseAt" TIMESTAMPTZ(3),
ADD COLUMN     "depositStatus" "DepositStatus" NOT NULL DEFAULT 'NOT_COLLECTED',
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentDueAt" TIMESTAMPTZ(3),
ADD COLUMN     "platformFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "policyCode" TEXT NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "securityDeposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "totalPayable" DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE "Booking" SET "totalPayable" = "rentalAmount";

ALTER TABLE "Booking" ALTER COLUMN "platformFee" DROP DEFAULT,
ALTER COLUMN "policyCode" DROP DEFAULT,
ALTER COLUMN "securityDeposit" DROP DEFAULT,
ALTER COLUMN "totalPayable" DROP DEFAULT;

-- AlterTable: existing listings keep working with a ₹0 deposit.
ALTER TABLE "Item" ADD COLUMN     "securityDeposit" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable: notification dedupe keys. Existing rows get the key the old
-- unique rule implied (one per booking event per recipient).
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT;
UPDATE "Notification" SET "dedupeKey" = CASE
  WHEN "bookingId" IS NULL THEN "type"::text || ':notification:' || "id"
  ELSE "type"::text || ':booking:' || "bookingId"
END;
ALTER TABLE "Notification" ALTER COLUMN "dedupeKey" SET NOT NULL;

-- AlterTable: existing users are regular users.
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "method" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorReason" TEXT,
    "lastErrorDescription" TEXT,
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" SERIAL NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "razorpayPaymentId" TEXT NOT NULL,
    "razorpayRefundId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "purpose" "RefundPurpose" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "initiatedBy" "Actor" NOT NULL,
    "initiatedById" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorDescription" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepositClaim" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "raisedById" INTEGER NOT NULL,
    "reason" "DepositClaimReason" NOT NULL,
    "description" TEXT NOT NULL,
    "amountClaimed" DECIMAL(10,2) NOT NULL,
    "amountApproved" DECIMAL(10,2),
    "status" "DepositClaimStatus" NOT NULL DEFAULT 'OPEN',
    "renterResponse" TEXT,
    "resolvedById" INTEGER,
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DepositClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" SERIAL NOT NULL,
    "bookingId" INTEGER,
    "paymentId" INTEGER,
    "refundId" INTEGER,
    "claimId" INTEGER,
    "type" TEXT NOT NULL,
    "source" "PaymentEventSource" NOT NULL,
    "actorId" INTEGER,
    "razorpayEventId" TEXT,
    "amount" DECIMAL(10,2),
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_bookingId_key" ON "Payment"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON "Payment"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON "Payment"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_razorpayRefundId_key" ON "Refund"("razorpayRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_bookingId_idx" ON "Refund"("bookingId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE INDEX "DepositClaim_bookingId_idx" ON "DepositClaim"("bookingId");

-- CreateIndex
CREATE INDEX "DepositClaim_status_idx" ON "DepositClaim"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_razorpayEventId_key" ON "PaymentEvent"("razorpayEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_bookingId_createdAt_idx" ON "PaymentEvent"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentId_idx" ON "PaymentEvent"("paymentId");

-- CreateIndex
CREATE INDEX "Booking_status_paymentDueAt_idx" ON "Booking"("status", "paymentDueAt");

-- CreateIndex
CREATE INDEX "Booking_depositStatus_depositReleaseAt_idx" ON "Booking"("depositStatus", "depositReleaseAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientId_dedupeKey_key" ON "Notification"("recipientId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepositClaim" ADD CONSTRAINT "DepositClaim_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written additions.
-- ---------------------------------------------------------------------------

-- Grandfather existing accepted bookings: they were accepted before payments
-- existed, so they are treated as confirmed (nothing to pay, nothing held).
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_no_overlap";
UPDATE "Booking" SET "status" = 'CONFIRMED' WHERE "status" = 'ACCEPTED';

-- The slot is reserved from acceptance (awaiting payment) through the rental.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "itemId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
  )
  WHERE ("status" IN ('ACCEPTED', 'CONFIRMED', 'ACTIVE'));

-- Money sanity rules, enforced even if a bug slips past the API.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_money_check" CHECK (
  "platformFee" >= 0 AND "securityDeposit" >= 0 AND "rentalAmount" >= 0
  AND "totalPayable" = "rentalAmount" + "platformFee" + "securityDeposit"
);
ALTER TABLE "Item" ADD CONSTRAINT "Item_securityDeposit_check" CHECK ("securityDeposit" >= 0 AND "securityDeposit" <= 50000);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_check" CHECK ("amount" > 0);
ALTER TABLE "DepositClaim" ADD CONSTRAINT "DepositClaim_amount_check" CHECK (
  "amountClaimed" > 0
  AND ("amountApproved" IS NULL OR ("amountApproved" >= 0 AND "amountApproved" <= "amountClaimed"))
);

-- PaymentEvent is an append-only audit log: rows can't be changed or removed.
-- (Test cleanup may opt in per transaction with SET LOCAL rentany.allow_audit_delete = 'on'.)
CREATE FUNCTION "payment_event_append_only"() RETURNS trigger AS $$
BEGIN
  IF current_setting('rentany.allow_audit_delete', true) = 'on' THEN
    RETURN COALESCE(OLD, NEW);
  END IF;
  RAISE EXCEPTION 'PaymentEvent is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentEvent_append_only"
  BEFORE UPDATE OR DELETE ON "PaymentEvent"
  FOR EACH ROW EXECUTE FUNCTION "payment_event_append_only"();
