import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";
import FieldError from "../components/FieldError.jsx";
import ItemImage from "../components/ItemImage.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { Stars, RatingBadge } from "../components/StarRating.jsx";
import { LoadingState, EmptyState, ErrorState } from "../components/ui.jsx";
import { formatPrice, formatDateTime } from "../utils/format.js";

// The user's dashboard: account details, their listings (edit, pause,
// delete) and every rental they have taken.
export default function Profile() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "rentals" ? "rentals" : "listings";

  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState("");
  const [notice, setNotice] = useState(location.state?.message || "");

  async function loadProfile() {
    setProfileError("");
    try {
      const res = await api.get("/auth/me");
      setProfile(res.data);
    } catch (err) {
      setProfileError(getErrorMessage(err, "Could not load your profile"));
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  if (profileError) return <div className="page-narrow"><ErrorState message={profileError} onRetry={loadProfile} /></div>;
  if (!profile) return <LoadingState label="Loading your profile…" />;

  const tabClass = (t) =>
    `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
      tab === t ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
    }`;

  return (
    <div className="page max-w-5xl">
      <h1 className="page-title mb-6">My profile</h1>
      {notice && <p className="alert-success mb-4">{notice}</p>}

      <AccountCard profile={profile} onSaved={(p) => setProfile({ ...profile, ...p })} />

      <div className="mt-8 mb-5 flex border-b border-slate-200">
        <button className={tabClass("listings")} onClick={() => setSearchParams({})}>
          My listings <span className="text-slate-400">({profile.stats.listings})</span>
        </button>
        <button className={tabClass("rentals")} onClick={() => setSearchParams({ tab: "rentals" })}>
          My rentals <span className="text-slate-400">({profile.stats.rentals})</span>
        </button>
      </div>

      {tab === "listings" ? (
        <MyListings
          onNotice={setNotice}
          onCountChange={(listings) => setProfile((p) => ({ ...p, stats: { ...p.stats, listings } }))}
        />
      ) : (
        <MyRentals />
      )}
    </div>
  );
}

function AccountCard({ profile, onSaved }) {
  const { updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: profile.name, phone: profile.phone || "" });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      const res = await api.patch("/auth/me", { name: form.name, phone: form.phone });
      onSaved(res.data);
      updateUser({ name: res.data.name, phone: res.data.phone });
      setEditing(false);
    } catch (err) {
      setError(getErrorMessage(err, "Could not save your details"));
      setFieldErrors(getFieldErrors(err));
    } finally {
      setSaving(false);
    }
  }

  const memberSince = new Date(profile.createdAt).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const { stats } = profile;

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-slate-900 text-2xl font-bold text-white">
          {profile.name?.[0]?.toUpperCase() || "?"}
        </div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={save} className="grid gap-3 sm:max-w-md">
              {error && <p className="alert-error">{error}</p>}
              <label className="label">
                Name
                <input className="input mt-1 font-normal" required minLength={2} maxLength={50}
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <FieldError message={fieldErrors.name} />
              <label className="label">
                Phone
                <input className="input mt-1 font-normal" type="tel" required maxLength={20}
                  value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Shared only with the other person once a booking is paid.
                </span>
              </label>
              <FieldError message={fieldErrors.phone} />
              <div className="flex gap-2">
                <button className="btn-primary btn-sm" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                <button type="button" className="btn-secondary btn-sm" disabled={saving}
                  onClick={() => { setEditing(false); setForm({ name: profile.name, phone: profile.phone || "" }); setFieldErrors({}); setError(""); }}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold text-slate-900">{profile.name}</h2>
                {profile.role === "ADMIN" && (
                  <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">Admin</span>
                )}
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
                <div><dt className="inline text-slate-400">Email: </dt><dd className="inline break-all">{profile.email}</dd></div>
                <div><dt className="inline text-slate-400">Phone: </dt><dd className="inline">{profile.phone || "Not added"}</dd></div>
                <div><dt className="inline text-slate-400">Member since: </dt><dd className="inline">{memberSince}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                <span className="flex items-center gap-1.5">As owner: <Stars {...profile.ownerRating} /></span>
                <span className="flex items-center gap-1.5">As renter: <Stars {...profile.renterRating} /></span>
              </div>
              <button onClick={() => setEditing(true)} className="btn-secondary btn-sm mt-4">Edit details</button>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:w-64">
          <Stat label="Live listings" value={stats.listings} />
          <Stat label="Times rented out" value={stats.completedAsOwner} />
          <Stat label="Rentals taken" value={stats.rentals} />
          <Stat label="Completed rentals" value={stats.completedRentals} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-center">
      <div className="text-xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function MyListings({ onNotice, onCountChange }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState({});
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setError("");
    try {
      const res = await api.get("/items/mine");
      setItems(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load your listings"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function togglePaused(item) {
    setBusyId(item.id);
    setActionError({});
    try {
      const res = await api.patch(`/items/${item.id}`, { isAvailable: !item.isAvailable });
      setItems((list) => list.map((i) => (i.id === item.id ? { ...i, isAvailable: res.data.isAvailable } : i)));
      onNotice(res.data.isAvailable ? `"${item.title}" is live again.` : `"${item.title}" is paused and hidden from search.`);
    } catch (err) {
      setActionError({ [item.id]: getErrorMessage(err, "Could not update the listing") });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item) {
    const pending = item.stats.pendingRequests;
    const warning = pending
      ? `\n\n${pending} open request${pending === 1 ? "" : "s"} will be declined and the renter${pending === 1 ? "" : "s"} notified.`
      : "";
    if (!window.confirm(`Delete "${item.title}"? It will be removed from rentAny. Past bookings and reviews are kept.${warning}`)) return;

    setBusyId(item.id);
    setActionError({});
    try {
      await api.delete(`/items/${item.id}`);
      const remaining = items.filter((i) => i.id !== item.id);
      setItems(remaining);
      onCountChange(remaining.length);
      onNotice(`"${item.title}" was deleted.`);
    } catch (err) {
      setActionError({ [item.id]: getErrorMessage(err, "Could not delete the listing") });
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!items) return <LoadingState label="Loading your listings…" />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon="📦"
        title="You haven't listed anything yet"
        message="List something you own and earn when others rent it by the hour."
        action={<Link to="/create-item" className="btn-primary">List an item</Link>}
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Link to="/create-item" className="btn-primary btn-sm">+ List another item</Link>
      </div>
      <ul className="grid gap-4">
        {items.map((item) => (
          <li key={item.id} className="card flex flex-col gap-4 p-4 sm:flex-row">
            <Link to={`/items/${item.id}`} className="shrink-0">
              <ItemImage src={item.imageUrl} alt={item.title}
                className={`h-40 w-full rounded-lg object-cover sm:h-28 sm:w-36 ${item.isAvailable ? "" : "opacity-60 grayscale"}`} />
            </Link>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/items/${item.id}`} className="font-semibold text-slate-900 hover:underline">{item.title}</Link>
                {item.isAvailable ? (
                  <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Live</span>
                ) : (
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">Paused</span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-slate-500">{item.category} · 📍 {item.location}</p>
              <p className="mt-1 text-sm">
                <span className="font-semibold text-slate-900">₹{formatPrice(item.pricePerHour)}</span>
                <span className="text-slate-500"> / hour</span>
                {Number(item.securityDeposit) > 0 && (
                  <span className="text-slate-500"> · deposit ₹{formatPrice(item.securityDeposit)}</span>
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>{item.stats.totalBookings} booking{item.stats.totalBookings === 1 ? "" : "s"}</span>
                {item.stats.pendingRequests > 0 && (
                  <Link to="/bookings?as=owner&status=PENDING" className="font-medium text-amber-700 hover:underline">
                    {item.stats.pendingRequests} request{item.stats.pendingRequests === 1 ? "" : "s"} waiting
                  </Link>
                )}
                {item.stats.upcomingOrActive > 0 && <span>{item.stats.upcomingOrActive} upcoming / in progress</span>}
                <span>{item.stats.completed} completed</span>
                <RatingBadge sum={item.ratingSum} count={item.ratingCount} />
              </div>
              {actionError[item.id] && <p className="alert-error mt-3 text-sm">{actionError[item.id]}</p>}
            </div>

            <div className="flex flex-wrap gap-2 sm:w-36 sm:flex-col">
              <Link to={`/items/${item.id}/edit`} className="btn-primary btn-sm text-center">Edit</Link>
              <button onClick={() => togglePaused(item)} disabled={busyId === item.id} className="btn-secondary btn-sm">
                {item.isAvailable ? "Pause" : "Resume"}
              </button>
              <button onClick={() => remove(item)} disabled={busyId === item.id} className="btn-danger btn-sm">
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function MyRentals() {
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const res = await api.get("/bookings", { params: { as: "renter" } });
      setBookings(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load your rentals"));
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!bookings) return <LoadingState label="Loading your rentals…" />;
  if (bookings.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="No rentals yet"
        message="Items you request and rent will show up here."
        action={<Link to="/" className="btn-primary">Browse items</Link>}
      />
    );
  }

  return (
    <ul className="grid gap-3">
      {bookings.map((b) => (
        <li key={b.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <ItemImage src={b.item.imageUrl} alt={b.item.title} className="h-32 w-full shrink-0 rounded-lg object-cover sm:h-16 sm:w-20" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">{b.item.title}</span>
              <StatusBadge status={b.status} />
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {formatDateTime(b.startTime)} → {formatDateTime(b.endTime)} · {b.hours} h · from {b.owner.name}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1">
            <span className="font-semibold text-slate-900">₹{formatPrice(b.totalPayable)}</span>
            <Link to={`/bookings?booking=${b.id}`} className="link text-sm">View booking</Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
