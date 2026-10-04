import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { uploadAll, destroyAll } from "../utils/mediaStorage.js";
import { assertWithinLimits, verifyUploads, consumeUploads, discardUnattached } from "../utils/directUploads.js";
import { notifyBookings } from "../utils/notifications.js";

// What notification messages need to know about a booking.
const bookingNotifyInclude = {
  item: { select: { title: true } },
  renter: { select: { name: true } },
  owner: { select: { name: true } },
};

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
      deletedAt: null,
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
      owner: { select: { id: true, name: true, ownerRatingSum: true, ownerRatingCount: true } },
      media: { select: mediaSelect, orderBy: mediaOrder },
    },
  });

  // Deleted listings are gone for everyone; bookings keep their own snapshot.
  if (!item || item.deletedAt) throw new AppError(404, "Item not found");
  res.json(item);
}

// Statuses that commit the owner to a rental (same as the overlap constraint).
const COMMITTED_STATUSES = ["ACCEPTED", "CONFIRMED", "ACTIVE"];

// GET /api/items/mine  (requires requireAuth)
// The owner's listings (paused ones included, deleted ones not), with
// booking counts for the profile page.
export async function getMyItems(req, res) {
  const items = await prisma.item.findMany({
    where: { ownerId: req.userId, deletedAt: null },
    include: {
      _count: {
        select: {
          bookings: true,
          media: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Pending and committed bookings per item, in one grouped query.
  const grouped = items.length
    ? await prisma.booking.groupBy({
        by: ["itemId", "status"],
        where: { itemId: { in: items.map((i) => i.id) }, status: { in: ["PENDING", ...COMMITTED_STATUSES, "COMPLETED"] } },
        _count: { _all: true },
      })
    : [];
  const countFor = (itemId, statuses) =>
    grouped.filter((g) => g.itemId === itemId && statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);

  res.json(
    items.map(({ _count, ...item }) => ({
      ...item,
      stats: {
        totalBookings: _count.bookings,
        media: _count.media,
        pendingRequests: countFor(item.id, ["PENDING"]),
        upcomingOrActive: countFor(item.id, COMMITTED_STATUSES),
        completed: countFor(item.id, ["COMPLETED"]),
      },
    }))
  );
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

// Middleware for owner-only item routes: the item must exist (and not be
// deleted) and belong to the caller.
export async function requireItemOwner(req, res, next) {
  const item = await prisma.item.findUnique({
    where: { id: req.params.id },
    select: { id: true, ownerId: true, deletedAt: true },
  });
  if (!item || item.deletedAt) throw new AppError(404, "Item not found");
  if (item.ownerId !== req.userId) throw new AppError(403, "Only the owner can change this listing");
  next();
}

// Locks the item row for the rest of the transaction and re-checks that it
// is still live: a concurrent delete can't slip between check and write.
async function lockLiveItem(tx, itemId) {
  const [row] = await tx.$queryRaw`SELECT id, "deletedAt" FROM "Item" WHERE id = ${itemId} FOR UPDATE`;
  if (!row || row.deletedAt) throw new AppError(404, "Item not found");
}

// PATCH /api/items/:id  (owner)  body: any of title, description, category,
// location, pricePerHour, securityDeposit, isAvailable.
// Bookings already requested keep the price and deposit they were made with
// (they are snapshotted on the booking), so only future requests change.
// isAvailable = false pauses the listing: hidden from search and no new
// requests; bookings already made are unaffected.
export async function updateItem(req, res) {
  const itemId = req.params.id;
  const item = await prisma.$transaction(async (tx) => {
    await lockLiveItem(tx, itemId);
    await tx.item.update({ where: { id: itemId }, data: req.body });
    return itemWithMedia(tx, itemId);
  });
  res.json(item);
}

// PATCH /api/items/:id/security-deposit  (owner)  body: { securityDeposit }
// Existing bookings keep the deposit they were requested with.
export async function updateSecurityDeposit(req, res) {
  const item = await prisma.$transaction(async (tx) => {
    await lockLiveItem(tx, req.params.id);
    return tx.item.update({
      where: { id: req.params.id },
      data: { securityDeposit: req.body.securityDeposit },
      select: { id: true, securityDeposit: true },
    });
  });
  res.json(item);
}

// DELETE /api/items/:id  (owner)
// Soft delete: the listing disappears everywhere but the row stays, because
// past bookings, payments, deposit claims and reviews reference it.
// - Refused while the owner is committed to a rental (accepted, paid or in
//   progress): those must be completed or cancelled first, so renters are
//   never left with a paid booking for a vanished item.
// - Open requests are declined and each renter is notified.
// - Upload tickets for the listing are expired so the sweep removes them.
// Photos and videos are kept: booking history still shows the cover image.
export async function deleteItem(req, res) {
  const itemId = req.params.id;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Same lock as accepting a booking, so a request can't be accepted while
    // the listing is being deleted (and vice versa).
    await lockLiveItem(tx, itemId);

    const committed = await tx.booking.count({ where: { itemId, status: { in: COMMITTED_STATUSES } } });
    if (committed > 0) {
      throw new AppError(
        409,
        `This listing has ${committed} upcoming or ongoing booking${committed === 1 ? "" : "s"}. ` +
          "Complete or cancel them before deleting it, or pause the listing instead."
      );
    }

    const pending = await tx.booking.findMany({ where: { itemId, status: "PENDING" }, include: bookingNotifyInclude });
    const declined = [];
    for (const b of pending) {
      const { count } = await tx.booking.updateMany({
        where: { id: b.id, status: "PENDING" },
        data: { status: "REJECTED", respondedAt: now, responseNote: "The owner removed this listing" },
      });
      if (count === 1) declined.push(b);
    }
    await notifyBookings(tx, declined, "BOOKING_REJECTED", { extra: { listingRemoved: true } });

    await tx.mediaUpload.updateMany({ where: { itemId, expiresAt: { gt: now } }, data: { expiresAt: now } });
    await tx.item.update({ where: { id: itemId }, data: { deletedAt: now, isAvailable: false } });
    return { id: itemId, deleted: true, declinedRequests: declined.length };
  });

  res.json(result);
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
      await lockLiveItem(tx, itemId);
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
    await lockLiveItem(tx, itemId);
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
