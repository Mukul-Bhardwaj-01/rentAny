import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { formatPrice, formatDateTime } from "../utils/format.js";
import FieldError from "../components/FieldError.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

const rs = (v) => `₹${formatPrice(v)}`;
const REASON = { DAMAGE: "Damage", LATE_RETURN: "Late return", MISSING_PARTS: "Missing parts", OTHER: "Other" };
const CLAIM_FILTERS = [
  ["", "Open & disputed"],
  ["DISPUTED", "Disputed"],
  ["OPEN", "Waiting for renter"],
  ["APPROVED", "Approved"],
  ["REJECTED", "Rejected"],
  ["ACCEPTED", "Accepted by renter"],
  ["WITHDRAWN", "Withdrawn"],
];
const DEPOSIT_STATUS = {
  NOT_COLLECTED: "Not collected", HELD: "Held", CLAIM_OPEN: "Held (claim open)", RELEASE_PENDING: "Being refunded",
  REFUNDED: "Refunded", PARTIALLY_REFUNDED: "Partially refunded", FORFEITED: "Forfeited",
};

// Admin panel: resolve security-deposit disputes and see a basic overview.
// Uses the existing admin API; all rules (amount limits, release) are enforced
// by the server.
export default function AdminDashboard() {
  const [tab, setTab] = useState("claims");
  const tabBtn = (value, label) => (
    <button
      onClick={() => setTab(value)}
      className={`px-4 py-2 border-b-2 ${tab === value ? "border-slate-900 font-semibold" : "border-transparent text-slate-500"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Admin panel</h1>
      <div className="flex border-b mb-4">
        {tabBtn("claims", "Deposit disputes")}
        {tabBtn("overview", "Overview")}
      </div>
      {tab === "claims" ? <Claims /> : <Overview />}
    </div>
  );
}

function Claims() {
  const [status, setStatus] = useState("");
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/deposit-claims", { params: status ? { status } : {} });
      setClaims(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load claims"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 text-sm">
        <label htmlFor="claim-status" className="text-slate-500">Show</label>
        <select id="claim-status" className="border p-1 rounded" value={status} onChange={(e) => { setStatus(e.target.value); setNotice(""); }}>
          {CLAIM_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button onClick={load} className="text-blue-600 ml-2">Refresh</button>
      </div>
      {notice && <p className="mb-3 text-green-700">{notice}</p>}
      {error && <p className="mb-3 text-red-600">{error}</p>}
      {loading ? (
        <p>Loading claims…</p>
      ) : claims.length === 0 ? (
        <p className="text-slate-500">No claims here.</p>
      ) : (
        <ul className="space-y-3">
          {claims.map((c) => (
            <ClaimCard key={c.id} claim={c} onResolved={(msg) => { setNotice(msg); load(); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ClaimCard({ claim, onResolved }) {
  const b = claim.booking;
  const resolvable = ["OPEN", "DISPUTED"].includes(claim.status);
  const [amount, setAmount] = useState(claim.amountClaimed);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  async function resolve(approvedAmount) {
    const label = Number(approvedAmount) > 0 ? `deduct ${rs(approvedAmount)} from the deposit` : "reject this claim (deduct nothing)";
    if (!window.confirm(`Confirm: ${label}? This can't be undone.`)) return;
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      await api.post(`/admin/deposit-claims/${claim.id}/resolve`, { approvedAmount: String(approvedAmount), note });
      onResolved(`Claim #${claim.id} resolved.`);
    } catch (err) {
      setError(getErrorMessage(err, "Could not resolve the claim"));
      setFieldErrors(getFieldErrors(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="border rounded-lg p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            Claim #{claim.id} · {REASON[claim.reason]} · {rs(claim.amountClaimed)}
          </p>
          <p className="text-slate-600">
            <Link to={`/items/${b.item.id}`} className="hover:underline">{b.item.title}</Link> · booking #{b.id} ·
            owner {b.owner.name} → renter {b.renter.name}
          </p>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded bg-slate-100">{claim.status}</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 mt-3">
        <p><span className="text-slate-500">Owner's description:</span> {claim.description}</p>
        <p><span className="text-slate-500">Renter's response:</span> {claim.renterResponse || "—"}</p>
        <p><span className="text-slate-500">Deposit:</span> {rs(b.securityDeposit)} ({DEPOSIT_STATUS[b.depositStatus] || b.depositStatus})</p>
        <p className="flex items-center gap-2"><span className="text-slate-500">Booking:</span> <StatusBadge status={b.status} /></p>
        <p><span className="text-slate-500">Rental:</span> {formatDateTime(b.startTime)} – {formatDateTime(b.endTime)}</p>
        <p><span className="text-slate-500">Returned:</span> {b.returnedAt ? formatDateTime(b.returnedAt) : "—"}</p>
        <p><span className="text-slate-500">Claim raised:</span> {formatDateTime(claim.createdAt)}</p>
        {claim.amountApproved !== null && <p><span className="text-slate-500">Approved:</span> {rs(claim.amountApproved)}</p>}
        {claim.resolutionNote && <p className="sm:col-span-2"><span className="text-slate-500">Resolution note:</span> {claim.resolutionNote}</p>}
      </div>

      {resolvable && (
        <div className="mt-4 border-t pt-3 space-y-2">
          <p className="font-medium">Resolve</p>
          {error && <p className="text-red-600">{error}</p>}
          <label className="flex flex-wrap items-center gap-2">
            Deduct from deposit (₹0 – {rs(claim.amountClaimed)})
            <input type="number" min="0" max={claim.amountClaimed} step="0.01" className="border p-1 rounded w-32"
              value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} />
          </label>
          <FieldError message={fieldErrors.approvedAmount} />
          <textarea className="border p-2 rounded w-full" rows={2} maxLength={1000} placeholder="Resolution note (required, shown to both parties)"
            value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} />
          <FieldError message={fieldErrors.note} />
          <div className="flex flex-wrap gap-2">
            <button disabled={saving || amount === ""} onClick={() => resolve(amount)} className="bg-slate-900 text-white px-3 py-1.5 rounded disabled:opacity-50">
              Approve {amount === "" ? "" : rs(amount)}
            </button>
            <button disabled={saving} onClick={() => resolve(claim.amountClaimed)} className="border px-3 py-1.5 rounded disabled:opacity-50">
              Approve full claim
            </button>
            <button disabled={saving} onClick={() => resolve("0")} className="border border-red-300 text-red-700 px-3 py-1.5 rounded disabled:opacity-50">
              Reject (₹0)
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Once no claims are open and the 48-hour window has passed, the rest of the deposit is refunded to the renter automatically.
          </p>
        </div>
      )}
    </li>
  );
}

function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setData((await api.get("/admin/overview")).data);
      setError("");
    } catch (err) {
      setError(getErrorMessage(err, "Could not load the overview"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function retry(refund) {
    setBusy(refund.id);
    setNotice("");
    try {
      const res = await api.post(`/admin/refunds/${refund.id}/retry`);
      setNotice(`Refund #${refund.id}: ${res.data.status.toLowerCase()}${res.data.lastError ? ` (${res.data.lastError})` : ""}`);
      await load();
    } catch (err) {
      setNotice(getErrorMessage(err, "Retry failed"));
    } finally {
      setBusy(null);
    }
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p>Loading overview…</p>;
  const { counts } = data;
  const stat = (label, value) => (
    <div className="border rounded-lg p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );

  return (
    <div className="space-y-6 text-sm">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {stat("Users", counts.users)}
        {stat("Listings (available)", `${counts.items} (${counts.availableItems})`)}
        {stat("Open claims", counts.openClaims)}
        {stat("Disputed claims", counts.disputedClaims)}
      </div>

      <div>
        <h2 className="font-semibold mb-2">Bookings by status</h2>
        {Object.keys(counts.bookings).length === 0 ? (
          <p className="text-slate-500">No bookings yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(counts.bookings).map(([s, n]) => (
              <span key={s} className="flex items-center gap-1"><StatusBadge status={s} /> {n}</span>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-semibold mb-2">Refunds needing attention</h2>
        {notice && <p className="mb-2 text-slate-700">{notice}</p>}
        {data.refundsNeedingAttention.length === 0 ? (
          <p className="text-slate-500">None — all refunds are processing or done.</p>
        ) : (
          <ul className="space-y-2">
            {data.refundsNeedingAttention.map((r) => (
              <li key={r.id} className="border rounded p-2 flex flex-wrap items-center justify-between gap-2">
                <span>
                  #{r.id} · booking #{r.bookingId} · {r.purpose.toLowerCase().replace(/_/g, " ")} · {rs(r.amount)} ·{" "}
                  <span className={r.status === "FAILED" ? "text-red-600" : "text-amber-700"}>{r.status.toLowerCase()}</span>
                  {r.lastErrorDescription && <span className="text-slate-500"> — {r.lastErrorDescription}</span>}
                </span>
                <button disabled={busy === r.id} onClick={() => retry(r)} className="border px-2 py-1 rounded disabled:opacity-50">
                  {busy === r.id ? "Retrying…" : "Retry now"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="font-semibold mb-2">Newest users</h2>
          <ul className="divide-y border rounded">
            {data.recentUsers.map((u) => (
              <li key={u.id} className="p-2">
                <span className="font-medium">{u.name}</span>
                {u.role === "ADMIN" && <span className="ml-1 text-xs bg-slate-900 text-white px-1 rounded">ADMIN</span>}
                <span className="block text-xs text-slate-500">
                  {u.email} · {u.listings} listings · {u.rentals} rentals · joined {formatDateTime(u.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-semibold mb-2">Newest listings</h2>
          <ul className="divide-y border rounded">
            {data.recentItems.map((i) => (
              <li key={i.id} className="p-2">
                <Link to={`/items/${i.id}`} className="font-medium hover:underline">{i.title}</Link>
                {!i.isAvailable && <span className="ml-1 text-xs text-amber-700">(paused)</span>}
                <span className="block text-xs text-slate-500">
                  {i.category} · {rs(i.pricePerHour)}/hr · by {i.owner.name} · {formatDateTime(i.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
