import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import FieldError from "../components/FieldError.jsx";
import ManageMedia from "../components/ManageMedia.jsx";
import { LoadingState, ErrorState } from "../components/ui.jsx";

const FIELDS = ["title", "description", "category", "pricePerHour", "location", "securityDeposit"];

// Owner: edit a listing's details, photos/videos and availability, or delete it.
export default function EditItem() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [item, setItem] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoadError("");
    try {
      const res = await api.get(`/items/${id}`);
      setItem(res.data);
      setForm({
        ...Object.fromEntries(FIELDS.map((f) => [f, String(res.data[f] ?? "")])),
        pricePerHour: String(Number(res.data.pricePerHour)),
        securityDeposit: String(Number(res.data.securityDeposit || 0)),
        isAvailable: res.data.isAvailable,
      });
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load this listing"));
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  if (loadError) {
    return (
      <div className="page-narrow">
        <ErrorState message={loadError} onRetry={load} />
        <p className="mt-4 text-center"><Link to="/profile" className="link">Back to my profile</Link></p>
      </div>
    );
  }
  if (!item || !form) return <LoadingState label="Loading listing…" />;
  if (item.owner?.id !== user?.id) {
    return (
      <div className="page-narrow">
        <ErrorState message="Only the owner can edit this listing." />
      </div>
    );
  }

  // Only send what changed, so an untouched field is never re-validated.
  function changes() {
    const out = {};
    for (const f of FIELDS) {
      const original = f === "pricePerHour" || f === "securityDeposit" ? String(Number(item[f] || 0)) : String(item[f] ?? "");
      if (form[f].trim() !== original) out[f] = form[f].trim();
    }
    if (form.isAvailable !== item.isAvailable) out.isAvailable = form.isAvailable;
    return out;
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    const body = changes();
    if (Object.keys(body).length === 0) {
      navigate("/profile", { state: { message: "No changes to save." } });
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/items/${item.id}`, body);
      navigate("/profile", { state: { message: `"${body.title || item.title}" was updated.` } });
    } catch (err) {
      setError(getErrorMessage(err, "Could not save the listing"));
      setFieldErrors(getFieldErrors(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${item.title}"? It will be removed from rentAny. Past bookings and reviews are kept, and any open requests will be declined.`)) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/items/${item.id}`);
      navigate("/profile", { state: { message: `"${item.title}" was deleted.` } });
    } catch (err) {
      setError(getErrorMessage(err, "Could not delete the listing"));
      setDeleting(false);
    }
  }

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const busy = saving || deleting;

  return (
    <div className="page-narrow">
      <p className="mb-3 text-sm">
        <Link to="/profile" className="link">← My profile</Link>
      </p>
      <div className="card p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="page-title">Edit listing</h1>
          <Link to={`/items/${item.id}`} className="link text-sm">View listing</Link>
        </div>
        <p className="mt-1 mb-6 text-sm text-slate-500">
          Changes to the price or deposit apply to new booking requests only. Bookings already made keep their original amounts.
        </p>
        {error && <p className="alert-error mb-4">{error}</p>}

        <form onSubmit={save} className="flex flex-col gap-3">
          <label className="label">
            Title
            <input className="input mt-1 font-normal" required minLength={3} maxLength={100} value={form.title} onChange={set("title")} />
          </label>
          <FieldError message={fieldErrors.title} />
          <label className="label">
            Description
            <textarea className="input mt-1 font-normal" rows={5} required minLength={10} maxLength={2000} value={form.description} onChange={set("description")} />
          </label>
          <FieldError message={fieldErrors.description} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="label">
              Category
              <input className="input mt-1 font-normal" required minLength={2} maxLength={50} value={form.category} onChange={set("category")} />
              <FieldError message={fieldErrors.category} />
            </label>
            <label className="label">
              Location
              <input className="input mt-1 font-normal" required minLength={2} maxLength={200} value={form.location} onChange={set("location")} />
              <FieldError message={fieldErrors.location} />
            </label>
            <label className="label">
              Price per hour (₹)
              <input className="input mt-1 font-normal" type="number" required min="0.01" max="100000" step="0.01"
                value={form.pricePerHour} onChange={set("pricePerHour")} />
              <FieldError message={fieldErrors.pricePerHour} />
            </label>
            <label className="label">
              Security deposit (₹)
              <input className="input mt-1 font-normal" type="number" required min="0" max="50000" step="0.01"
                value={form.securityDeposit} onChange={set("securityDeposit")} />
              <FieldError message={fieldErrors.securityDeposit} />
            </label>
          </div>

          <label className="mt-1 flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.isAvailable}
              onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })} />
            <span>
              <span className="font-medium text-slate-900">Accepting bookings</span>
              <span className="block text-slate-500">
                Untick to pause the listing: it is hidden from search and nobody can send new requests. Existing bookings are not affected.
              </span>
            </span>
          </label>

          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy}>{saving ? "Saving…" : "Save changes"}</button>
            <Link to="/profile" className="btn-secondary">Cancel</Link>
          </div>
        </form>

        <ManageMedia item={item} onChange={(updated) => setItem({ ...item, ...updated })} />

        <div className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-800">Delete listing</h2>
          <p className="mt-1 text-sm text-red-700">
            The listing is removed from rentAny for good. You can't delete it while a booking is accepted, paid or in
            progress; complete or cancel those first, or pause the listing instead.
          </p>
          <button onClick={remove} disabled={busy} className="btn-danger btn-sm mt-3">
            {deleting ? "Deleting…" : "Delete this listing"}
          </button>
        </div>
      </div>
    </div>
  );
}
