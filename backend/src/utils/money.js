// Exact money handling. Amounts are Decimal rupees with 2 decimals (as in the
// database); Razorpay works in whole paise. Never use JS floats for money.
import { Prisma } from "@prisma/client";

const { Decimal } = Prisma;

export const PLATFORM_FEE = new Decimal("49.00"); // paid by the renter, on top of the rental
export const MAX_SECURITY_DEPOSIT = new Decimal("50000.00");
export const ZERO = new Decimal(0);

export const dec = (value) => new Decimal(value);

// Rupees (Decimal | string | number) -> integer paise. Throws if the amount
// has more than 2 decimals, so nothing is silently rounded.
export function toPaise(rupees) {
  const paise = dec(rupees).mul(100);
  if (!paise.isInteger()) throw new Error(`Amount ${rupees} has fractions of a paisa`);
  return paise.toNumber();
}

// Integer paise -> Decimal rupees.
export function fromPaise(paise) {
  if (!Number.isSafeInteger(paise)) throw new Error(`Invalid paise amount ${paise}`);
  return dec(paise).div(100);
}

// For JSON responses and messages: "1234.50".
export const fmt = (amount) => dec(amount).toFixed(2);

export const sum = (values) => values.reduce((total, v) => total.add(dec(v)), ZERO);
