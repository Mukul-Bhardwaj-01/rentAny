import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import FieldError from "../components/FieldError.jsx";
import MediaGallery from "../components/MediaGallery.jsx";
import ManageMedia from "../components/ManageMedia.jsx";
import { mediaForItem } from "../utils/media.js";
import ItemReviews from "../components/ItemReviews.jsx";
import { LoadingState, ErrorState } from "../components/ui.jsx";
import LocationMap from "../components/LocationMap.jsx";
import { Stars, RatingBadge, ratingOf } from "../components/StarRating.jsx";
import { formatPrice, formatDateTime, toDateTimeLocalValue } from "../utils/format.js";

// Must match the backend's booking rules (booking.validators.js).
const MIN_HOURS = 1;
const MAX_HOURS = 72;
const MIN_LEAD_MS = 30 * 60 * 1000;
const MAX_ADVANCE_MS = 30 * 24 * 60 * 60 * 1000;
// Fixed platform fee, for display only (the server decides what is charged).
const PLATFORM_FEE_PAISE = 4900;

// First full hour that is at least 30 minutes from now.
function defaultStart() {
  const d = new Date(Date.now() + MIN_LEAD_MS);
  if (d.getMinutes() || d.getSeconds() || d.getMilliseconds()) d.setHours(d.getHours() + 1, 0, 0, 0);
  return toDateTimeLocalValue(d);
}

export default function ItemDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [item, setItem] = useState(null);
  const [booked, setBooked] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState({ start: defaultStart(), hours: "2", note: "" });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  async function fetchAvailability() {
    try {
      const res = await api.get(`/items/${id}/availability`);
      setBooked(res.data.booked);
    } catch {
      // Not critical: the server still rejects overlapping requests.
      setBooked([]);
    }
  }

  async function fetchItem() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await api.get(`/items/${id}`);
      setItem(res.data);
      await fetchAvailability();
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load this item"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchItem();
  }, [id]);

  if (loading) return <LoadingState label="Loading item…" />;
  if (loadError) {
    return (
      <div className="page-narrow">
        <ErrorState message={loadError} onRetry={fetchItem} />
        <p className="mt-4 text-center"><Link to="/" className="link">Back to home</Link></p>
      </div>
    );
  }

  const hours = Number(form.hours);
  const validHours = Number.isInteger(hours) && hours >= MIN_HOURS && hours <= MAX_HOURS;
  const start = form.start ? new Date(form.start) : null;
  const end = start && validHours ? new Date(start.getTime() + hours * 60 * 60 * 1000) : null;
  const clash = start && end && booked.find((b) => new Date(b.startTime) < end && new Date(b.endTime) > start);
  const isOwner = user && item.owner?.id === user.id;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);
    try {
      await api.post("/bookings", {
        itemId: item.id,
        startTime: start.toISOString(),
        hours,
        note: form.note,
      });
      navigate("/bookings", { state: { message: "Request sent! The owner will accept or reject it." } });
    } catch (err) {
      setError(getErrorMessage(err, "Could not send booking request"));
      setFieldErrors(getFieldErrors(err));
      // The slot may have just been taken; refresh the booked list.
      if (err.response?.status === 409) fetchAvailability();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div>
        <MediaGallery media={mediaForItem(item)} title={item.title} />
        <h1 className="page-title mt-5">{item.title}</h1>
        <p className="mt-1 text-slate-500">{item.category} · 📍 {item.location}</p>
        <p className="mt-3"><span className="text-2xl font-bold text-slate-900">₹{formatPrice(item.pricePerHour)}</span><span className="text-slate-500"> / hour</span></p>
        <p className="mt-1">
          <Stars {...ratingOf(item.ratingSum, item.ratingCount)} />
        </p>
        {Number(item.securityDeposit) > 0 && (
          <p className="text-sm text-slate-600">Refundable security deposit: ₹{formatPrice(item.securityDeposit)}</p>
        )}
        <p className="mt-5 whitespace-pre-line leading-relaxed text-slate-700">{item.description}</p>
        <LocationMap location={item.location} title={item.title} />
        <p className="mt-4 text-sm text-slate-500 flex flex-wrap items-center gap-2">
          <span>Listed by {item.owner?.name}</span>
          <RatingBadge sum={item.owner?.ownerRatingSum} count={item.owner?.ownerRatingCount} />
        </p>
        {isOwner && (
          <>
            <DepositEditor item={item} onSaved={(securityDeposit) => setItem({ ...item, securityDeposit })} />
            <ManageMedia item={item} onChange={(updated) => setItem({ ...item, ...updated })} />
          </>
        )}
        <ItemReviews itemId={item.id} />
      </div>

      <div>
        <div className="card p-5 lg:sticky lg:top-20">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Book this item</h2>

          {isOwner ? (
            <p className="text-slate-600">
              This is your listing. Requests for it appear in{" "}
              <Link to="/bookings?as=owner" className="link">My bookings</Link>.
            </p>
          ) : !item.isAvailable ? (
            <p className="text-slate-600">The owner has paused bookings for this item.</p>
          ) : !user ? (
            <p className="text-slate-600">
              <Link to="/login" state={{ from: `/items/${item.id}` }} className="link">Log in</Link>{" "}
              to request this item.
            </p>
          ) : (
            <>
              {error && <p className="alert-error mb-3">{error}</p>}
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <label className="label">
                  Start time
                  <input
                    type="datetime-local"
                    className="input mt-1 font-normal"
                    required
                    min={toDateTimeLocalValue(new Date(Date.now() + MIN_LEAD_MS))}
                    max={toDateTimeLocalValue(new Date(Date.now() + MAX_ADVANCE_MS))}
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </label>
                <FieldError message={fieldErrors.startTime} />
                <label className="label">
                  Hours
                  <input
                    type="number"
                    className="input mt-1 font-normal"
                    required
                    min={MIN_HOURS}
                    max={MAX_HOURS}
                    step="1"
                    value={form.hours}
                    onChange={(e) => setForm({ ...form, hours: e.target.value })}
                  />
                </label>
                <FieldError message={fieldErrors.hours} />
                <textarea
                  className="input"
                  placeholder="Note for the owner (optional)"
                  maxLength={500}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
                <FieldError message={fieldErrors.note} />

                {end && <PriceBreakdown item={item} hours={hours} end={end} />}
                {clash && <p className="text-sm text-red-600">This time overlaps an existing booking.</p>}

                <button
                  className="btn-primary w-full py-2.5"
                  disabled={submitting || !!clash || !end}
                >
                  {submitting ? "Sending request..." : "Request booking"}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="card mt-4 p-5">
          <h3 className="mb-2 font-semibold text-slate-900">Already booked (next 30 days)</h3>
          {booked.length === 0 ? (
            <p className="text-sm text-slate-500">No bookings yet. Any time is free.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {booked.map((b) => (
                <li key={b.startTime} className="text-slate-600">
                  {formatDateTime(b.startTime)} – {formatDateTime(b.endTime)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// Shown before requesting: exactly what will be charged once the owner
// accepts (the server snapshots the same numbers on the booking).
// Worked out in paise so there are no floating point surprises.
function PriceBreakdown({ item, hours, end }) {
  const paise = (rupees) => Math.round(Number(rupees) * 100);
  const rental = paise(item.pricePerHour) * hours;
  const deposit = paise(item.securityDeposit || 0);
  const total = rental + PLATFORM_FEE_PAISE + deposit;
  const rs = (p) => `₹${formatPrice(p / 100)}`;
  return (
    <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <p>Until {formatDateTime(end)}</p>
      <p className="flex justify-between"><span>Rental (₹{formatPrice(item.pricePerHour)} × {hours} hr)</span><span>{rs(rental)}</span></p>
      <p className="flex justify-between"><span>Platform fee</span><span>{rs(PLATFORM_FEE_PAISE)}</span></p>
      {deposit > 0 && (
        <p className="flex justify-between"><span>Security deposit (refundable)</span><span>{rs(deposit)}</span></p>
      )}
      <p className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold text-slate-900"><span>Total</span><span>{rs(total)}</span></p>
      <p className="text-xs text-slate-500 pt-1">
        You pay online after the owner accepts.{deposit > 0 ? " The deposit is refunded after the item is returned, minus any approved deductions." : ""}
      </p>
    </div>
  );
}

// Owner: set the refundable deposit for future bookings (₹0 – ₹50,000).
function DepositEditor({ item, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Number(item.securityDeposit || 0)));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await api.patch(`/items/${item.id}/security-deposit`, { securityDeposit: value });
      onSaved(res.data.securityDeposit);
      setEditing(false);
    } catch (err) {
      setError(getFieldErrors(err).securityDeposit || getErrorMessage(err, "Could not save the deposit"));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <p className="mt-4 text-sm">
        Security deposit: ₹{formatPrice(item.securityDeposit || 0)}{" "}
        <button onClick={() => setEditing(true)} className="link">Change</button>
      </p>
    );
  }
  return (
    <form onSubmit={save} className="mt-4 text-sm flex flex-wrap items-center gap-2">
      <label>
        Security deposit (₹)
        <input type="number" min="0" max="50000" step="0.01" required value={value}
          onChange={(e) => setValue(e.target.value)} className="input ml-2 w-32 py-1" />
      </label>
      <button disabled={saving} className="btn-primary btn-sm">Save</button>
      <button type="button" onClick={() => setEditing(false)} className="btn-secondary btn-sm">Cancel</button>
      <p className="w-full text-xs text-slate-500">Applies to new booking requests only.</p>
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
    </form>
  );
}
