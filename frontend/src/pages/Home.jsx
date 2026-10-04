import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "../api/axios.js";
import ItemCard from "../components/ItemCard.jsx";

const NO_FILTERS = { category: "", minPrice: "", maxPrice: "", area: "", sort: "newest" };
const average = (i) => (i.ratingCount > 0 ? i.ratingSum / i.ratingCount : null);

// Category, price range and area filters plus sorting, applied in the browser
// to the listings already loaded (the server keeps handling text search).
function applyFilters(items, f) {
  const min = f.minPrice === "" ? null : Number(f.minPrice);
  const max = f.maxPrice === "" ? null : Number(f.maxPrice);
  const area = f.area.trim().toLowerCase();
  const list = items.filter((i) => {
    const price = Number(i.pricePerHour);
    if (f.category && i.category.toLowerCase() !== f.category) return false;
    if (min !== null && price < min) return false;
    if (max !== null && price > max) return false;
    if (area && !i.location.toLowerCase().includes(area)) return false;
    return true;
  });
  const byPrice = (a, b) => Number(a.pricePerHour) - Number(b.pricePerHour);
  if (f.sort === "price-asc") list.sort(byPrice);
  else if (f.sort === "price-desc") list.sort((a, b) => byPrice(b, a));
  else if (f.sort === "rating") {
    // Highest average first, more reviews breaking ties, unrated last.
    list.sort((a, b) => (average(b) ?? -1) - (average(a) ?? -1) || b.ratingCount - a.ratingCount);
  }
  return list; // "newest" keeps the server's order
}

export default function Home() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);

  // Categories present in the current results (case-insensitive, first spelling wins).
  const categories = useMemo(() => {
    const seen = new Map();
    for (const i of items) if (!seen.has(i.category.toLowerCase())) seen.set(i.category.toLowerCase(), i.category);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const visible = useMemo(() => applyFilters(items, filters), [items, filters]);
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const setFilter = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });

  async function fetchItems(query = "") {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/items", { params: query ? { search: query } : {} });
      setItems(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load items"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchItems();
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    fetchItems(search.trim());
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          className="border p-2 rounded flex-1"
          placeholder="Search items (e.g. projector, camera)"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="bg-slate-900 text-white px-4 rounded disabled:opacity-50" disabled={loading}>
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-end gap-3 mb-6 text-sm">
        <label className="flex flex-col">
          <span className="text-slate-500 text-xs">Sort by</span>
          <select className="border p-1.5 rounded" value={filters.sort} onChange={setFilter("sort")}>
            <option value="newest">Newest</option>
            <option value="price-asc">Price: low → high</option>
            <option value="price-desc">Price: high → low</option>
            <option value="rating">Rating</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-slate-500 text-xs">Category</span>
          <select className="border p-1.5 rounded" value={filters.category} onChange={setFilter("category")}>
            <option value="">All categories</option>
            {categories.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-slate-500 text-xs">Price ₹/hr</span>
          <span className="flex items-center gap-1">
            <input type="number" min="0" placeholder="Min" className="border p-1.5 rounded w-20"
              value={filters.minPrice} onChange={setFilter("minPrice")} aria-label="Minimum price per hour" />
            <span className="text-slate-400">–</span>
            <input type="number" min="0" placeholder="Max" className="border p-1.5 rounded w-20"
              value={filters.maxPrice} onChange={setFilter("maxPrice")} aria-label="Maximum price per hour" />
          </span>
        </label>
        <label className="flex flex-col">
          <span className="text-slate-500 text-xs">Area</span>
          <input placeholder="e.g. Sector 17, Mohali" className="border p-1.5 rounded w-44"
            maxLength={100} value={filters.area} onChange={setFilter("area")} />
        </label>
        {filtersActive && (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="text-blue-600 pb-1.5">
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <p>Loading items...</p>
      ) : error ? (
        <div className="text-red-600">
          <p>{error}</p>
          <button onClick={() => fetchItems(search.trim())} className="mt-2 underline">
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-slate-500">No items found. Be the first to list one!</p>
      ) : visible.length === 0 ? (
        <p className="text-slate-500">
          No listings match these filters.{" "}
          <button onClick={() => setFilters(NO_FILTERS)} className="text-blue-600">Clear filters</button>
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {visible.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
