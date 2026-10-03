const STYLES = {
  PENDING: "bg-amber-100 text-amber-800",
  ACCEPTED: "bg-blue-100 text-blue-800",
  CONFIRMED: "bg-teal-100 text-teal-800",
  ACTIVE: "bg-indigo-100 text-indigo-800",
  COMPLETED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  CANCELLED: "bg-slate-200 text-slate-700",
  EXPIRED: "bg-slate-200 text-slate-700",
};

const LABELS = {
  PENDING: "Pending",
  ACCEPTED: "Awaiting payment",
  CONFIRMED: "Paid · confirmed",
  ACTIVE: "In progress",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export default function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-1 rounded ${STYLES[status] || ""}`}>
      {LABELS[status] || status}
    </span>
  );
}
