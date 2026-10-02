const PLACEHOLDER = "https://placehold.co/400x250?text=No+Image";

// Prices arrive as Decimal strings (e.g. "150.5"); show at most 2 decimals.
function formatPrice(value) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function ItemCard({ item }) {
  return (
    <div className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition">
      <img
        src={item.imageUrl || PLACEHOLDER}
        alt={item.title}
        className="w-full h-40 object-cover"
        onError={(e) => {
          // Fall back once if the stored image URL is broken.
          if (e.currentTarget.src !== PLACEHOLDER) e.currentTarget.src = PLACEHOLDER;
        }}
      />
      <div className="p-3">
        <h3 className="font-semibold text-lg">{item.title}</h3>
        <p className="text-sm text-slate-500">{item.category} · {item.location}</p>
        <p className="mt-2 font-bold text-slate-800">₹{formatPrice(item.pricePerHour)}/hr</p>
        <p className="text-xs text-slate-400 mt-1">Owner: {item.owner?.name}</p>
      </div>
    </div>
  );
}
