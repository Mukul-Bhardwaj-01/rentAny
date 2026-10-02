import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { uploadAll, destroyAll } from "../utils/mediaStorage.js";
import { MEDIA_LIMITS } from "../middleware/upload.middleware.js";

// What clients see of each media entry. The Cloudinary public id stays
// server-side: it is only needed to delete the asset.
const mediaSelect = { id: true, type: true, url: true, sortOrder: true };
const mediaOrder = [{ sortOrder: "asc" }, { id: "asc" }];

// GET /api/items?search=drill&category=Tools
// Public: browse/search all available items.
export async function getItems(req, res) {
  const { search, category } = req.query;

  const items = await prisma.item.findMany({
    where: {
      isAvailable: true,
      ...(category ? { category } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { owner: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json(items);
}

// GET /api/items/:id
export async function getItemById(req, res) {
  const item = await prisma.item.findUnique({
    where: { id: req.params.id },
    include: {
      // No phone here: contact details are shared only once a booking is accepted.
      owner: { select: { id: true, name: true } },
      media: { select: mediaSelect, orderBy: mediaOrder },
    },
  });

  if (!item) throw new AppError(404, "Item not found");
  res.json(item);
}

// GET /api/items/mine  (requires requireAuth)
export async function getMyItems(req, res) {
  const items = await prisma.item.findMany({
    where: { ownerId: req.userId },
    orderBy: { createdAt: "desc" },
  });
  res.json(items);
}

// Rejects a batch that would take an item past its media limits.
function assertWithinLimits(existing, incoming) {
  const count = (list, type) => list.filter((m) => m.type === type).length;
  const images = count(existing, "IMAGE") + count(incoming, "IMAGE");
  const videos = count(existing, "VIDEO") + count(incoming, "VIDEO");
  const fail = (message) => {
    throw new AppError(400, message, { media: message });
  };
  if (existing.length + incoming.length > MEDIA_LIMITS.maxTotal) {
    fail(`A listing can have at most ${MEDIA_LIMITS.maxTotal} photos and videos in total`);
  }
  if (images > MEDIA_LIMITS.maxImages) fail(`A listing can have at most ${MEDIA_LIMITS.maxImages} images`);
  if (videos > MEDIA_LIMITS.maxVideos) fail(`A listing can have at most ${MEDIA_LIMITS.maxVideos} videos`);
}

// The cover (Item.imageUrl, kept for older clients and list views) is the
// first image in display order, or null if the listing has no images.
async function refreshCoverImage(tx, itemId) {
  const first = await tx.itemMedia.findFirst({ where: { itemId, type: "IMAGE" }, orderBy: mediaOrder });
  await tx.item.update({ where: { id: itemId }, data: { imageUrl: first?.url ?? null } });
}

// Uploads the checked files, then runs `saveToDb(uploaded)` in a transaction.
// If the database step fails, the freshly uploaded assets are deleted again.
async function uploadThenSave(files, saveToDb) {
  const uploaded = await uploadAll(files);
  try {
    return await prisma.$transaction((tx) => saveToDb(tx, uploaded));
  } catch (err) {
    await destroyAll(uploaded);
    throw err;
  }
}

// POST /api/items  (requireAuth + uploadMedia + createItemValidator)
// Multipart: text fields plus up to 10 files in "media" (or one legacy "image").
export async function createItem(req, res) {
  const { title, description, category, pricePerHour, location } = req.body;
  const files = req.media;
  assertWithinLimits([], files);

  const item = await uploadThenSave(files, async (tx, uploaded) => {
    const created = await tx.item.create({
      data: {
        title,
        description,
        category,
        pricePerHour,
        location,
        imageUrl: uploaded.find((m) => m.type === "IMAGE")?.url ?? null,
        ownerId: req.userId,
      },
    });
    await tx.itemMedia.createMany({
      data: uploaded.map((m, i) => ({ itemId: created.id, type: m.type, url: m.url, publicId: m.publicId, sortOrder: i })),
    });
    return tx.item.findUnique({
      where: { id: created.id },
      include: { media: { select: mediaSelect, orderBy: mediaOrder } },
    });
  });

  res.status(201).json(item);
}

// Middleware for media routes: the item must exist and belong to the caller.
// Runs before the upload is even received, so nobody can push files at
// someone else's listing.
export async function requireItemOwner(req, res, next) {
  const item = await prisma.item.findUnique({ where: { id: req.params.id }, select: { id: true, ownerId: true } });
  if (!item) throw new AppError(404, "Item not found");
  if (item.ownerId !== req.userId) throw new AppError(403, "Only the owner can change this listing's media");
  next();
}

const mediaResponse = async (client, itemId) => {
  const item = await client.item.findUnique({
    where: { id: itemId },
    select: { imageUrl: true, media: { select: mediaSelect, orderBy: mediaOrder } },
  });
  return item;
};

// POST /api/items/:id/media  (owner)  multipart "media": adds files to the end.
export async function addItemMedia(req, res) {
  const itemId = req.params.id;
  const files = req.media;
  if (files.length === 0) {
    throw new AppError(400, "Choose at least one photo or video", { media: "Choose at least one photo or video" });
  }

  // Quick check before uploading anything...
  const current = await prisma.itemMedia.findMany({ where: { itemId }, select: { type: true } });
  assertWithinLimits(current, files);

  const result = await uploadThenSave(files, async (tx, uploaded) => {
    // ...and the authoritative one under a row lock, so two concurrent
    // uploads can't together exceed the limits.
    await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${itemId} FOR UPDATE`;
    const existing = await tx.itemMedia.findMany({ where: { itemId }, select: { type: true, sortOrder: true } });
    assertWithinLimits(existing, uploaded);

    const nextOrder = existing.reduce((max, m) => Math.max(max, m.sortOrder + 1), 0);
    await tx.itemMedia.createMany({
      data: uploaded.map((m, i) => ({ itemId, type: m.type, url: m.url, publicId: m.publicId, sortOrder: nextOrder + i })),
    });
    await refreshCoverImage(tx, itemId);
    return mediaResponse(tx, itemId);
  });

  res.status(201).json(result);
}

// DELETE /api/items/:id/media/:mediaId  (owner)
export async function deleteItemMedia(req, res) {
  const { id: itemId, mediaId } = req.params;

  const { removed, result } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${itemId} FOR UPDATE`;
    // Scoped to this item, so a media id from another listing is "not found".
    const media = await tx.itemMedia.findFirst({ where: { id: mediaId, itemId } });
    if (!media) throw new AppError(404, "Media not found");
    await tx.itemMedia.delete({ where: { id: media.id } });
    await refreshCoverImage(tx, itemId);
    return { removed: media, result: await mediaResponse(tx, itemId) };
  });

  // Only after the database no longer references it.
  await destroyAll([removed]);
  res.json(result);
}
