import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import FieldError from "../components/FieldError.jsx";
import MediaPicker from "../components/MediaPicker.jsx";
import { useDirectUpload } from "../hooks/useDirectUpload.js";

export default function CreateItem() {
  const [form, setForm] = useState({
    title: "", description: "", category: "", pricePerHour: "", location: "",
  });
  const [mediaFiles, setMediaFiles] = useState([]);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState("");
  const { statuses, uploadFiles, reset } = useDirectUpload();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setSubmitting(true);

    try {
      // 1. Files go straight to Cloudinary (already-uploaded ones are skipped
      //    on a retry). 2. The listing is created with the uploaded ids, in
      //    the order shown; the first photo becomes the cover.
      setStage("uploading");
      const upload = await uploadFiles(mediaFiles);
      if (!upload.ok) {
        setError(upload.error);
        return;
      }
      setStage("saving");
      const res = await api.post("/items", { ...form, media: upload.publicIds });
      navigate(`/items/${res.data.id}`);
    } catch (err) {
      setError(getErrorMessage(err, "Could not create listing"));
      const errors = getFieldErrors(err);
      setFieldErrors(errors);
      // The server refused the uploaded files themselves (e.g. expired or
      // rejected): upload them again on the next try.
      if (errors.media) reset();
    } finally {
      setSubmitting(false);
      setStage("");
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
          <MediaPicker files={mediaFiles} onChange={setMediaFiles} disabled={submitting} statuses={statuses} />
        </div>
        <FieldError message={fieldErrors.media} />
        <button className="bg-slate-900 text-white py-2 rounded disabled:opacity-50" disabled={submitting}>
          {stage === "uploading" ? "Uploading media..." : submitting ? "Listing item..." : "List item"}
        </button>
      </form>
    </div>
  );
}
