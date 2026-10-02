import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import FieldError from "../components/FieldError.jsx";
import MediaPicker from "../components/MediaPicker.jsx";

export default function CreateItem() {
  const [form, setForm] = useState({
    title: "", description: "", category: "", pricePerHour: "", location: "",
  });
  const [mediaFiles, setMediaFiles] = useState([]);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);

    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    // Sent in the order shown; the first photo becomes the cover.
    mediaFiles.forEach((file) => data.append("media", file));

    try {
      const res = await api.post("/items", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      navigate(`/items/${res.data.id}`);
    } catch (err) {
      setError(getErrorMessage(err, "Could not create listing"));
      setFieldErrors(getFieldErrors(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-6 border rounded-lg">
      <h2 className="text-2xl font-bold mb-4">List an item</h2>
      {error && <p className="text-red-600 mb-3">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="border p-2 rounded" placeholder="Title" required minLength={3} maxLength={100}
          value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <FieldError message={fieldErrors.title} />
        <textarea className="border p-2 rounded" placeholder="Description (min 10 characters)" required minLength={10} maxLength={2000}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <FieldError message={fieldErrors.description} />
        <input className="border p-2 rounded" placeholder="Category (e.g. Electronics)" required minLength={2} maxLength={50}
          value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <FieldError message={fieldErrors.category} />
        <input className="border p-2 rounded" placeholder="Price per hour (₹)" type="number" required
          min="0.01" max="100000" step="0.01"
          value={form.pricePerHour} onChange={(e) => setForm({ ...form, pricePerHour: e.target.value })} />
        <FieldError message={fieldErrors.pricePerHour} />
        <input className="border p-2 rounded" placeholder="Location" required minLength={2} maxLength={200}
          value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <FieldError message={fieldErrors.location} />
        <div>
          <p className="text-sm font-medium mb-1">Photos &amp; videos <span className="font-normal text-slate-500">(first photo is the cover)</span></p>
          <MediaPicker files={mediaFiles} onChange={setMediaFiles} disabled={submitting} />
        </div>
        <FieldError message={fieldErrors.media} />
        <button className="bg-slate-900 text-white py-2 rounded disabled:opacity-50" disabled={submitting}>
          {submitting ? (mediaFiles.length ? "Uploading media..." : "Listing item...") : "List item"}
        </button>
      </form>
    </div>
  );
}
