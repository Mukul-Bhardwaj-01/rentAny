import { useEffect, useState } from "react";
import api, { getErrorMessage } from "../api/axios.js";
import { Stars } from "./StarRating.jsx";
import { timeAgo } from "../utils/format.js";

// Public reviews of an item by renters who completed a rental.
export default function ItemReviews({ itemId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get(`/items/${itemId}/reviews`)
      .then((res) => setData(res.data))
      .catch((err) => setError(getErrorMessage(err, "Could not load reviews")));
  }, [itemId]);

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-2">Reviews</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (
        <>
          <Stars average={data.summary.average} count={data.summary.count} size="text-base" />
          {data.reviews.length === 0 ? (
            <p className="text-sm text-slate-500 mt-2">Reviews appear here after completed rentals.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {data.reviews.map((r) => (
                <li key={r.id} className="border-b pb-3">
                  <Stars average={r.rating} count={1} showCount={false} />
                  {r.comment && <p className="text-sm mt-1 whitespace-pre-line">{r.comment}</p>}
                  <p className="text-xs text-slate-400 mt-1">{r.author.name} · {timeAgo(r.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
