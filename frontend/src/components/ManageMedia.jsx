import { useState } from "react";
import api, { getErrorMessage } from "../api/axios.js";
import ItemImage from "./ItemImage.jsx";
import MediaPicker from "./MediaPicker.jsx";

// Owner-only panel on the item page: remove existing photos/videos and add
// new ones. `onChange` receives the updated { media, imageUrl }.
export default function ManageMedia({ item, onChange }) {
  const [newFiles, setNewFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const media = item.media || [];

  async function upload() {
    setBusy(true);
    setError("");
    const data = new FormData();
    newFiles.forEach((f) => data.append("media", f));
    try {
      const res = await api.post(`/items/${item.id}/media`, data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onChange(res.data);
      setNewFiles([]);
    } catch (err) {
      setError(getErrorMessage(err, "Could not upload media"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(m) {
    if (!window.confirm(`Remove this ${m.type === "VIDEO" ? "video" : "photo"} from the listing?`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.delete(`/items/${item.id}/media/${m.id}`);
      onChange(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not remove media"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg p-4 mt-6">
      <h3 className="font-semibold mb-2">Manage photos &amp; videos</h3>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {media.length === 0 ? (
        <p className="text-sm text-slate-500 mb-2">This listing has no photos or videos yet.</p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 mb-3">
          {media.map((m, i) => (
            <li key={m.id} className="relative">
              {m.type === "VIDEO" ? (
                <video src={m.url} preload="metadata" muted className="w-full h-20 object-cover rounded bg-black" />
              ) : (
                <ItemImage src={m.url} alt="" className="w-full h-20 object-cover rounded" />
              )}
              {i === media.findIndex((x) => x.type === "IMAGE") && (
                <span className="absolute bottom-1 left-1 text-[10px] bg-black/70 text-white px-1 rounded">COVER</span>
              )}
              {m.type === "VIDEO" && (
                <span className="absolute bottom-1 left-1 text-[10px] bg-black/70 text-white px-1 rounded">VIDEO</span>
              )}
              <button
                type="button"
                onClick={() => remove(m)}
                disabled={busy}
                className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-5 h-5 text-xs leading-5 disabled:opacity-50"
                aria-label="Remove"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <MediaPicker files={newFiles} onChange={setNewFiles} existing={media} disabled={busy} />
      {newFiles.length > 0 && (
        <button
          type="button"
          onClick={upload}
          disabled={busy}
          className="mt-3 bg-slate-900 text-white px-4 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {busy ? "Uploading..." : `Upload ${newFiles.length} file${newFiles.length === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
