import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import FieldError from "../components/FieldError.jsx";

// Must match the backend's upload limits (upload.middleware.js).
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export default function CreateItem() {
  const [form, setForm] = useState({
    title: "", description: "", category: "", pricePerHour: "", location: "",
  });
  const [image, setImage] = useState(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  function handleImageChange(e) {
    const file = e.target.files[0] || null;
    setFieldErrors((prev) => ({ ...prev, image: undefined }));
    if (file && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setFieldErrors((prev) => ({ ...prev, image: "Image must be a JPG, PNG or WEBP file" }));
      e.target.value = "";
      setImage(null);
      return;
    }
    if (file && file.size > MAX_IMAGE_SIZE) {
      setFieldErrors((prev) => ({ ...prev, image: "Image must be 5 MB or smaller" }));
      e.target.value = "";
      setImage(null);
      return;
    }
    setImage(file);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);

    const data = new FormData();
    Object.entries(form).forEach(([key, value]) => data.append(key, value));
    if (image) data.append("image", image);

    try {
      await api.post("/items", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      navigate("/");
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
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageChange} />
        <FieldError message={fieldErrors.image} />
        <button className="bg-slate-900 text-white py-2 rounded disabled:opacity-50" disabled={submitting}>
          {submitting ? "Listing item..." : "List item"}
        </button>
      </form>
    </div>
  );
}
