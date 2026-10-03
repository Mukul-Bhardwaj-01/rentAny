import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { uploadAll, destroyAll } from "../utils/mediaStorage.js";
import { assertWithinLimits, verifyUploads, consumeUploads, discardUnattached } from "../utils/directUploads.js";

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
      // No phone here: contact details are shared only once a booking is paid.
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

// The cover (Item.imageUrl, kept for older clients and list views) is the
// first image in display order, or null if the listing has no images.
async function refreshCoverImage(tx, itemId) {
  const first = await tx.itemMedia.findFirst({ where: { itemId, type: "IMAGE" }, orderBy: mediaOrder });
  await tx.item.update({ where: { id: itemId }, data: { imageUrl: first?.url ?? null } });
}

const mediaRows = (itemId, media, firstOrder = 0) =>
  media.map((m, i) => ({ itemId, type: m.type, url: m.url, publicId: m.publicId, sortOrder: firstOrder + i }));

const itemWithMedia = (client, id) =>
  client.item.findUnique({ where: { id }, include: { media: { select: mediaSelect, orderBy: mediaOrder } } });

async function insertItem(tx, req, media) {
  const { title, description, category, pricePerHour, location, securityDeposit } = req.body;
  const created = await tx.item.create({
    data: {
      title,
      description,
      category,
      pricePerHour,
      securityDeposit,
      location,
      imageUrl: media.find((m) => m.type === "IMAGE")?.url ?? null,
      ownerId: req.userId,
    },
  });
  await tx.itemMedia.createMany({ data: mediaRows(created.id, media) });
  return created;
}

// POST /api/items  (requireAuth + legacyImageUpload + createItemValidator)
// JSON: text fields + `media`: public ids of files the browser uploaded
// directly to Cloudinary (see POST /api/media/signatures), in display order.
// Legacy: multipart with text fields and a single "image" file.
export async function createItem(req, res) {
  if (req.legacyMedia) {
    if (req.body.media.length > 0) {
      throw new AppError(400, "Send either an \"image\" file or uploaded media ids, not both");
    }
    // Legacy path: the server uploads the one checked image itself.
    const uploaded = await uploadAll(req.legacyMedia);
    try {
      const item = await prisma.$transaction(async (tx) => itemWithMedia(tx, (await insertItem(tx, req, uploaded)).id));
      return res.status(201).json(item);
    } catch (err) {
      await destroyAll(uploaded);
      throw err;
    }
  }

  const ids = req.body.media;
  // Text fields are already valid here. If the uploads are rejected for a
  // fixable reason, they stay available for a retry with the same ids.
  const media = await verifyUploads(req.userId, null, ids);
  assertWithinLimits([], media);

  try {
    const item = await prisma.$transaction(async (tx) => {
      await consumeUploads(tx, req.userId, null, ids);
      const created = await insertItem(tx, req, media);
      return itemWithMedia(tx, created.id);
    });
    res.status(201).json(item);
  } catch (err) {
    // Nothing was saved: delete the uploads so they aren't left orphaned
    // (anything a concurrent request already attached is kept).
    await discardUnattached(ids);
    throw err;
  }
}

// Middleware for owner-only item routes: the item must exist and belong to the caller.
export async function requireItemOwner(req, res, next) {
  const item = await prisma.item.findUnique({ where: { id: req.params.id }, select: { id: true, ownerId: true } });
  if (!item) throw new AppError(404, "Item not found");
  if (item.ownerId !== req.userId) throw new AppError(403, "Only the owner can change this listing");
  next();
}

// PATCH /api/items/:id/security-deposit  (owner)  body: { securityDeposit }
// Existing bookings keep the deposit they were requested with.
export async function updateSecurityDeposit(req, res) {
  const item = await prisma.item.update({
    where: { id: req.params.id },
    data: { securityDeposit: req.body.securityDeposit },
    select: { id: true, securityDeposit: true },
  });
  res.json(item);
}

const mediaResponse = (client, itemId) =>
  client.item.findUnique({
    where: { id: itemId },
    select: { imageUrl: true, media: { select: mediaSelect, orderBy: mediaOrder } },
  });

// POST /api/items/:id/media  (owner)  body: { media: [publicId, ...] }
// Attaches files uploaded directly to Cloudinary with signatures issued for
// this item. They are added after the existing media, in the given order.
export async function addItemMedia(req, res) {
  const itemId = req.params.id;
  const ids = req.body.media;

  const media = await verifyUploads(req.userId, itemId, ids);
  // Quick check before the transaction...
  const current = await prisma.itemMedia.findMany({ where: { itemId }, select: { type: true } });
  assertWithinLimits(current, media);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ...and the authoritative one under a row lock, so two concurrent
      // requests can't together exceed the limits.
      await tx.$queryRaw`SELECT id FROM "Item" WHERE id = ${itemId} FOR UPDATE`;
      const existing = await tx.itemMedia.findMany({ where: { itemId }, select: { type: true, sortOrder: true } });
      assertWithinLimits(existing, media);
      await consumeUploads(tx, req.userId, itemId, ids);

      const nextOrder = existing.reduce((max, m) => Math.max(max, m.sortOrder + 1), 0);
      await tx.itemMedia.createMany({ data: mediaRows(itemId, media, nextOrder) });
      await refreshCoverImage(tx, itemId);
      return mediaResponse(tx, itemId);
    });
    res.status(201).json(result);
  } catch (err) {
    await discardUnattached(ids);
    throw err;
  }
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
