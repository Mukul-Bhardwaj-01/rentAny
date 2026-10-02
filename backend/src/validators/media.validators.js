import { MEDIA_LIMITS, MAX_BYTES, TYPE_BY_MIME } from "../utils/mediaRules.js";

// POST /api/media/signatures
// body: { itemId?: number, files: [{ mimeType, size }] }
// The declared type and size only decide which signature to issue and give
// early feedback; the real file is verified after upload.
export function signatureRequestValidator(input) {
  const values = {};
  const errors = {};

  if (input.itemId !== undefined && input.itemId !== null) {
    const id = Number(input.itemId);
    if (!/^\d+$/.test(String(input.itemId)) || !Number.isSafeInteger(id) || id <= 0) {
      errors.itemId = "itemId must be a positive whole number";
    } else values.itemId = id;
  }

  const files = input.files;
  if (!Array.isArray(files) || files.length === 0) {
    errors.files = "Choose at least one photo or video";
  } else if (files.length > MEDIA_LIMITS.maxTotal) {
    errors.files = `You can upload at most ${MEDIA_LIMITS.maxTotal} photos and videos`;
  } else {
    const types = [];
    for (const f of files) {
      const type = TYPE_BY_MIME[f?.mimeType];
      if (!type) {
        errors.files = "Only JPG, PNG and WEBP images and MP4 and WebM videos are allowed";
        break;
      }
      if (!Number.isSafeInteger(f.size) || f.size <= 0) {
        errors.files = "Each file needs a valid size";
        break;
      }
      if (f.size > MAX_BYTES[type]) {
        errors.files = type === "IMAGE" ? "Each image must be 5 MB or smaller" : "Each video must be 50 MB or smaller";
        break;
      }
      types.push(type);
    }
    if (!errors.files) values.types = types;
  }

  return { values, errors };
}
