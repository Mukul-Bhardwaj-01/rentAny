import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import api, { getErrorMessage } from "../api/axios.js";
import ItemImage from "../components/ItemImage.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import PaymentPanel from "../components/PaymentPanel.jsx";
import { LoadingState, EmptyState } from "../components/ui.jsx";
import ReviewPanel from "../components/ReviewPanel.jsx";
import { RatingBadge } from "../components/StarRating.jsx";
import { formatPrice, formatDateTime } from "../utils/format.js";

const STATUSES = ["PENDING", "ACCEPTED", "CONFIRMED", "ACTIVE", "COMPLETED", "REJECTED", "CANCELLED", "EXPIRED"];
// Must match HANDOVER_EARLY_MS in booking.controller.js.
const HANDOVER_EARLY_MS = 60 * 60 * 1000;
// Phone numbers are shared once the booking is paid.
const CONTACT_VISIBLE = ["CONFIRMED", "ACTIVE", "COMPLETED"];
// Bookings with something to show in the payment & deposit panel.
const HAS_PAYMENT_INFO = ["ACCEPTED", "CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"];

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
  // Booking id -> "open" | "pay" (open and start paying right away).
  const [panels, setPanels] = useState({});
  const [reviewsOpen, setReviewsOpen] = useState({});

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

  // Arriving from a notification about a booking opens its payment details.
  useEffect(() => {
    if (highlightId) setPanels((p) => ({ ...p, [highlightId]: p[highlightId] || "open" }));
  }, [highlightId]);

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

  const togglePanel = (id, mode = "open") => setPanels((p) => ({ ...p, [id]: p[id] && mode === "open" ? undefined : mode }));

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

  // Shows exactly what the cancellation would refund before confirming.
  async function handleCancel(booking) {
    let refundText = "";
    try {
      const p = (await api.get(`/bookings/${booking.id}/cancellation-preview`)).data;
      if (p.paid) {
        const r = p.refund;
        refundText =
          `\n\nRefund: ₹${formatPrice(r.total)} (rental ₹${formatPrice(r.rental)}, platform fee ₹${formatPrice(r.platformFee)}, ` +
          `deposit ₹${formatPrice(r.deposit)}).\n${p.explanation}`;
      }
    } catch {
      // The cancellation itself is still checked by the server.
    }
    if (as === "owner") {
      const reason = window.prompt(`Tell the renter why you are cancelling (required):${refundText}`);
      if (reason === null) return;
      if (!reason.trim()) {
        setError("A reason is required when the owner cancels.");
        return;
      }
      act(booking, "cancel", { reason }, "Booking cancelled.");
    } else {
      if (!window.confirm(`Cancel this booking?${refundText}`)) return;
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
    const btn = "btn btn-sm";
    const actions = [];

    if (as === "owner" && b.status === "PENDING") {
      actions.push(
        <button key="accept" disabled={busy} className={`${btn} bg-green-700 text-white`}
          onClick={() => act(b, "accept", {}, "Request accepted. The renter has 12 hours to pay.")}>
          Accept
        </button>,
        <button key="reject" disabled={busy} className={`${btn} bg-red-700 text-white`}
          onClick={() => handleReject(b)}>
          Reject
        </button>
      );
    }

    if (b.status === "ACCEPTED" && b.paymentDueAt) {
      if (as === "renter") {
        actions.push(
          <button key="pay" disabled={busy} className={`${btn} bg-slate-900 text-white`} onClick={() => setPanels((p) => ({ ...p, [b.id]: "pay" }))}>
            Pay ₹{formatPrice(b.totalPayable)}
          </button>,
          <span key="due" className="text-xs text-slate-500">by {formatDateTime(b.paymentDueAt)}</span>
        );
      } else {
        actions.push(
          <span key="awaiting" className="text-xs text-slate-500">Awaiting payment until {formatDateTime(b.paymentDueAt)}</span>
        );
      }
    }

    if (as === "owner" && b.status === "CONFIRMED") {
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
          onClick={() => act(b, "complete", {}, "Marked as returned. The deposit is held for 48 hours for any claims.")}>
          Mark returned
        </button>
      );
      if (now > end) actions.push(<span key="overdue" className="text-xs text-red-700">Overdue</span>);
    }

    const canCancel =
      now < start &&
      (as === "owner" ? ["ACCEPTED", "CONFIRMED"].includes(b.status) : ["PENDING", "ACCEPTED", "CONFIRMED"].includes(b.status));
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

    if (HAS_PAYMENT_INFO.includes(b.status)) {
      actions.push(
        <button key="payment" className="text-sm text-blue-600" onClick={() => togglePanel(b.id)}>
          {panels[b.id] ? "Hide payment & deposit" : "Payment & deposit"}
        </button>
      );
    }

    // Completed rentals can be reviewed once by each side.
    if (b.status === "COMPLETED") {
      const reviewed = b.reviews?.length > 0;
      actions.push(
        <button
          key="review"
          className={`${btn} ${reviewed || reviewsOpen[b.id] ? "border" : "bg-amber-500 text-white"}`}
          onClick={() => setReviewsOpen((r) => ({ ...r, [b.id]: !r[b.id] }))}
        >
          {reviewsOpen[b.id] ? "Hide reviews" : reviewed ? `Reviews (you gave ${b.reviews[0].rating}★)` : "Leave a review"}
        </button>
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
    <div className="page max-w-4xl">
      <h1 className="page-title mb-6">My bookings</h1>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex">
          {tab("renter", "My rentals")}
          {tab("owner", "Requests for my items")}
        </div>
        <select
          className="input mb-2 w-auto py-1.5"
          value={status}
          onChange={(e) => updateParams({ status: e.target.value })}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
          ))}
        </select>
      </div>

      {notice && <p className="alert-success mb-4">{notice}</p>}
      {error && <p className="alert-error mb-4">{error}</p>}

      {loading ? (
        <LoadingState label="Loading bookings…" />
      ) : bookings.length === 0 ? (
        as === "renter" ? (
          <EmptyState
            icon="🧾"
            title={status ? "No bookings with this status" : "No rentals yet"}
            message="When you request an item, it shows up here with its payment and status."
            action={<Link to="/" className="btn-primary">Browse items</Link>}
          />
        ) : (
          <EmptyState
            icon="📬"
            title={status ? "No requests with this status" : "No requests yet"}
            message="Requests from renters for your listings will appear here."
            action={<Link to="/create-item" className="btn-secondary">List an item</Link>}
          />
        )
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => (
            <li
              key={b.id}
              id={`booking-${b.id}`}
              className={`card flex flex-col gap-4 p-4 sm:flex-row ${b.id === highlightId ? "ring-2 ring-blue-500" : ""}`}
            >
              <ItemImage src={b.item.imageUrl} alt={b.item.title} className="h-40 w-full shrink-0 rounded-lg object-cover sm:h-24 sm:w-24" />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/items/${b.item.id}`} className="font-semibold text-slate-900 hover:underline">
                    {b.item.title}
                  </Link>
                  <StatusBadge status={b.status} />
                </div>
                <p className="text-sm text-slate-600">
                  {formatDateTime(b.startTime)} – {formatDateTime(b.endTime)} · {b.hours} hr
                </p>
                <p className="text-sm">
                  {as === "renter" ? (
                    <>₹{formatPrice(b.totalPayable)} <span className="text-slate-500">total</span></>
                  ) : (
                    <>₹{formatPrice(b.rentalAmount)} <span className="text-slate-500">rental</span></>
                  )}
                  {Number(b.securityDeposit) > 0 && (
                    <span className="text-slate-500"> · incl. ₹{formatPrice(b.securityDeposit)} refundable deposit</span>
                  )}
                  <span className="text-slate-500">
                    {" "}· {as === "owner" ? `Renter: ${b.renter.name}` : `Owner: ${b.owner.name}`}
                  </span>{" "}
                  {as === "owner" ? (
                    <RatingBadge sum={b.renter.renterRatingSum} count={b.renter.renterRatingCount} />
                  ) : (
                    <RatingBadge sum={b.owner.ownerRatingSum} count={b.owner.ownerRatingCount} />
                  )}
                </p>
                {b.renterNote && <p className="text-sm text-slate-500">Note: {b.renterNote}</p>}
                {b.responseNote && <p className="text-sm text-slate-500">Owner: {b.responseNote}</p>}
                {b.cancelReason && (
                  <p className="text-sm text-slate-500">
                    Cancelled by {b.cancelledBy === "OWNER" ? "owner" : "renter"}: {b.cancelReason}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">{renderActions(b)}</div>
                {panels[b.id] && (
                  <PaymentPanel
                    key={`${b.id}-${panels[b.id]}`}
                    bookingId={b.id}
                    autoPay={panels[b.id] === "pay"}
                    onChanged={() => fetchBookings({ silent: true })}
                  />
                )}
                {reviewsOpen[b.id] && <ReviewPanel bookingId={b.id} onReviewed={() => fetchBookings({ silent: true })} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
