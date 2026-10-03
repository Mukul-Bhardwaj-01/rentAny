import { useState } from "react";

// Average from the stored totals (sum / count), one decimal; null if unrated.
export function ratingOf(sum, count) {
  return count > 0 ? { average: Math.round((sum / count) * 10) / 10, count } : { average: null, count: 0 };
}

// Read-only stars, e.g. ★★★★☆ 4.5 (12). Shows "No ratings yet" when empty.
export function Stars({ average, count, size = "text-sm", showCount = true }) {
  if (!count) return <span className={`${size} text-slate-400`}>No ratings yet</span>;
  const rounded = Math.round(average);
  return (
    <span className={`${size} inline-flex items-center gap-1`} aria-label={`${average} out of 5 from ${count} review${count === 1 ? "" : "s"}`}>
      <span className="text-amber-500" aria-hidden="true">{"★".repeat(rounded)}<span className="text-slate-300">{"★".repeat(5 - rounded)}</span></span>
      <span className="text-slate-700">{average.toFixed(1)}</span>
      {showCount && <span className="text-slate-500">({count})</span>}
    </span>
  );
}

// Compact "★ 4.5 (3)" for lists; nothing when unrated.
export function RatingBadge({ sum, count }) {
  const { average } = ratingOf(sum, count);
  if (!count) return null;
  return <span className="text-xs text-slate-600" title={`${count} review${count === 1 ? "" : "s"}`}><span className="text-amber-500">★</span> {average.toFixed(1)} ({count})</span>;
}

// Clickable 1–5 star picker (keyboard: arrow keys / Tab between stars).
export function StarInput({ value, onChange, disabled }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div role="radiogroup" aria-label="Rating" className="inline-flex gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          disabled={disabled}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
          className={`text-2xl leading-none ${n <= shown ? "text-amber-500" : "text-slate-300"} disabled:opacity-50`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
