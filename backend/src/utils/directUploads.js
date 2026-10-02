// Signed direct-to-Cloudinary uploads for listing media.
//
// 1. issueUploads: the server decides the exact public id, resource type and
//    formats for each file, records a MediaUpload "ticket" and signs it.
// 2. The browser uploads each file straight to Cloudinary with that signature.
// 3. verifyUploads: when the browser asks to attach public ids to a listing,
//    every id must be a ticket issued to this user for this listing, and
//    Cloudinary is asked what it really stored (type, format, size).
// 4. consumeUploads (inside the listing's transaction) deletes the tickets,
//    so each upload can be attached once.
// Anything that fails after upload is deleted from Cloudinary, and tickets
// that are never used are swept (asset deleted) once they expire.
import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import { AppError } from "./AppError.js";
import { mediaStorage } from "./mediaStorage.js";
import { MEDIA_LIMITS, MAX_BYTES, ALLOWED_FORMATS, RESOURCE_TYPE, MEDIA_FOLDER } from "./mediaRules.js";

// Cloudinary accepts a signature for 1 hour; one more hour to finish a slow
// upload and attach it. After that the ticket is swept.
export const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;
// Caps how many unused signatures one user can hold at a time.
export const MAX_PENDING_PER_USER = 30;
const SWEEP_BATCH = 20;

const mediaError = (status, message) => new AppError(status, message, { media: message });

// Rejects a set of media that would take a listing past its limits.
// `existing` and `incoming` are lists of { type }.
export function assertWithinLimits(existing, incoming) {
  const count = (list, type) => list.filter((m) => m.type === type).length;
  const total = existing.length + incoming.length;
  if (total > MEDIA_LIMITS.maxTotal) {
    throw mediaError(400, `A listing can have at most ${MEDIA_LIMITS.maxTotal} photos and videos in total`);
  }
  if (count(existing, "IMAGE") + count(incoming, "IMAGE") > MEDIA_LIMITS.maxImages) {
    throw mediaError(400, `A listing can have at most ${MEDIA_LIMITS.maxImages} images`);
  }
  if (count(existing, "VIDEO") + count(incoming, "VIDEO") > MEDIA_LIMITS.maxVideos) {
    throw mediaError(400, `A listing can have at most ${MEDIA_LIMITS.maxVideos} videos`);
  }
}

// Deletes an asset whatever resource type it ended up as (a signature can't
// stop someone posting to a different Cloudinary endpoint, so check all).
// Returns true if every delete call succeeded.
async function purgeAsset(publicId) {
  try {
    await Promise.all(["IMAGE", "VIDEO", "RAW"].map((t) => mediaStorage.destroy(publicId, t)));
    return true;
  } catch (err) {
    console.error(`Failed to delete Cloudinary asset ${publicId}:`, err?.message || err);
    return false;
  }
}

// Deletes the assets and their tickets. If Cloudinary can't be reached, the
// ticket is kept (and marked expired) so the next sweep retries it.
async function purgeUploads(publicIds) {
  for (const publicId of publicIds) {
    if (await purgeAsset(publicId)) {
      await prisma.mediaUpload.deleteMany({ where: { publicId } });
    } else {
      await prisma.mediaUpload.updateMany({ where: { publicId }, data: { expiresAt: new Date() } });
    }
  }
}

// Removes expired, never-attached uploads. Called whenever new signatures are
// issued, so no cron job is needed.
export async function sweepExpiredUploads() {
  const expired = await prisma.mediaUpload.findMany({
    where: { expiresAt: { lte: new Date() } },
    select: { publicId: true },
    take: SWEEP_BATCH,
  });
  if (expired.length > 0) await discardUnattached(expired.map((t) => t.publicId));
}

// After a failed attach (or for expired tickets): deletes the assets that did
// NOT end up on a listing. Something already attached (e.g. by a concurrent
// request that won) is never deleted; only its stale ticket is removed.
export async function discardUnattached(publicIds) {
  if (publicIds.length === 0) return;
  const attached = await prisma.itemMedia.findMany({ where: { publicId: { in: publicIds } }, select: { publicId: true } });
  const attachedIds = new Set(attached.map((m) => m.publicId));
  await prisma.mediaUpload.deleteMany({ where: { publicId: { in: [...attachedIds] } } });
  await purgeUploads(publicIds.filter((id) => !attachedIds.has(id)));
}

// Issues one signed upload per requested type, for a new listing
// (itemId null) or for an existing listing the caller owns (checked by the
// caller). Returns [{ publicId, type, uploadUrl, fields }].
export async function issueUploads(userId, itemId, types) {
  await sweepExpiredUploads();

  const now = new Date();
  const pending = await prisma.mediaUpload.count({ where: { userId, expiresAt: { gt: now } } });
  if (pending + types.length > MAX_PENDING_PER_USER) {
    throw mediaError(429, "Too many unfinished uploads. Please finish your current listing or try again later.");
  }

  const existing = itemId ? await prisma.itemMedia.findMany({ where: { itemId }, select: { type: true } }) : [];
  assertWithinLimits(existing, types.map((type) => ({ type })));

  const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
  const tickets = types.map((type) => ({
    // Server-chosen and unguessable; the user id is embedded for traceability.
    publicId: `${MEDIA_FOLDER}/u${userId}_${crypto.randomBytes(12).toString("hex")}`,
    userId,
    itemId: itemId ?? null,
    type,
    expiresAt,
  }));
  await prisma.mediaUpload.createMany({ data: tickets });

  return {
    expiresAt,
    uploads: tickets.map((t) => ({ publicId: t.publicId, type: t.type, ...mediaStorage.signUpload(t.publicId, t.type) })),
  };
}

// Is what Cloudinary stored acceptable for a ticket of this type?
function assetProblem(asset, ticket) {
  if (asset.publicId !== ticket.publicId || asset.resourceType !== RESOURCE_TYPE[ticket.type] || asset.deliveryType !== "upload") {
    return "was not uploaded as expected";
  }
  if (!ALLOWED_FORMATS[ticket.type].includes(asset.format)) return `has an unsupported format (${asset.format})`;
  if (!(asset.bytes > 0)) return "is empty";
  if (asset.bytes > MAX_BYTES[ticket.type]) {
    return ticket.type === "IMAGE" ? "is larger than 5 MB" : "is larger than 50 MB";
  }
  if (typeof asset.url !== "string" || !asset.url.startsWith("https://res.cloudinary.com/")) return "has an unexpected URL";
  return null;
}

// Checks public ids the browser says it uploaded. Returns verified media,
// in the given order: [{ publicId, type, url }] where type and url come from
// our ticket and from Cloudinary, never from the client.
export async function verifyUploads(userId, itemId, publicIds) {
  if (publicIds.length === 0) return [];

  const tickets = await prisma.mediaUpload.findMany({ where: { publicId: { in: publicIds } } });
  const byId = new Map(tickets.map((t) => [t.publicId, t]));
  const now = new Date();
  for (const id of publicIds) {
    const t = byId.get(id);
    // Same message whether it is unknown, someone else's or for another
    // listing, so nothing is revealed about other users' uploads.
    if (!t || t.userId !== userId || (t.itemId ?? null) !== (itemId ?? null) || t.expiresAt <= now) {
      throw mediaError(400, "Some uploads are unknown, expired or not yours. Please upload those files again.");
    }
  }

  // Ask Cloudinary what was actually stored (in parallel: one call per file).
  const assets = await Promise.all(publicIds.map((id) => mediaStorage.inspect(id, byId.get(id).type)));

  const notFound = publicIds.filter((_, i) => !assets[i]);
  if (notFound.length > 0) {
    // Possibly still uploading: keep the tickets so the user can retry.
    throw mediaError(400, "Some files haven't finished uploading. Please wait for the uploads to complete and try again.");
  }

  const problems = publicIds
    .map((id, i) => ({ id, problem: assetProblem(assets[i], byId.get(id)) }))
    .filter((p) => p.problem);
  if (problems.length > 0) {
    // These can never become valid (the id can't be re-uploaded), so delete now.
    await purgeUploads(problems.map((p) => p.id));
    throw mediaError(400, `${problems.length} uploaded file(s) were rejected: a file ${problems[0].problem}. Please choose different files.`);
  }

  return publicIds.map((id, i) => ({ publicId: id, type: byId.get(id).type, url: assets[i].url }));
}

// Inside the listing's transaction: uses up the tickets so each upload can be
// attached only once. A concurrent request that already used one makes this
// fail, rolling back the whole transaction.
export async function consumeUploads(tx, userId, itemId, publicIds) {
  if (publicIds.length === 0) return;
  const { count } = await tx.mediaUpload.deleteMany({
    where: { publicId: { in: publicIds }, userId, itemId: itemId ?? null },
  });
  if (count !== publicIds.length) {
    throw mediaError(409, "These uploads were already used. Please refresh and try again.");
  }
}
