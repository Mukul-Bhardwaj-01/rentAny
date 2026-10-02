// Listing media with signed direct-to-Cloudinary uploads: signatures,
// ownership, server-side verification of what was uploaded, limits,
// consistency/cleanup, and the legacy single-image path.
//
// Signing is real (pure computation with the API secret). Cloudinary's
// storage is an in-memory fake: tests "upload" by putting an asset into it,
// exactly as Cloudinary would after a browser upload.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { v2 as cloudinary } from "cloudinary";
import { startServer, createContext, prisma } from "./helpers.js";
import { mediaStorage } from "../src/utils/mediaStorage.js";
import { TEMP_DIR } from "../src/middleware/upload.middleware.js";
import { MAX_PENDING_PER_USER } from "../src/utils/directUploads.js";

const MB = 1024 * 1024;
const RESOURCE = { IMAGE: "image", VIDEO: "video", RAW: "raw" };

// ---------- fake Cloudinary storage ----------
const cloud = new Map(); // publicId -> { resourceType, format, bytes, deliveryType }
const calls = { inspect: [], destroy: [], upload: 0 };
const original = { ...mediaStorage };

function fakeUpload(publicId, { type = "IMAGE", format, bytes = 1000, deliveryType = "upload", resourceType } = {}) {
  cloud.set(publicId, {
    resourceType: resourceType || RESOURCE[type],
    format: format || (type === "IMAGE" ? "jpg" : "mp4"),
    bytes,
    deliveryType,
  });
}
const urlFor = (publicId) => `https://res.cloudinary.com/testcloud/${cloud.get(publicId).resourceType}/upload/v1/${publicId}`;

let api, close, ctx, O, R;
const fields = { title: "Camera kit", description: "Media test listing, please ignore", category: "Cameras", pricePerHour: "200", location: "Mohali" };

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "media");
  mediaStorage.inspect = async (publicId, type) => {
    calls.inspect.push(publicId);
    const a = cloud.get(publicId);
    if (!a || a.resourceType !== RESOURCE[type]) return null;
    return { publicId, resourceType: a.resourceType, deliveryType: a.deliveryType, format: a.format, bytes: a.bytes, url: urlFor(publicId) };
  };
  mediaStorage.destroy = async (publicId, type) => {
    calls.destroy.push({ publicId, type });
    if (cloud.get(publicId)?.resourceType === RESOURCE[type]) cloud.delete(publicId);
  };
  mediaStorage.upload = async (path, type) => {
    calls.upload += 1;
    fs.statSync(path); // the temp file must exist while uploading
    const publicId = `rentany_items/legacy_${calls.upload}_${Date.now()}`;
    cloud.set(publicId, { resourceType: RESOURCE[type], format: "png", bytes: 100, deliveryType: "upload" });
    return { url: urlFor(publicId), publicId };
  };
  O = await ctx.registerUser("Owner");
  R = await ctx.registerUser("Other");
});

after(async () => {
  Object.assign(mediaStorage, original);
  await ctx.cleanup();
  await close();
  await prisma.$disconnect();
});

// ---------- helpers ----------
const IMG = { mimeType: "image/jpeg", size: 200_000 };
const VID = { mimeType: "video/mp4", size: 10 * MB };
const sign = (user, files, itemId) =>
  api("POST", "/media/signatures", { token: user?.token, body: { files, ...(itemId ? { itemId } : {}) } });
const createItem = (user, media, extra = {}) => api("POST", "/items", { token: user.token, body: { ...fields, media, ...extra } });
const attach = (user, itemId, media) => api("POST", `/items/${itemId}/media`, { token: user?.token, body: { media } });
const ticketCount = (where = {}) => prisma.mediaUpload.count({ where: { userId: { in: [O.id, R.id] }, ...where } });
const purged = (publicId) => !cloud.has(publicId) && calls.destroy.some((d) => d.publicId === publicId);

// Signs and "uploads" files; returns their public ids in order.
async function uploadFor(user, specs, itemId) {
  const r = await sign(user, specs.map((s) => (s.type === "VIDEO" ? VID : IMG)), itemId);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r.data.uploads.forEach((u, i) => fakeUpload(u.publicId, { type: u.type, ...specs[i] }));
  return r.data.uploads.map((u) => u.publicId);
}
const images = (n) => [...Array(n)].map(() => ({ type: "IMAGE" }));

// ---------- signatures ----------
test("signatures require login", async () => {
  assert.equal((await sign(null, [IMG])).status, 401);
});

test("signature parameters are decided and signed by the server", async () => {
  const before = Date.now() / 1000;
  const r = await sign(O, [IMG, VID]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const { cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret } = cloudinary.config();
  assert.ok(!JSON.stringify(r.data).includes(apiSecret), "API secret never sent");

  const [img, vid] = r.data.uploads;
  assert.equal(img.type, "IMAGE");
  assert.equal(vid.type, "VIDEO");
  assert.equal(img.uploadUrl, `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`);
  assert.equal(vid.uploadUrl, `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`);
  assert.equal(img.fields.allowed_formats, "jpg,png,webp");
  assert.equal(vid.fields.allowed_formats, "mp4,webm");

  for (const u of [img, vid]) {
    const { signature, api_key: key, ...signed } = u.fields;
    assert.deepEqual(Object.keys(signed).sort(), ["allowed_formats", "overwrite", "public_id", "timestamp"], "nothing else is signed");
    assert.equal(key, apiKey);
    assert.equal(signed.overwrite, false);
    assert.equal(signed.public_id, u.publicId);
    assert.match(u.publicId, new RegExp(`^rentany_items/u${O.id}_[a-f0-9]{24}$`), "server-chosen id in our folder");
    assert.ok(Math.abs(signed.timestamp - before) < 60, "fresh timestamp");
    assert.equal(signature, cloudinary.utils.api_sign_request(signed, apiSecret), "valid Cloudinary signature");
  }
  assert.notEqual(img.publicId, vid.publicId);

  const tickets = await prisma.mediaUpload.findMany({ where: { publicId: { in: [img.publicId, vid.publicId] } } });
  assert.equal(tickets.length, 2);
  for (const t of tickets) {
    assert.equal(t.userId, O.id);
    assert.equal(t.itemId, null);
    const ttlHours = (t.expiresAt - t.createdAt) / 3600e3;
    assert.ok(ttlHours > 1.9 && ttlHours <= 2.01, `ticket lifetime ${ttlHours}h`);
  }
  assert.ok(new Date(r.data.expiresAt) > new Date());
});

test("forbidden types, sizes and counts get no signature", async () => {
  const before = await ticketCount();
  const bad = [
    [[], /at least one/],
    [[{ mimeType: "image/svg+xml", size: 100 }], /Only JPG/],
    [[{ mimeType: "image/gif", size: 100 }], /Only JPG/],
    [[{ mimeType: "video/quicktime", size: 100 }], /Only JPG/],
    [[{ mimeType: "application/pdf", size: 100 }], /Only JPG/],
    [[{ mimeType: "image/png", size: 5 * MB + 1 }], /5 MB/],
    [[{ mimeType: "video/webm", size: 50 * MB + 1 }], /50 MB/],
    [[{ mimeType: "image/png", size: 0 }], /valid size/],
    [[{ mimeType: "image/png" }], /valid size/],
    [[...Array(11)].map(() => IMG), /at most 10/],
    [[...Array(9)].map(() => IMG), /at most 8 images/],
    [[VID, VID, VID], /at most 2 videos/],
  ];
  for (const [files, re] of bad) {
    const r = await sign(O, files);
    assert.equal(r.status, 400, JSON.stringify(files).slice(0, 80));
    assert.match(r.data.errors.files || r.data.errors.media, re);
  }
  assert.equal((await api("POST", "/media/signatures", { token: O.token, body: { files: [IMG], itemId: "abc" } })).status, 400);
  assert.equal(await ticketCount(), before, "no tickets issued");
});

let item; // an item of O's with 2 images + 1 video, used below

test("create a listing from direct uploads: order kept, URLs and types from the server", async () => {
  const ids = await uploadFor(O, [{ type: "VIDEO", format: "webm" }, { type: "IMAGE", format: "png" }, { type: "IMAGE", format: "webp" }]);
  const r = await createItem(O, ids);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  item = r.data;
  assert.deepEqual(item.media.map((m) => m.type), ["VIDEO", "IMAGE", "IMAGE"]);
  assert.deepEqual(item.media.map((m) => m.sortOrder), [0, 1, 2]);
  assert.deepEqual(item.media.map((m) => m.url), ids.map(urlFor), "URLs reported by Cloudinary");
  assert.equal(item.imageUrl, urlFor(ids[1]), "cover = first image");
  assert.deepEqual(Object.keys(item.media[0]).sort(), ["id", "sortOrder", "type", "url"]);
  assert.ok(!JSON.stringify(item).includes(ids[0]) || item.media[0].url.includes(ids[0]), "ids only appear inside URLs");
  const rows = await prisma.itemMedia.findMany({ where: { itemId: item.id }, orderBy: { sortOrder: "asc" } });
  assert.deepEqual(rows.map((m) => m.publicId), ids);
  assert.equal(await prisma.mediaUpload.count({ where: { publicId: { in: ids } } }), 0, "tickets consumed");

  // The same uploads can't be attached again.
  const again = await createItem(O, ids);
  assert.equal(again.status, 400);
  assert.ok(ids.every((id) => cloud.has(id)), "attached assets untouched");
});

test("a listing without media still works", async () => {
  const r = await createItem(O, []);
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.media, []);
  assert.equal(r.data.imageUrl, null);
  assert.equal((await createItem(O, undefined)).status, 201);
});

test("the server checks what Cloudinary actually stored", async () => {
  // Not uploaded (yet): rejected, ticket kept so the user can retry.
  let [id] = await uploadFor(O, [{ type: "IMAGE" }]);
  cloud.delete(id);
  let r = await createItem(O, [id]);
  assert.equal(r.status, 400);
  assert.match(r.data.message, /finished uploading/);
  assert.equal(await prisma.mediaUpload.count({ where: { publicId: id } }), 1);
  fakeUpload(id, { type: "IMAGE" });
  assert.equal((await createItem(O, [id])).status, 201, "retry after the upload completes");

  // Invalid assets are rejected AND deleted (they can never become valid).
  const invalid = [
    ["GIF in an image slot", { type: "IMAGE", format: "gif" }],
    ["image over 5 MB", { type: "IMAGE", bytes: 5 * MB + 1 }],
    ["video over 50 MB", { type: "VIDEO", bytes: 50 * MB + 1 }],
    ["MOV in a video slot", { type: "VIDEO", format: "mov" }],
    ["private delivery type", { type: "IMAGE", deliveryType: "private" }],
    ["zero-byte file", { type: "IMAGE", bytes: 0 }],
  ];
  for (const [label, spec] of invalid) {
    [id] = await uploadFor(O, [spec]);
    const [good] = await uploadFor(O, [{ type: "IMAGE" }]);
    const itemsBefore = await prisma.item.count({ where: { ownerId: O.id } });
    r = await createItem(O, [good, id]);
    assert.equal(r.status, 400, label);
    assert.match(r.data.message, /rejected/, label);
    assert.ok(purged(id), `${label}: deleted from Cloudinary`);
    assert.equal(await prisma.mediaUpload.count({ where: { publicId: id } }), 0, `${label}: ticket removed`);
    assert.ok(cloud.has(good), `${label}: the valid upload is kept for a retry`);
    assert.equal(await prisma.item.count({ where: { ownerId: O.id } }), itemsBefore, `${label}: no item`);
  }

  // Uploaded under an image signature but stored as a raw file / video:
  // our lookup (as an image) finds nothing, so it is never accepted.
  [id] = await uploadFor(O, [{ type: "IMAGE", resourceType: "raw", format: "jpg" }]);
  r = await createItem(O, [id]);
  assert.equal(r.status, 400);
});

test("another user's uploads, made-up ids and arbitrary URLs are refused", async () => {
  const [othersId] = await uploadFor(R, [{ type: "IMAGE" }]);
  const destroysBefore = calls.destroy.length;
  let r = await createItem(O, [othersId]);
  assert.equal(r.status, 400);
  assert.match(r.data.message, /unknown, expired or not yours/);
  assert.ok(cloud.has(othersId), "the other user's asset is not touched");
  assert.equal(await prisma.mediaUpload.count({ where: { publicId: othersId } }), 1, "their ticket is intact");
  assert.equal(calls.destroy.length, destroysBefore);

  const fabricated = `rentany_items/u${O.id}_${"a".repeat(24)}`;
  fakeUpload(fabricated, { type: "IMAGE" });
  assert.equal((await createItem(O, [fabricated])).status, 400, "id never issued");

  for (const media of [
    ["rentany_items/xi4syi1k5iu7g4inotm7"], // a real, existing asset of another listing
    ["https://evil.example/photo.jpg"],
    ["https://res.cloudinary.com/x/image/upload/v1/rentany_items/u1_aaaaaaaaaaaaaaaaaaaaaaaa.jpg"],
    [{ publicId: othersId, url: "https://evil.example/x.jpg", type: "IMAGE" }],
    "not-a-list",
  ]) {
    r = await createItem(O, media);
    assert.equal(r.status, 400, JSON.stringify(media));
  }
  const [dupe] = await uploadFor(O, [{ type: "IMAGE" }]);
  assert.equal((await createItem(O, [dupe, dupe])).status, 400, "same id twice");
});

test("invalid listing details keep the uploads for a retry", async () => {
  const ids = await uploadFor(O, [{ type: "IMAGE" }, { type: "VIDEO" }]);
  let r = await createItem(O, ids, { title: "x", pricePerHour: "-1" });
  assert.equal(r.status, 400);
  assert.ok(r.data.errors.title && r.data.errors.pricePerHour);
  assert.ok(ids.every((id) => cloud.has(id)), "nothing deleted");
  assert.equal(await prisma.mediaUpload.count({ where: { publicId: { in: ids } } }), 2);
  r = await createItem(O, ids);
  assert.equal(r.status, 201, "same uploads work once the form is fixed");
});

test("limits are enforced again when attaching, whatever signatures were obtained", async () => {
  // Two separate signature requests, 2 videos each: 4 valid video uploads.
  const ids = [...(await uploadFor(O, [{ type: "VIDEO" }, { type: "VIDEO" }])), ...(await uploadFor(O, [{ type: "VIDEO" }, { type: "VIDEO" }]))];
  let r = await createItem(O, ids.slice(0, 3));
  assert.equal(r.status, 400);
  assert.match(r.data.errors.media, /at most 2 videos/);
  assert.ok(ids.every((id) => cloud.has(id)), "fixable: uploads kept");

  const nine = [...(await uploadFor(O, images(5))), ...(await uploadFor(O, images(4)))];
  r = await createItem(O, nine);
  assert.equal(r.status, 400);
  assert.match(r.data.errors.media, /at most 8 images/);

  r = await createItem(O, [...nine.slice(0, 8), ...ids.slice(0, 2)]);
  assert.equal(r.status, 201, "8 images + 2 videos is the maximum");
  assert.equal(r.data.media.length, 10);
  const full = r.data;

  // Existing listing at its limit: no signature for more, and nothing attaches.
  r = await sign(O, [IMG], full.id);
  assert.equal(r.status, 400);
  assert.match(r.data.errors.media, /at most 10/);
});

test("signatures for an existing listing: owner only, counted against its media", async () => {
  const before = await ticketCount();
  let r = await sign(R, [IMG], item.id);
  assert.equal(r.status, 403, "someone else's item");
  assert.equal((await sign(O, [IMG], 99999999)).status, 404);
  assert.equal(await ticketCount(), before, "no tickets issued");

  // item has 2 images + 1 video: 7 more images would be 9.
  r = await sign(O, [...Array(7)].map(() => IMG), item.id);
  assert.equal(r.status, 400);
  assert.match(r.data.errors.media, /at most 8 images/);

  r = await sign(O, [IMG, VID], item.id);
  assert.equal(r.status, 201);
  const tickets = await prisma.mediaUpload.findMany({ where: { publicId: { in: r.data.uploads.map((u) => u.publicId) } } });
  assert.ok(tickets.every((t) => t.itemId === item.id));
});

test("attaching to an existing listing: owner only, tickets bound to that listing", async () => {
  const ids = await uploadFor(O, [{ type: "IMAGE" }, { type: "VIDEO" }], item.id);

  let r = await attach(R, item.id, ids);
  assert.equal(r.status, 403, "non-owner");
  assert.equal((await attach(null, item.id, ids)).status, 401);
  assert.ok(ids.every((id) => cloud.has(id)));

  const other = (await createItem(O, [])).data;
  r = await attach(O, other.id, ids);
  assert.equal(r.status, 400, "tickets issued for a different listing");
  assert.equal((await createItem(O, ids)).status, 400, "or for a new listing");
  const newListingIds = await uploadFor(O, [{ type: "IMAGE" }]);
  assert.equal((await attach(O, item.id, newListingIds)).status, 400, "new-listing tickets can't go on an existing one");

  // R uploads with signatures for R's own new listing, then tries O's item.
  const rIds = await uploadFor(R, [{ type: "IMAGE" }]);
  assert.equal((await attach(R, item.id, rIds)).status, 403);

  r = await attach(O, item.id, ids);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.media.map((m) => m.sortOrder), [0, 1, 2, 3, 4]);
  assert.deepEqual(r.data.media.slice(3).map((m) => m.url), ids.map(urlFor));
  assert.equal((await attach(O, item.id, [])).status, 400, "empty list");
});

test("a failed database write deletes the uploads (new and existing listings)", async () => {
  const blockMedia = () =>
    prisma.$executeRawUnsafe(`ALTER TABLE "ItemMedia" ADD CONSTRAINT "test_tmp_block_media" CHECK ("sortOrder" < 0) NOT VALID`);
  const unblock = () => prisma.$executeRawUnsafe(`ALTER TABLE "ItemMedia" DROP CONSTRAINT IF EXISTS "test_tmp_block_media"`);

  // New listing.
  let ids = await uploadFor(O, [{ type: "IMAGE" }, { type: "VIDEO" }]);
  const itemsBefore = await prisma.item.count({ where: { ownerId: O.id } });
  let r;
  await blockMedia();
  try {
    r = await createItem(O, ids);
  } finally {
    await unblock();
  }
  assert.equal(r.status, 500);
  assert.equal(await prisma.item.count({ where: { ownerId: O.id } }), itemsBefore, "item insert rolled back");
  assert.ok(ids.every(purged), "uploads deleted from Cloudinary");
  assert.equal(await prisma.mediaUpload.count({ where: { publicId: { in: ids } } }), 0, "tickets removed");

  // Existing listing.
  ids = await uploadFor(O, [{ type: "IMAGE" }], item.id);
  const mediaBefore = await prisma.itemMedia.count({ where: { itemId: item.id } });
  await blockMedia();
  try {
    r = await attach(O, item.id, ids);
  } finally {
    await unblock();
  }
  assert.equal(r.status, 500);
  assert.equal(await prisma.itemMedia.count({ where: { itemId: item.id } }), mediaBefore);
  assert.ok(ids.every(purged));
  assert.equal(await prisma.mediaUpload.count({ where: { publicId: { in: ids } } }), 0);
});

test("the same uploads sent twice at once: one listing gets them, nothing is wrongly deleted", async () => {
  const ids = await uploadFor(O, [{ type: "IMAGE" }, { type: "IMAGE" }]);
  const results = await Promise.all([createItem(O, ids), createItem(O, ids)]);
  const statuses = results.map((r) => r.status).sort();
  assert.equal(statuses[0], 201, JSON.stringify(results.map((r) => r.data)));
  assert.ok([400, 409].includes(statuses[1]), `loser got ${statuses[1]}`);
  assert.ok(ids.every((id) => cloud.has(id)), "attached assets were not deleted by the loser");
  assert.equal(await prisma.itemMedia.count({ where: { publicId: { in: ids } } }), 2);
});

test("expired unused uploads are swept from Cloudinary and can't be attached", async () => {
  const ids = await uploadFor(O, [{ type: "IMAGE" }, { type: "VIDEO" }]);
  await prisma.mediaUpload.updateMany({ where: { publicId: { in: ids } }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const r = await createItem(O, ids);
  assert.equal(r.status, 400, "expired");
  assert.ok(ids.every((id) => cloud.has(id)), "not deleted by the failed attach");

  await sign(R, [IMG]); // any signature request runs the sweep
  assert.ok(ids.every(purged), "swept from Cloudinary");
  assert.equal(await prisma.mediaUpload.count({ where: { publicId: { in: ids } } }), 0);
  // All resource types are cleared, in case a signature was used on another endpoint.
  const types = calls.destroy.filter((d) => d.publicId === ids[0]).map((d) => d.type).sort();
  assert.deepEqual(types, ["IMAGE", "RAW", "VIDEO"]);
});

test("a user can't hold unlimited unused signatures", async () => {
  await prisma.mediaUpload.deleteMany({ where: { userId: R.id } });
  for (let i = 0; i < MAX_PENDING_PER_USER / 10; i++) {
    assert.equal((await sign(R, [...Array(8)].map(() => IMG).concat([VID, VID]))).status, 201);
  }
  const r = await sign(R, [IMG]);
  assert.equal(r.status, 429);
});

test("owner removes media; others can't", async () => {
  const current = (await api("GET", `/items/${item.id}`)).data.media;
  const first = await prisma.itemMedia.findUnique({ where: { id: current[0].id } });
  assert.equal((await api("DELETE", `/items/${item.id}/media/${first.id}`, { token: R.token })).status, 403);
  assert.ok(cloud.has(first.publicId));
  const r = await api("DELETE", `/items/${item.id}/media/${first.id}`, { token: O.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.media.length, current.length - 1);
  assert.ok(purged(first.publicId));
});

// ---------- legacy multipart "image" path ----------
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
function legacyForm(file, field = "image", extra = fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  if (file) form.append(field, new Blob([file.buf], { type: file.type }), file.name);
  return form;
}
const legacyCreate = (form) => api("POST", "/items", { token: O.token, form });

test("legacy clients can still send one 'image' file", async () => {
  const uploadsBefore = calls.upload;
  let r = await legacyCreate(legacyForm({ buf: PNG, type: "image/png", name: "a.png" }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.media.length, 1);
  assert.equal(r.data.media[0].type, "IMAGE");
  assert.equal(r.data.imageUrl, r.data.media[0].url);
  assert.equal(calls.upload, uploadsBefore + 1);

  // Still checked: real content, type and size; and nothing else accepted.
  const rejected = [
    legacyForm({ buf: Buffer.from("not an image at all, just text"), type: "image/png", name: "fake.png" }),
    legacyForm({ buf: PNG, type: "video/mp4", name: "a.mp4" }),
    legacyForm({ buf: Buffer.concat([PNG, Buffer.alloc(5 * MB)]), type: "image/png", name: "big.png" }),
    legacyForm({ buf: PNG, type: "image/png", name: "a.png" }, "media"),
  ];
  for (const form of rejected) {
    r = await legacyCreate(form);
    assert.ok([400, 413].includes(r.status), `${r.status} ${JSON.stringify(r.data)}`);
  }
  assert.equal(calls.upload, uploadsBefore + 1, "rejected files never reach Cloudinary");
});

test("an imageUrl-only listing (from before media) still shows its image", async () => {
  const legacy = await prisma.item.create({
    data: { ...fields, pricePerHour: "99", ownerId: O.id, imageUrl: "https://res.cloudinary.com/demo/image/upload/v1/rentany_items/old.png" },
  });
  const r = await api("GET", `/items/${legacy.id}`);
  assert.equal(r.data.imageUrl, legacy.imageUrl);
  assert.deepEqual(r.data.media, []);
});

test("temporary upload files are always removed", async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(fs.readdirSync(TEMP_DIR), []);
});
