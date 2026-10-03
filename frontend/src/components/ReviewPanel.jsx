import { useEffect, useState } from "react";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import { Stars, StarInput } from "./StarRating.jsx";
import FieldError from "./FieldError.jsx";
import { timeAgo } from "../utils/format.js";

function ReviewCard({ review, label }) {
  return (
    <div className="border rounded p-2">
      <p className="text-xs text-slate-500">{label}</p>
      <Stars average={review.rating} count={1} showCount={false} />
      {review.comment && <p className="text-sm mt-1 whitespace-pre-line">{review.comment}</p>}
      <p className="text-xs text-slate-400 mt-1">{review.author.name} · {timeAgo(review.createdAt)}</p>
    </div>
  );
}

// Reviews for one completed booking: the caller's review (or a form to write
// it) and the other side's review of them.
export default function ReviewPanel({ bookingId, onReviewed }) {
  const [data, setData] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setData((await api.get(`/bookings/${bookingId}/reviews`)).data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load reviews"));
    }
  }

  useEffect(() => {
    load();
  }, [bookingId]);

  async function submit(e) {
    e.preventDefault();
    if (!rating) {
      setFieldErrors({ rating: "Choose a rating from 1 to 5 stars" });
      return;
    }
    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      await api.post(`/bookings/${bookingId}/reviews`, { rating, comment });
      await load();
      onReviewed?.();
    } catch (err) {
      setError(getErrorMessage(err, "Could not save your review"));
      setFieldErrors(getFieldErrors(err));
      if (err.response?.status === 409) load();
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="text-sm text-slate-500 mt-2">{error || "Loading reviews…"}</p>;
  const other = data.role === "renter" ? "owner" : "renter";

  return (
    <div className="mt-3 border-t pt-3 text-sm space-y-2">
      {error && <p className="text-red-600">{error}</p>}

      {data.canReview ? (
        <form onSubmit={submit} className="space-y-2 max-w-md">
          <p className="font-medium">
            {data.role === "renter" ? "Rate the owner and the item" : "Rate the renter"}
          </p>
          <StarInput value={rating} onChange={setRating} disabled={saving} />
          <FieldError message={fieldErrors.rating} />
          <textarea
            className="border p-2 rounded w-full"
            placeholder="Write a review (optional)"
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <FieldError message={fieldErrors.comment} />
          <button disabled={saving} className="bg-slate-900 text-white px-4 py-1.5 rounded disabled:opacity-50">
            {saving ? "Submitting…" : "Submit review"}
          </button>
          <p className="text-xs text-slate-500">You can review each completed booking once.</p>
        </form>
      ) : (
        data.mine && <ReviewCard review={data.mine} label="Your review" />
      )}

      {data.theirs ? (
        <ReviewCard review={data.theirs} label={`The ${other}'s review of you`} />
      ) : (
        <p className="text-xs text-slate-500">The {other} hasn't reviewed you yet.</p>
      )}
    </div>
  );
}
