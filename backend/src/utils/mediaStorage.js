// The only place that talks to Cloudinary about listing media.
// Kept as a plain object so tests can swap in a fake without network calls.
import cloudinary from "../config/cloudinary.js";

const FOLDER = "rentany_items";
const RESOURCE_TYPE = { IMAGE: "image", VIDEO: "video" };
// Cloudinary re-checks the real format and rejects anything else.
const ALLOWED_FORMATS = { IMAGE: ["jpg", "png", "webp"], VIDEO: ["mp4", "webm"] };

export const mediaStorage = {
  // Uploads a local file; returns { url, publicId }.
  async upload(filePath, type) {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: FOLDER,
      resource_type: RESOURCE_TYPE[type],
      allowed_formats: ALLOWED_FORMATS[type],
    });
    return { url: result.secure_url, publicId: result.public_id };
  },

  async destroy(publicId, type) {
    await cloudinary.uploader.destroy(publicId, { resource_type: RESOURCE_TYPE[type], invalidate: true });
  },
};

// Uploads every file, or none: if any upload fails, the ones that succeeded
// are deleted again and the error is rethrown.
export async function uploadAll(files) {
  const results = await Promise.allSettled(files.map((f) => mediaStorage.upload(f.path, f.type)));
  const uploaded = results.map((r, i) => (r.status === "fulfilled" ? { ...r.value, type: files[i].type } : null));
  const failure = results.find((r) => r.status === "rejected");
  if (failure) {
    await destroyAll(uploaded.filter(Boolean));
    console.error("Media upload failed:", failure.reason?.message || failure.reason);
    const err = new Error("Media upload failed");
    err.isUploadFailure = true;
    throw err;
  }
  return uploaded;
}

// Best-effort delete; failures are logged, never thrown, because this runs
// during cleanup after another error or after the database already changed.
export async function destroyAll(media) {
  await Promise.all(
    media
      .filter((m) => m.publicId)
      .map((m) =>
        mediaStorage.destroy(m.publicId, m.type).catch((err) => {
          console.error(`Failed to delete Cloudinary asset ${m.publicId}:`, err?.message || err);
        })
      )
  );
}
