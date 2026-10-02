// Listing media rules. Must match the backend (upload.middleware.js);
// the server re-checks everything, these only give faster feedback.
const MB = 1024 * 1024;

export const MEDIA_LIMITS = {
  maxImages: 8,
  maxVideos: 2,
  maxTotal: 10,
  maxImageBytes: 5 * MB,
  maxVideoBytes: 50 * MB,
};

const TYPE_BY_MIME = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
};

export const MEDIA_ACCEPT = Object.keys(TYPE_BY_MIME).join(",");

export const mediaTypeOf = (file) => TYPE_BY_MIME[file.type] || null;

// Checks a selection of new files against the limits, counting media the
// listing already has. Returns an error message, or "" if it is fine.
export function checkMediaSelection(files, existing = []) {
  for (const f of files) {
    const type = mediaTypeOf(f);
    if (!type) return `"${f.name}" is not a JPG, PNG, WEBP, MP4 or WebM file`;
    if (type === "IMAGE" && f.size > MEDIA_LIMITS.maxImageBytes) return `"${f.name}" is larger than 5 MB`;
    if (type === "VIDEO" && f.size > MEDIA_LIMITS.maxVideoBytes) return `"${f.name}" is larger than 50 MB`;
  }
  const all = [...existing.map((m) => m.type), ...files.map(mediaTypeOf)];
  if (all.length > MEDIA_LIMITS.maxTotal) return `A listing can have at most ${MEDIA_LIMITS.maxTotal} photos and videos`;
  if (all.filter((t) => t === "IMAGE").length > MEDIA_LIMITS.maxImages) return `A listing can have at most ${MEDIA_LIMITS.maxImages} images`;
  if (all.filter((t) => t === "VIDEO").length > MEDIA_LIMITS.maxVideos) return `A listing can have at most ${MEDIA_LIMITS.maxVideos} videos`;
  return "";
}

// The media to show for an item. Listings from before multi-media support
// may only have `imageUrl`, so that becomes a one-image gallery.
export function mediaForItem(item) {
  if (item.media?.length) return item.media;
  if (item.imageUrl) return [{ id: "legacy", type: "IMAGE", url: item.imageUrl, sortOrder: 0 }];
  return [];
}
