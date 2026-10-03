-- New enum values must be committed before any statement can use them, so
-- they get a migration of their own (used by the next migration).

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'CONFIRMED' AFTER 'ACCEPTED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'BOOKING_PAYMENT_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_INITIATED';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_PROCESSED';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'DEPOSIT_CLAIM_RAISED';
ALTER TYPE "NotificationType" ADD VALUE 'DEPOSIT_CLAIM_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'DEPOSIT_CLAIM_DISPUTED';
ALTER TYPE "NotificationType" ADD VALUE 'DEPOSIT_CLAIM_WITHDRAWN';
ALTER TYPE "NotificationType" ADD VALUE 'DEPOSIT_CLAIM_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE 'DEPOSIT_RELEASED';
