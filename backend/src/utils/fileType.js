// Identifies a media file from its first bytes ("magic numbers"), so the
// declared MIME type / file extension from the client is never trusted alone.
import { open } from "node:fs/promises";

// MP4 "major brands" we accept. QuickTime ("qt  "), HEIC/AVIF images and
// other ISO-BMFF variants also start with "ftyp" and are rejected.
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VP", "dash", "mmp4", "MSNV"]);

function detect(buf) {
  const ascii = (start, end) => buf.toString("latin1", start, end);

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && MP4_BRANDS.has(ascii(8, 12))) return "video/mp4";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
  return null;
}

// Returns the detected MIME type of the file at `path`, or null if it is
// not one of the supported formats.
export async function detectMediaType(path) {
  const handle = await open(path, "r");
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buf, 0, 16, 0);
    return bytesRead >= 12 ? detect(buf) : null;
  } finally {
    await handle.close();
  }
}
