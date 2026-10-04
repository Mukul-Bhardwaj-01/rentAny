import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { getErrorMessage, getFieldErrors } from "../api/axios.js";
import FieldError from "../components/FieldError.jsx";
import MediaPicker from "../components/MediaPicker.jsx";
import { useDirectUpload } from "../hooks/useDirectUpload.js";

export default function CreateItem() {
  const [form, setForm] = useState({
    title: "", description: "", category: "", pricePerHour: "", location: "", securityDeposit: "0",
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
    <div className="card mx-4 my-8 p-6 sm:mx-auto sm:my-12 sm:max-w-2xl sm:p-8">
      <h2 className="page-title">List an item</h2>
      <p className="mt-1 mb-6 text-sm text-slate-500">Add clear photos and an honest description so renters know what to expect.</p>
      {error && <p className="alert-error mb-4">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input className="input" placeholder="Title" required minLength={3} maxLength={100}
          value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <FieldError message={fieldErrors.title} />
        <textarea className="input" placeholder="Description (min 10 characters)" required minLength={10} maxLength={2000}
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <FieldError message={fieldErrors.description} />
        <input className="input" placeholder="Category (e.g. Electronics)" required minLength={2} maxLength={50}
          value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <FieldError message={fieldErrors.category} />
        <input className="input" placeholder="Price per hour (₹)" type="number" required
          min="0.01" max="100000" step="0.01"
          value={form.pricePerHour} onChange={(e) => setForm({ ...form, pricePerHour: e.target.value })} />
        <FieldError message={fieldErrors.pricePerHour} />
        <input className="input" placeholder="Location" required minLength={2} maxLength={200}
          value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <FieldError message={fieldErrors.location} />
        <label className="label">
          Refundable security deposit (₹)
          <input className="input mt-1 font-normal" type="number" min="0" max="50000" step="0.01" required
            value={form.securityDeposit} onChange={(e) => setForm({ ...form, securityDeposit: e.target.value })} />
          <span className="block text-xs font-normal text-slate-500 mt-1">
            ₹0 to ₹50,000. Charged with the rental and refunded after return, minus any approved claims.
          </span>
        </label>
        <FieldError message={fieldErrors.securityDeposit} />
        <div>
          <p className="text-sm font-medium mb-1">Photos &amp; videos <span className="font-normal text-slate-500">(first photo is the cover)</span></p>
          <MediaPicker files={mediaFiles} onChange={setMediaFiles} disabled={submitting} statuses={statuses} />
        </div>
        <FieldError message={fieldErrors.media} />
        <button className="btn-primary w-full py-2.5" disabled={submitting}>
          {stage === "uploading" ? "Uploading media..." : submitting ? "Listing item..." : "List item"}
        </button>
      </form>
    </div>
  );
}
