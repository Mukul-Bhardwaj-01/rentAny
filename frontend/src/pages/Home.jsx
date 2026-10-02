import { useEffect, useState } from "react";
import api, { getErrorMessage } from "../api/axios.js";
import ItemCard from "../components/ItemCard.jsx";

export default function Home() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
