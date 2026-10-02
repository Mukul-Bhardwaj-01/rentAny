import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import api, { getErrorMessage } from "../api/axios.js";
import ItemImage from "../components/ItemImage.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { formatPrice, formatDateTime } from "../utils/format.js";

const STATUSES = ["PENDING", "ACCEPTED", "ACTIVE", "COMPLETED", "REJECTED", "CANCELLED", "EXPIRED"];
// Must match HANDOVER_EARLY_MS in booking.controller.js.
const HANDOVER_EARLY_MS = 60 * 60 * 1000;
const CONTACT_VISIBLE = ["ACCEPTED", "ACTIVE", "COMPLETED"];

export default function MyBookings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const as = searchParams.get("as") === "owner" ? "owner" : "renter";
  const status = searchParams.get("status") || "";
  // Set when arriving from a notification: that booking is scrolled to and outlined.
  const highlightId = Number(searchParams.get("booking")) || null;
  const location = useLocation();

  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(location.state?.message || "");
  const [actingId, setActingId] = useState(null);
  const [contacts, setContacts] = useState({});

  // `silent` refreshes the list in place without the loading state.
  async function fetchBookings({ silent = false } = {}) {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const res = await api.get("/bookings", { params: { as, ...(status ? { status } : {}) } });
      setBookings(res.data);
    } catch (err) {
      if (!silent) setError(getErrorMessage(err, "Could not load bookings"));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    fetchBookings();
  }, [as, status, highlightId]);

  // A new notification usually means one of these bookings changed.
  useEffect(() => {
    const onNew = () => fetchBookings({ silent: true });
    window.addEventListener("notifications:new", onNew);
    return () => window.removeEventListener("notifications:new", onNew);
  }, [as, status]);

  useEffect(() => {
    if (!loading && highlightId) {
      document.getElementById(`booking-${highlightId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading, highlightId]);

  function updateParams(changes) {
    const next = { as, status, ...changes };
    if (!next.status) delete next.status;
    setSearchParams(next);
    setNotice("");
  }

  // Runs a status change (accept/reject/cancel/start/complete) and reloads the list.
  async function act(booking, action, body, successMessage) {
    setActingId(booking.id);
    setNotice("");
    setError("");
    try {
      const res = await api.patch(`/bookings/${booking.id}/${action}`, body);
      const late = res.data.lateByMinutes > 0 ? ` (returned ${res.data.lateByMinutes} min late)` : "";
      setNotice(successMessage + late);
      await fetchBookings();
    } catch (err) {
      setError(getErrorMessage(err, "Action failed"));
      // Someone else may have changed it; show the latest state.
      if (err.response?.status === 409) fetchBookings();
    } finally {
      setActingId(null);
    }
  }

  function handleReject(booking) {
    const reason = window.prompt("Reason for rejecting (optional):");
    if (reason === null) return;
    act(booking, "reject", { reason }, "Request rejected.");
  }

  function handleCancel(booking) {
    if (as === "owner") {
      const reason = window.prompt("Tell the renter why you are cancelling (required):");
      if (reason === null) return;
      if (!reason.trim()) {
        setError("A reason is required when the owner cancels.");
        return;
      }
      act(booking, "cancel", { reason }, "Booking cancelled.");
    } else {
      if (!window.confirm("Cancel this booking?")) return;
      act(booking, "cancel", {}, "Booking cancelled.");
    }
  }

  async function showContact(booking) {
    try {
      const res = await api.get(`/bookings/${booking.id}`);
      const other = as === "owner" ? res.data.renter : res.data.owner;
      setContacts({ ...contacts, [booking.id]: other.phone || "No phone number provided" });
    } catch (err) {
      setError(getErrorMessage(err, "Could not load contact details"));
    }
  }

  function renderActions(b) {
    const now = Date.now();
    const start = new Date(b.startTime).getTime();
    const end = new Date(b.endTime).getTime();
    const busy = actingId === b.id;
    const btn = "px-3 py-1 rounded text-sm disabled:opacity-50";
    const actions = [];

    if (as === "owner" && b.status === "PENDING") {
      actions.push(
        <button key="accept" disabled={busy} className={`${btn} bg-green-700 text-white`}
          onClick={() => act(b, "accept", {}, "Request accepted. Overlapping requests were declined.")}>
          Accept
        </button>,
        <button key="reject" disabled={busy} className={`${btn} bg-red-700 text-white`}
          onClick={() => handleReject(b)}>
          Reject
        </button>
      );
    }

    if (as === "owner" && b.status === "ACCEPTED") {
      if (now >= start - HANDOVER_EARLY_MS && now < end) {
        actions.push(
          <button key="start" disabled={busy} className={`${btn} bg-slate-900 text-white`}
            onClick={() => act(b, "start", {}, "Marked as handed over.")}>
            Mark handed over
          </button>
        );
      } else if (now < start) {
        actions.push(
          <span key="start-hint" className="text-xs text-slate-500">
            Handover opens {formatDateTime(start - HANDOVER_EARLY_MS)}
          </span>
        );
      } else {
        actions.push(<span key="no-show" className="text-xs text-amber-700">Not picked up</span>);
      }
    }

    if (as === "owner" && b.status === "ACTIVE") {
      actions.push(
        <button key="complete" disabled={busy} className={`${btn} bg-slate-900 text-white`}
          onClick={() => act(b, "complete", {}, "Marked as returned.")}>
          Mark returned
        </button>
      );
      if (now > end) actions.push(<span key="overdue" className="text-xs text-red-700">Overdue</span>);
    }

    const canCancel =
      now < start &&
      (as === "owner" ? b.status === "ACCEPTED" : ["PENDING", "ACCEPTED"].includes(b.status));
    if (canCancel) {
      actions.push(
        <button key="cancel" disabled={busy} className={`${btn} border`} onClick={() => handleCancel(b)}>
          Cancel
        </button>
      );
    }

    if (CONTACT_VISIBLE.includes(b.status)) {
      actions.push(
        contacts[b.id] ? (
          <span key="contact" className="text-sm">📞 {contacts[b.id]}</span>
        ) : (
          <button key="contact" className="text-sm text-blue-600" onClick={() => showContact(b)}>
            Show contact
          </button>
        )
      );
    }

    return actions;
  }

  const tab = (value, label) => (
    <button
      onClick={() => updateParams({ as: value })}
      className={`px-4 py-2 border-b-2 ${as === value ? "border-slate-900 font-semibold" : "border-transparent text-slate-500"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">My bookings</h1>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b mb-4">
        <div className="flex">
          {tab("renter", "My rentals")}
          {tab("owner", "Requests for my items")}
        </div>
        <select
          className="border p-1 rounded text-sm mb-2"
          value={status}
          onChange={(e) => updateParams({ status: e.target.value })}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </div>

      {notice && <p className="mb-3 text-green-700">{notice}</p>}
      {error && <p className="mb-3 text-red-600">{error}</p>}

      {loading ? (
        <p>Loading bookings...</p>
      ) : bookings.length === 0 ? (
        <p className="text-slate-500">
          {as === "renter" ? (
            <>No bookings yet. <Link to="/" className="text-blue-600">Browse items</Link></>
          ) : (
            "No requests for your items yet."
          )}
        </p>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => (
            <li
              key={b.id}
              id={`booking-${b.id}`}
              className={`border rounded-lg p-3 flex gap-3 ${b.id === highlightId ? "ring-2 ring-blue-500" : ""}`}
            >
              <ItemImage src={b.item.imageUrl} alt={b.item.title} className="w-24 h-24 object-cover rounded" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/items/${b.item.id}`} className="font-semibold hover:underline">
                    {b.item.title}
                  </Link>
                  <StatusBadge status={b.status} />
                </div>
                <p className="text-sm text-slate-600">
                  {formatDateTime(b.startTime)} – {formatDateTime(b.endTime)} · {b.hours} hr
                </p>
                <p className="text-sm">
                  ₹{formatPrice(b.rentalAmount)}{" "}
                  <span className="text-slate-500">
                    · {as === "owner" ? `Renter: ${b.renter.name}` : `Owner: ${b.owner.name}`}
                  </span>
                </p>
                {b.renterNote && <p className="text-sm text-slate-500">Note: {b.renterNote}</p>}
                {b.responseNote && <p className="text-sm text-slate-500">Owner: {b.responseNote}</p>}
                {b.cancelReason && (
                  <p className="text-sm text-slate-500">
                    Cancelled by {b.cancelledBy === "OWNER" ? "owner" : "renter"}: {b.cancelReason}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">{renderActions(b)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
