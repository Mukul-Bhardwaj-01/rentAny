// The only place that talks to Cloudinary about listing media.
// Kept as a plain object so tests can swap in a fake without network calls.
import cloudinary from "../config/cloudinary.js";
import { ALLOWED_FORMATS, RESOURCE_TYPE, MEDIA_FOLDER } from "./mediaRules.js";

export const mediaStorage = {
  // Signed parameters that let a browser upload ONE file straight to
  // Cloudinary, as exactly `publicId`, with only the given type's formats.
  // Every parameter sent with the upload must be in this signature, so the
  // browser can't change the id, folder, formats or add options of its own.
  // Cloudinary rejects the signature once the timestamp is over an hour old.
  signUpload(publicId, type) {
    const params = {
      public_id: publicId,
      allowed_formats: ALLOWED_FORMATS[type].join(","),
      overwrite: false, // the id can't be reused to replace an existing asset
      timestamp: Math.floor(Date.now() / 1000),
    };
    const { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret } = cloudinary.config();
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${RESOURCE_TYPE[type]}/upload`,
      // api_key is public by design; the secret never leaves the server.
      fields: { ...params, api_key: apiKey, signature: cloudinary.utils.api_sign_request(params, apiSecret) },
    };
  },

  // What Cloudinary itself recorded about an uploaded asset (after parsing
  // the file), or null if there is no such asset of that resource type.
  async inspect(publicId, type) {
    try {
      const r = await cloudinary.api.resource(publicId, { resource_type: RESOURCE_TYPE[type] });
      return { publicId: r.public_id, resourceType: r.resource_type, deliveryType: r.type, format: r.format, bytes: r.bytes, url: r.secure_url };
    } catch (err) {
      if (err?.error?.http_code === 404) return null;
      throw err;
    }
  },

  // Legacy multipart path only: uploads a local file; returns { url, publicId }.
  async upload(filePath, type) {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: MEDIA_FOLDER,
      resource_type: RESOURCE_TYPE[type],
      allowed_formats: ALLOWED_FORMATS[type],
    });
    return { url: result.secure_url, publicId: result.public_id };
  },

  async destroy(publicId, type) {
    if (type === "RAW") {
      // Cloudinary keeps the file extension in raw files' public ids
      // ("…_abc.png"), so delete by prefix to catch any extension. Our ids
      // end in 24 random hex chars, so the prefix matches nothing else.
      await cloudinary.api.delete_resources_by_prefix(publicId, { resource_type: RESOURCE_TYPE.RAW });
      return;
    }
    await cloudinary.uploader.destroy(publicId, { resource_type: RESOURCE_TYPE[type], invalidate: true });
  },
};

// Uploads every file, or none: if any upload fails, the ones that succeeded
// are deleted again and the error is rethrown. (Legacy multipart path.)
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
