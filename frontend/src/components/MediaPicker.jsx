import { useEffect, useMemo, useRef, useState } from "react";
import { MEDIA_ACCEPT, MEDIA_LIMITS, checkMediaSelection, mediaTypeOf } from "../utils/media.js";

// Lets the user pick several photos/videos (in one go or several), preview
// them and remove any before uploading. `existing` is the media the listing
// already has, so limits account for it.
export default function MediaPicker({ files, onChange, existing = [], disabled }) {
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  // Object URLs for previews, released when the selection changes.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  function handlePick(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // allow picking the same file again later
    if (picked.length === 0) return;
    const next = [...files, ...picked];
    const problem = checkMediaSelection(next, existing);
    setError(problem);
    if (!problem) onChange(next);
  }

  function removeAt(index) {
    setError("");
    onChange(files.filter((_, i) => i !== index));
  }

  const used = existing.length + files.length;

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || used >= MEDIA_LIMITS.maxTotal}
          className="border rounded px-3 py-1 text-sm disabled:opacity-50"
        >
          + Add photos/videos
        </button>
        <span className="text-xs text-slate-500">
          {used}/{MEDIA_LIMITS.maxTotal} · up to {MEDIA_LIMITS.maxImages} images (5 MB each) and{" "}
          {MEDIA_LIMITS.maxVideos} videos (50 MB each)
        </span>
        <input ref={inputRef} type="file" multiple accept={MEDIA_ACCEPT} onChange={handlePick} className="hidden" />
      </div>
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}

      {files.length > 0 && (
        <ul className="grid grid-cols-4 gap-2 mt-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="relative">
              {mediaTypeOf(f) === "VIDEO" ? (
                <video src={previews[i]} className="w-full h-20 object-cover rounded bg-black" muted />
              ) : (
                <img src={previews[i]} alt={f.name} className="w-full h-20 object-cover rounded" />
              )}
              {mediaTypeOf(f) === "VIDEO" && (
                <span className="absolute bottom-1 left-1 text-[10px] bg-black/70 text-white px-1 rounded">VIDEO</span>
              )}
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={disabled}
                className="absolute top-1 right-1 bg-black/70 text-white rounded-full w-5 h-5 text-xs leading-5"
                aria-label={`Remove ${f.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
