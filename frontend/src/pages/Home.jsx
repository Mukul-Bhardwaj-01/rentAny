import { useEffect, useMemo, useState } from "react";
import api, { getErrorMessage } from "../api/axios.js";
import { Link } from "react-router-dom";
import ItemCard from "../components/ItemCard.jsx";
import { SkeletonGrid, EmptyState, ErrorState } from "../components/ui.jsx";

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
    <div className="page">
      <header className="mb-6">
        <h1 className="page-title">Rent anything, by the hour</h1>
        <p className="mt-1 text-slate-500">Speakers, cameras, projectors and more — from people near you.</p>
      </header>

      <div className="card mb-8 p-4 sm:p-5">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Search items (e.g. projector, camera)"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-primary" disabled={loading}>
          Search
        </button>
      </form>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:flex sm:flex-wrap sm:items-end">
        <label className="flex flex-col">
          <span className="text-slate-500 text-xs">Sort by</span>
          <select className="input py-1.5" value={filters.sort} onChange={setFilter("sort")}>
            <option value="newest">Newest</option>
            <option value="price-asc">Price: low → high</option>
            <option value="price-desc">Price: high → low</option>
            <option value="rating">Rating</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-slate-500 text-xs">Category</span>
          <select className="input py-1.5" value={filters.category} onChange={setFilter("category")}>
            <option value="">All categories</option>
            {categories.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex flex-col sm:col-span-1">
          <span className="text-slate-500 text-xs">Price ₹/hr</span>
          <span className="flex items-center gap-1">
            <input type="number" min="0" placeholder="Min" className="input py-1.5 sm:w-24"
              value={filters.minPrice} onChange={setFilter("minPrice")} aria-label="Minimum price per hour" />
            <span className="text-slate-400">–</span>
            <input type="number" min="0" placeholder="Max" className="input py-1.5 sm:w-24"
              value={filters.maxPrice} onChange={setFilter("maxPrice")} aria-label="Maximum price per hour" />
          </span>
        </label>
        <label className="col-span-2 flex flex-col sm:col-span-1">
          <span className="text-slate-500 text-xs">Area</span>
          <input placeholder="e.g. Sector 17, Mohali" className="input py-1.5 sm:w-48"
            maxLength={100} value={filters.area} onChange={setFilter("area")} />
        </label>
        {filtersActive && (
          <button type="button" onClick={() => setFilters(NO_FILTERS)} className="link col-span-2 pb-1.5 text-left text-sm sm:col-span-1">
            Clear filters
          </button>
        )}
      </div>
      </div>

      {loading ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchItems(search.trim())} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={search.trim() ? "No matching items" : "No listings yet"}
          message={search.trim() ? "Try a different search word." : "Be the first to list something people can rent."}
          action={<Link to="/create-item" className="btn-primary">List an item</Link>}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="🎛️"
          title="No listings match these filters"
          message="Try widening the price range or picking another category."
          action={<button onClick={() => setFilters(NO_FILTERS)} className="btn-secondary">Clear filters</button>}
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            {visible.length} listing{visible.length === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
