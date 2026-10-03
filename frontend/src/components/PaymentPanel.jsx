import { useEffect, useState } from "react";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { openCheckout } from "../utils/razorpayCheckout.js";
import { formatPrice, formatDateTime } from "../utils/format.js";
import FieldError from "./FieldError.jsx";

const REFUND_PURPOSE = {
  CANCELLATION: "Cancellation refund",
  DEPOSIT_RELEASE: "Security deposit refund",
  BOOKING_NOT_PAYABLE: "Refund of a late payment",
  DUPLICATE_PAYMENT: "Refund of a duplicate payment",
  ADMIN_ADJUSTMENT: "Adjustment",
};
const REFUND_STATUS = { REQUESTED: "Requested", PENDING: "Processing", PROCESSED: "Refunded", FAILED: "Delayed — retrying" };
const DEPOSIT_STATUS = {
  NOT_COLLECTED: "Not collected",
  HELD: "Held",
  CLAIM_OPEN: "Held — claim in progress",
  RELEASE_PENDING: "Being refunded",
  REFUNDED: "Refunded in full",
  PARTIALLY_REFUNDED: "Refunded minus deductions",
  FORFEITED: "Fully deducted",
};
const CLAIM_REASON = { DAMAGE: "Damage", LATE_RETURN: "Late return", MISSING_PARTS: "Missing parts", OTHER: "Other" };
const CLAIM_STATUS = {
  OPEN: "Waiting for renter",
  ACCEPTED: "Accepted by renter",
  DISPUTED: "Disputed — admin review",
  APPROVED: "Approved by admin",
  REJECTED: "Rejected by admin",
  WITHDRAWN: "Withdrawn",
};

const rs = (v) => `₹${formatPrice(v)}`;

// Payment, refunds and security deposit for one booking (renter or owner view).
// Everything shown comes from GET /bookings/:id/payment; paying goes through
// Razorpay Checkout and is confirmed by the server, never by this page.
export default function PaymentPanel({ bookingId, onChanged, autoPay = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await api.get(`/bookings/${bookingId}/payment`);
      setData(res.data);
      setError("");
      return res.data;
    } catch (err) {
      setError(getErrorMessage(err, "Could not load payment details"));
      return null;
    }
  }

  useEffect(() => {
    load().then((d) => {
      if (autoPay && d?.canPay) pay();
    });
  }, [bookingId]);

  // The server may need a moment to hear from Razorpay: check a few times.
  async function waitForConfirmation() {
    for (let i = 0; i < 10; i++) {
      const d = await load();
      if (d && d.bookingStatus !== "ACCEPTED") return d;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    return null;
  }

  async function pay() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const order = (await api.post(`/bookings/${bookingId}/payment/order`)).data;
      const result = await openCheckout(order);
      if (result.status === "dismissed") {
        setError(result.error ? `Payment failed: ${result.error}. You can try again.` : `Payment not completed. You can pay until ${formatDateTime(order.paymentDueAt)}.`);
        await load();
        return;
      }
      setNotice("Confirming your payment…");
      try {
        const res = await api.post(`/bookings/${bookingId}/payment/verify`, result.response);
        setData(res.data);
      } catch (err) {
        // e.g. Razorpay slow to answer: the server keeps checking.
        if (err.response?.status !== 502) throw err;
        await waitForConfirmation();
      }
      setNotice("");
      onChanged?.();
    } catch (err) {
      setNotice("");
      setError(getErrorMessage(err, "Payment could not be started"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function claimAction(claimId, action, body) {
    setBusy(true);
    setError("");
    try {
      const res = await api.post(`/bookings/${bookingId}/deposit/claims/${claimId}/${action}`, body);
      setData(res.data);
      onChanged?.();
    } catch (err) {
      setError(getErrorMessage(err, "That didn't work"));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-sm text-slate-500 mt-2">{error || "Loading payment details…"}</p>;

  const { amounts, payment, refunds, deposit, role } = data;
  const isRenter = role === "renter";
  const hasDeposit = Number(deposit.amount) > 0;

  return (
    <div className="mt-3 border-t pt-3 text-sm space-y-3">
      {error && <p className="text-red-600">{error}</p>}
      {notice && <p className="text-blue-700">{notice}</p>}

      {data.policyCode === "LEGACY" ? (
        <p className="text-slate-500">This booking was made before online payments; nothing to pay.</p>
      ) : (
        <table className="w-full max-w-xs">
          <tbody>
            <tr><td className="text-slate-600">Rental</td><td className="text-right">{rs(amounts.rentalAmount)}</td></tr>
            <tr><td className="text-slate-600">Platform fee</td><td className="text-right">{rs(amounts.platformFee)}</td></tr>
            <tr><td className="text-slate-600">Security deposit (refundable)</td><td className="text-right">{rs(amounts.securityDeposit)}</td></tr>
            <tr className="font-semibold border-t"><td>Total</td><td className="text-right">{rs(amounts.totalPayable)}</td></tr>
          </tbody>
        </table>
      )}

      {/* Payment */}
      {data.bookingStatus === "ACCEPTED" && (
        <div>
          {isRenter ? (
            data.canPay ? (
              <>
                <button onClick={pay} disabled={busy} className="bg-slate-900 text-white px-4 py-1.5 rounded disabled:opacity-50">
                  {busy ? "Opening payment…" : `Pay ${rs(amounts.totalPayable)}`}
                </button>
                <p className="text-xs text-slate-500 mt-1">Pay by {formatDateTime(data.paymentDueAt)} or the booking expires.</p>
              </>
            ) : (
              <p className="text-amber-700">{data.paymentsEnabled ? "The payment deadline has passed." : "Online payments are not available right now."}</p>
            )
          ) : (
            <p className="text-slate-600">Waiting for the renter to pay (until {formatDateTime(data.paymentDueAt)}).</p>
          )}
          {payment?.failedAttempts > 0 && isRenter && (
            <p className="text-xs text-red-600 mt-1">Last attempt failed{payment.lastError ? `: ${payment.lastError}` : ""}.</p>
          )}
        </div>
      )}
      {payment?.status === "CAPTURED" && (
        <p className="text-green-700">
          ✓ Paid {rs(amounts.totalPayable)}{payment.method ? ` via ${payment.method}` : ""} on {formatDateTime(payment.capturedAt)}
          {isRenter && payment.razorpayPaymentId && <span className="text-slate-400"> · ref {payment.razorpayPaymentId}</span>}
        </p>
      )}

      {/* Refunds */}
      {refunds.length > 0 && (
        <div>
          <p className="font-medium">Refunds</p>
          <ul className="space-y-1">
            {refunds.map((r) => (
              <li key={r.id} className="flex justify-between gap-2">
                <span>{REFUND_PURPOSE[r.purpose] || r.purpose} · {rs(r.amount)}</span>
                <span className={r.status === "PROCESSED" ? "text-green-700" : r.status === "FAILED" ? "text-red-600" : "text-slate-500"}>
                  {REFUND_STATUS[r.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Security deposit */}
      {hasDeposit && deposit.status !== "NOT_COLLECTED" && (
        <div>
          <p className="font-medium">
            Security deposit: {rs(deposit.amount)} · <span className="font-normal">{DEPOSIT_STATUS[deposit.status]}</span>
          </p>
          {["HELD", "CLAIM_OPEN"].includes(deposit.status) && deposit.releaseAt && (
            <p className="text-xs text-slate-500">
              Claim window ends {formatDateTime(deposit.releaseAt)}; the deposit is refunded after that unless a claim is unresolved.
            </p>
          )}
          {Number(deposit.deducted) > 0 && <p className="text-xs text-slate-600">Deducted: {rs(deposit.deducted)}</p>}

          {deposit.claims.length > 0 && (
            <ul className="mt-2 space-y-2">
              {deposit.claims.map((c) => (
                <li key={c.id} className="border rounded p-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{CLAIM_REASON[c.reason]} · {rs(c.amountClaimed)}</span>
                    <span className="text-xs text-slate-500">{CLAIM_STATUS[c.status]}</span>
                  </div>
                  <p className="text-slate-600">{c.description}</p>
                  {c.amountApproved !== null && <p className="text-xs">Deducted: {rs(c.amountApproved)}</p>}
                  {c.renterResponse && <p className="text-xs text-slate-500">Renter: {c.renterResponse}</p>}
                  {c.resolutionNote && <p className="text-xs text-slate-500">Admin: {c.resolutionNote}</p>}
                  <div className="flex gap-2 mt-1">
                    {isRenter && c.status === "OPEN" && (
                      <>
                        <button disabled={busy} className="text-xs bg-slate-900 text-white px-2 py-1 rounded disabled:opacity-50"
                          onClick={() => window.confirm(`Accept a deduction of ${rs(c.amountClaimed)} from your deposit?`) && claimAction(c.id, "accept")}>
                          Accept
                        </button>
                        <button disabled={busy} className="text-xs border px-2 py-1 rounded disabled:opacity-50"
                          onClick={() => {
                            const response = window.prompt("Why do you dispute this claim? An admin will review it.");
                            if (response !== null) claimAction(c.id, "dispute", { response });
                          }}>
                          Dispute
                        </button>
                      </>
                    )}
                    {!isRenter && ["OPEN", "DISPUTED"].includes(c.status) && (
                      <button disabled={busy} className="text-xs border px-2 py-1 rounded disabled:opacity-50"
                        onClick={() => window.confirm("Withdraw this claim?") && claimAction(c.id, "withdraw")}>
                        Withdraw
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {deposit.canClaim && <ClaimForm bookingId={bookingId} deposit={deposit} onSaved={(d) => { setData(d); onChanged?.(); }} />}
        </div>
      )}

      {data.policy?.length > 0 && data.policyCode !== "LEGACY" && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">Cancellation & refund policy</summary>
          <ul className="list-disc ml-5 mt-1">{data.policy.map((p) => <li key={p}>{p}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

// Owner: claim from the deposit during the 48-hour window after return.
function ClaimForm({ bookingId, deposit, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reason: "DAMAGE", amount: "", description: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 text-xs border px-2 py-1 rounded">
        Report damage / late return
      </button>
    );
  }

  function setReason(reason) {
    // A late-return claim starts from the suggested amount (never automatic).
    const suggested = reason === "LATE_RETURN" && Number(deposit.suggestedLateFee) > 0 ? deposit.suggestedLateFee : form.amount;
    setForm({ ...form, reason, amount: suggested });
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setError("");
    try {
      const res = await api.post(`/bookings/${bookingId}/deposit/claims`, form);
      onSaved(res.data);
      setOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, "Could not raise the claim"));
      setErrors(getFieldErrors(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-2 border rounded p-2 space-y-2 max-w-sm">
      <p className="text-xs text-slate-500">Up to {rs(deposit.available)} can still be claimed. The renter can accept or dispute it.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <select className="border p-1 rounded w-full" value={form.reason} onChange={(e) => setReason(e.target.value)}>
        {Object.entries(CLAIM_REASON).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input className="border p-1 rounded w-full" type="number" min="0.01" max={deposit.available} step="0.01" required
        placeholder="Amount (₹)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
      <FieldError message={errors.amount} />
      {form.reason === "LATE_RETURN" && Number(deposit.suggestedLateFee) > 0 && (
        <p className="text-xs text-slate-500">Suggested from the late return: {rs(deposit.suggestedLateFee)}</p>
      )}
      <textarea className="border p-1 rounded w-full" required minLength={10} maxLength={1000}
        placeholder="What happened? (min 10 characters)" value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <FieldError message={errors.description} />
      <div className="flex gap-2">
        <button disabled={saving} className="bg-slate-900 text-white text-xs px-3 py-1 rounded disabled:opacity-50">
          {saving ? "Submitting…" : "Submit claim"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs border px-3 py-1 rounded">Cancel</button>
      </div>
    </form>
  );
}
