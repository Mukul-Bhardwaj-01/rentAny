-- Store money as an exact fixed-point value instead of a floating point number.
-- AlterTable
ALTER TABLE "Item" ALTER COLUMN "pricePerHour" SET DATA TYPE DECIMAL(10,2);

-- Emails are now normalized (trimmed + lowercased) by the API on register and
-- login, so bring existing rows in line. Fails on the unique index if two
-- accounts differ only by case, which must then be resolved manually.
UPDATE "User" SET "email" = LOWER(TRIM("email")) WHERE "email" <> LOWER(TRIM("email"));
