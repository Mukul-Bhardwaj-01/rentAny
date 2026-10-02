import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import FieldError from "../components/FieldError.jsx";
import MediaGallery from "../components/MediaGallery.jsx";
import ManageMedia from "../components/ManageMedia.jsx";
import { mediaForItem } from "../utils/media.js";
import { formatPrice, formatDateTime, toDateTimeLocalValue } from "../utils/format.js";

// Must match the backend's booking rules (booking.validators.js).
const MIN_HOURS = 1;
const MAX_HOURS = 72;
const MIN_LEAD_MS = 30 * 60 * 1000;
const MAX_ADVANCE_MS = 30 * 24 * 60 * 60 * 1000;

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

  if (loading) return <p className="text-center mt-10">Loading item...</p>;
  if (loadError) {
    return (
      <div className="max-w-md mx-auto mt-10 text-center">
        <p className="text-red-600">{loadError}</p>
        <Link to="/" className="text-blue-600">Back to home</Link>
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
    <div className="max-w-5xl mx-auto p-6 grid gap-8 md:grid-cols-2">
      <div>
        <MediaGallery media={mediaForItem(item)} title={item.title} />
        <h1 className="text-2xl font-bold mt-4">{item.title}</h1>
        <p className="text-slate-500">{item.category} · {item.location}</p>
        <p className="mt-2 text-xl font-bold">₹{formatPrice(item.pricePerHour)}/hr</p>
        <p className="mt-4 whitespace-pre-line">{item.description}</p>
        <p className="mt-4 text-sm text-slate-500">Listed by {item.owner?.name}</p>
        {isOwner && (
          <ManageMedia item={item} onChange={(updated) => setItem({ ...item, ...updated })} />
        )}
      </div>

      <div>
        <div className="border rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-3">Book this item</h2>

          {isOwner ? (
            <p className="text-slate-600">
              This is your listing. Requests for it appear in{" "}
              <Link to="/bookings?as=owner" className="text-blue-600">My bookings</Link>.
            </p>
          ) : !item.isAvailable ? (
            <p className="text-slate-600">The owner has paused bookings for this item.</p>
          ) : !user ? (
            <p className="text-slate-600">
              <Link to="/login" state={{ from: `/items/${item.id}` }} className="text-blue-600">Log in</Link>{" "}
              to request this item.
            </p>
          ) : (
            <>
              {error && <p className="text-red-600 mb-3">{error}</p>}
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <label className="text-sm font-medium">
                  Start time
                  <input
                    type="datetime-local"
                    className="border p-2 rounded w-full mt-1 font-normal"
                    required
                    min={toDateTimeLocalValue(new Date(Date.now() + MIN_LEAD_MS))}
                    max={toDateTimeLocalValue(new Date(Date.now() + MAX_ADVANCE_MS))}
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                  />
                </label>
                <FieldError message={fieldErrors.startTime} />
                <label className="text-sm font-medium">
                  Hours
                  <input
                    type="number"
                    className="border p-2 rounded w-full mt-1 font-normal"
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
                  className="border p-2 rounded"
                  placeholder="Note for the owner (optional)"
                  maxLength={500}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
                <FieldError message={fieldErrors.note} />

                {end && (
                  <div className="bg-slate-50 rounded p-3 text-sm">
                    <p>Until {formatDateTime(end)}</p>
                    <p className="font-semibold mt-1">
                      Total: ₹{formatPrice(Number(item.pricePerHour) * hours)}{" "}
                      <span className="font-normal text-slate-500">
                        (₹{formatPrice(item.pricePerHour)} × {hours} hr)
                      </span>
                    </p>
                  </div>
                )}
                {clash && <p className="text-sm text-red-600">This time overlaps an existing booking.</p>}

                <button
                  className="bg-slate-900 text-white py-2 rounded disabled:opacity-50"
                  disabled={submitting || !!clash || !end}
                >
                  {submitting ? "Sending request..." : "Request booking"}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="mt-6">
          <h3 className="font-semibold mb-2">Already booked (next 30 days)</h3>
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
