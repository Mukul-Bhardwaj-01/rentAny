import { Link } from "react-router-dom";
import ItemImage from "./ItemImage.jsx";
import { formatPrice } from "../utils/format.js";
import { RatingBadge } from "./StarRating.jsx";

export default function ItemCard({ item }) {
  return (
    <Link
      to={`/items/${item.id}`}
      className="card group block overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        <ItemImage
          src={item.imageUrl}
          alt={item.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-700 shadow-sm">
          {item.category}
        </span>
      </div>
      <div className="p-4">
        <h3 className="truncate font-semibold text-slate-900">{item.title}</h3>
        <p className="mt-0.5 truncate text-sm text-slate-500">📍 {item.location}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p>
            <span className="text-lg font-bold text-slate-900">₹{formatPrice(item.pricePerHour)}</span>
            <span className="text-sm text-slate-500"> / hour</span>
          </p>
          <RatingBadge sum={item.ratingSum} count={item.ratingCount} />
        </div>
        {item.owner?.name && <p className="mt-1 truncate text-xs text-slate-400">Listed by {item.owner.name}</p>}
      </div>
    </Link>
  );
}
