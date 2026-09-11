import { useEffect, useState } from "react";
import api from "../api/axios.js";
import ItemCard from "../components/ItemCard.jsx";

export default function Home() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function fetchItems(query = "") {
    setLoading(true);
    const res = await api.get("/items", { params: query ? { search: query } : {} });
    setItems(res.data);
    setLoading(false);
  }

  useEffect(() => {
    fetchItems();
  }, []);

  function handleSearch(e) {
    e.preventDefault();
    fetchItems(search);
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          className="border p-2 rounded flex-1"
          placeholder="Search items (e.g. projector, camera)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="bg-slate-900 text-white px-4 rounded">Search</button>
      </form>

      {loading ? (
        <p>Loading items...</p>
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
