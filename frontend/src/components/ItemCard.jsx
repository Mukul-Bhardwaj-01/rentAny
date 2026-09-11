export default function ItemCard({ item }) {
  return (
    <div className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition">
      <img
        src={item.imageUrl || "https://placehold.co/400x250?text=No+Image"}
        alt={item.title}
        className="w-full h-40 object-cover"
      />
      <div className="p-3">
        <h3 className="font-semibold text-lg">{item.title}</h3>
        <p className="text-sm text-slate-500">{item.category} · {item.location}</p>
        <p className="mt-2 font-bold text-slate-800">₹{item.pricePerHour}/hr</p>
        <p className="text-xs text-slate-400 mt-1">Owner: {item.owner?.name}</p>
      </div>
    </div>
  );
}
