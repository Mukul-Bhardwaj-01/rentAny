// Uploads listing photos/videos straight from the browser to Cloudinary,
// using one-time signatures issued by our backend (POST /media/signatures).
// No Cloudinary secret is ever in the frontend: each signature only allows
// uploading one file, as an id and format chosen by the server.
import { useCallback, useRef, useState } from "react";
import api, { getErrorMessage } from "../api/axios.js";

const PARALLEL_UPLOADS = 3;

// Plain XHR (not axios) so we get upload progress, and so our login token
// is never sent to Cloudinary.
function uploadToCloudinary(file, { uploadUrl, fields }, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON error page
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body?.error?.message || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.send(form);
  });
}

async function runLimited(tasks, limit) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) await tasks[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

// Tracks each File's upload: { status: "uploading" | "done" | "error", progress, publicId, error }.
export function useDirectUpload() {
  const [statuses, setStatuses] = useState(() => new Map());
  const ref = useRef(statuses); // always the latest, for use inside async code

  const setStatus = useCallback((file, patch) => {
    const next = new Map(ref.current);
    next.set(file, { ...(ref.current.get(file) || {}), ...patch });
    ref.current = next;
    setStatuses(next);
  }, []);

  const reset = useCallback(() => {
    ref.current = new Map();
    setStatuses(ref.current);
  }, []);

  // Uploads every file not already uploaded. `itemId` = existing listing, or
  // null for one being created. Resolves to { ok, publicIds, error } with
  // publicIds in the same order as `files` when everything succeeded.
  const uploadFiles = useCallback(
    async (files, itemId = null) => {
      const todo = files.filter((f) => ref.current.get(f)?.status !== "done");
      if (todo.length > 0) {
        let uploads;
        try {
          const res = await api.post("/media/signatures", {
            ...(itemId ? { itemId } : {}),
            files: todo.map((f) => ({ mimeType: f.type, size: f.size })),
          });
          uploads = res.data.uploads;
        } catch (err) {
          const error = getErrorMessage(err, "Could not prepare the upload");
          todo.forEach((f) => setStatus(f, { status: "error", progress: 0, error }));
          return { ok: false, error };
        }

        await runLimited(
          todo.map((file, i) => async () => {
            setStatus(file, { status: "uploading", progress: 0, error: null });
            try {
              await uploadToCloudinary(file, uploads[i], (progress) => setStatus(file, { progress }));
              setStatus(file, { status: "done", progress: 1, publicId: uploads[i].publicId });
            } catch (err) {
              setStatus(file, { status: "error", error: err.message });
            }
          }),
          PARALLEL_UPLOADS
        );
      }

      const failed = files.filter((f) => ref.current.get(f)?.status !== "done");
      if (failed.length > 0) {
        return { ok: false, error: `${failed.length} file(s) failed to upload. Remove them or try again.` };
      }
      return { ok: true, publicIds: files.map((f) => ref.current.get(f).publicId) };
    },
    [setStatus]
  );

  return { statuses, uploadFiles, reset };
}
