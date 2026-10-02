// Display helpers shared across pages.

// Prices arrive as Decimal strings (e.g. "150.5"); show at most 2 decimals.
export function formatPrice(value) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// e.g. "Sat, 3 Oct, 2:00 pm" in the viewer's local timezone.
export function formatDateTime(value) {
  return new Date(value).toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

// e.g. "just now", "5 min ago", "3 h ago", "2 d ago", then a date.
export function timeAgo(value) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} d ago`;
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Converts a Date to the "YYYY-MM-DDTHH:mm" local format used by
// <input type="datetime-local">.
export function toDateTimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
