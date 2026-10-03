import { Link } from "react-router-dom";
import ItemImage from "./ItemImage.jsx";
import { formatPrice } from "../utils/format.js";
import { RatingBadge } from "./StarRating.jsx";

export default function ItemCard({ item }) {
  return (
    <Link
      to={`/items/${item.id}`}
      className="block border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition"
    >
      <ItemImage src={item.imageUrl} alt={item.title} className="w-full h-40 object-cover" />
      <div className="p-3">
        <h3 className="font-semibold text-lg">{item.title}</h3>
        <p className="text-sm text-slate-500">{item.category} · {item.location}</p>
        <p className="mt-2 flex items-center justify-between gap-2">
          <span className="font-bold text-slate-800">₹{formatPrice(item.pricePerHour)}/hr</span>
          <RatingBadge sum={item.ratingSum} count={item.ratingCount} />
        </p>
        <p className="text-xs text-slate-400 mt-1">Owner: {item.owner?.name}</p>
      </div>
    </Link>
  );
}
