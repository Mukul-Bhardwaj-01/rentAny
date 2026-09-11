import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/axios.js";

export default function CreateItem() {
  const [form, setForm] = useState({
    title: "", description: "", category: "", pricePerHour: "", location: "",
  });
  const [image, setImage] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    if (image) data.append("image", image);

    try {
      await api.post("/items", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.message || "Could not create listing");
    }
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-6 border rounded-lg">
      <h2 className="text-2xl font-bold mb-4">List an item</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="border p-2 rounded" placeholder="Title" required
          value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <textarea className="border p-2 rounded" placeholder="Description" required
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input className="border p-2 rounded" placeholder="Category (e.g. Electronics)" required
          value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <input className="border p-2 rounded" placeholder="Price per hour (₹)" type="number" required
          value={form.pricePerHour} onChange={(e) => setForm({ ...form, pricePerHour: e.target.value })} />
        <input className="border p-2 rounded" placeholder="Location" required
          value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files[0])} />
        <button className="bg-slate-900 text-white py-2 rounded">List item</button>
      </form>
    </div>
  );
}
