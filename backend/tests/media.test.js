// Listing photos/videos: limits, content checks, ownership, ordering,
// backward compatibility and cleanup. Cloudinary is replaced by an
// in-memory fake so these tests make no network calls.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer, createContext, prisma } from "./helpers.js";
import { mediaStorage } from "../src/utils/mediaStorage.js";
import { TEMP_DIR } from "../src/middleware/upload.middleware.js";

// ---------- fake Cloudinary ----------
const store = { uploads: [], destroys: [], failUploadNumber: null, uploadDelayMs: 0, n: 0 };
const original = { ...mediaStorage };
let runTag;

// ---------- file fixtures (only the leading bytes matter) ----------
const pad = (head, size = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, size - head.length))]);
const FILES = {
  jpg: () => ({ buf: pad([0xff, 0xd8, 0xff, 0xe0]), type: "image/jpeg", name: "photo.jpg" }),
  png: () => ({ buf: pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), type: "image/png", name: "photo.png" }),
  webp: () => ({ buf: pad(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), type: "image/webp", name: "photo.webp" }),
  mp4: () => ({ buf: pad(Buffer.from("\0\0\0\x18ftypisom\0\0\0\0", "latin1")), type: "video/mp4", name: "clip.mp4" }),
  webm: () => ({ buf: pad([0x1a, 0x45, 0xdf, 0xa3]), type: "video/webm", name: "clip.webm" }),
};
const named = (f, name) => ({ ...f, name });

let api, close, ctx, O, R;
const fields = {
  title: "Camera kit",
  description: "Media test listing, please ignore",
  category: "Cameras",
  pricePerHour: "200",
  location: "Mohali",
};

before(async () => {
  ({ api, close } = await startServer());
  ctx = createContext(api, "media");
  runTag = ctx.prefix;
  mediaStorage.upload = async (path, type) => {
    const n = ++store.n;
    const size = fs.statSync(path).size; // the temp file must exist while uploading
    store.uploads.push({ n, type, size });
    if (store.uploadDelayMs) await new Promise((resolve) => setTimeout(resolve, store.uploadDelayMs));
    if (store.failUploadNumber === n) throw new Error("simulated Cloudinary failure");
    return { url: `https://fake.cdn.test/${type.toLowerCase()}/${n}`, publicId: `${runTag}${n}` };
  };
  mediaStorage.destroy = async (publicId, type) => {
    store.destroys.push({ publicId, type });
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

function buildForm(files, { field = "media", text = fields } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(text)) form.append(k, v);
  for (const f of files) form.append(f.field || field, new Blob([f.buf], { type: f.type }), f.name);
  return form;
}
const create = (user, files, opts) => api("POST", "/items", { token: user?.token, form: buildForm(files, opts) });
const addMedia = (user, itemId, files) =>
  api("POST", `/items/${itemId}/media`, { token: user?.token, form: buildForm(files, { text: {} }) });
const removeMedia = (user, itemId, mediaId) => api("DELETE", `/items/${itemId}/media/${mediaId}`, { token: user?.token });
const itemCount = () => prisma.item.count({ where: { ownerId: O.id } });

// Runs `fn` and asserts that nothing was uploaded and no item was created.
async function expectNothingStored(fn) {
  const uploadsBefore = store.uploads.length;
  const itemsBefore = await itemCount();
  const r = await fn();
  assert.equal(store.uploads.length, uploadsBefore, "nothing must reach Cloudinary");
  assert.equal(await itemCount(), itemsBefore, "no item must be created");
  return r;
}

let multi; // item with 3 images, reused below

test("multiple images: kept in upload order, cover is the first image, no public ids exposed", async () => {
  const r = await create(O, [FILES.jpg(), FILES.png(), FILES.webp()]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  multi = r.data;
  assert.deepEqual(multi.media.map((m) => m.type), ["IMAGE", "IMAGE", "IMAGE"]);
  assert.deepEqual(multi.media.map((m) => m.sortOrder), [0, 1, 2]);
  const urls = store.uploads.slice(-3).map((u) => `https://fake.cdn.test/image/${u.n}`);
  assert.deepEqual(multi.media.map((m) => m.url), urls, "same order as sent");
  assert.equal(multi.imageUrl, urls[0]);
  assert.deepEqual(Object.keys(multi.media[0]).sort(), ["id", "sortOrder", "type", "url"]);

  const detail = await api("GET", `/items/${multi.id}`);
  assert.deepEqual(detail.data.media, multi.media);
  assert.ok(!JSON.stringify(detail.data).includes(runTag), "public ids never sent to clients");
  const rows = await prisma.itemMedia.findMany({ where: { itemId: multi.id } });
  assert.ok(rows.every((m) => m.publicId?.startsWith(runTag)), "public ids stored server-side");
});

test("image + video: order preserved, cover is the first image even if a video comes first", async () => {
  const r = await create(O, [FILES.mp4(), FILES.png(), FILES.webm()]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.media.map((m) => m.type), ["VIDEO", "IMAGE", "VIDEO"]);
  assert.deepEqual(r.data.media.map((m) => m.sortOrder), [0, 1, 2]);
  assert.equal(r.data.imageUrl, r.data.media[1].url);
});

let full; // 8 images + 2 videos
test("the maximum (8 images + 2 videos = 10) is accepted", async () => {
  const files = [...Array(8)].map(() => FILES.png()).concat([FILES.mp4(), FILES.webm()]);
  const r = await create(O, files);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  full = r.data;
  assert.equal(full.media.length, 10);
});

test("limits: too many images, videos or files are rejected before any upload", async () => {
  let r = await expectNothingStored(() => create(O, [...Array(9)].map(() => FILES.jpg())));
  assert.equal(r.status, 400);
  assert.match(r.data.errors.media, /at most 8 images/);

  r = await expectNothingStored(() => create(O, [FILES.mp4(), FILES.mp4(), FILES.webm()]));
  assert.equal(r.status, 400);
  assert.match(r.data.errors.media, /at most 2 videos/);

  r = await expectNothingStored(() =>
    create(O, [...Array(8)].map(() => FILES.png()).concat([FILES.mp4(), FILES.webm(), FILES.jpg()]))
  );
  assert.equal(r.status, 400, "11 files");

  // The legacy "image" field counts towards the same limits.
  const eight = [...Array(8)].map(() => FILES.png());
  r = await expectNothingStored(() => create(O, [...eight, { ...FILES.png(), field: "image" }]));
  assert.equal(r.status, 400);
});

test("size limits: images over 5 MB and videos over 50 MB", async () => {
  const bigImage = { ...FILES.png(), buf: pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 5 * 1024 * 1024 + 1) };
  let r = await expectNothingStored(() => create(O, [bigImage]));
  assert.equal(r.status, 413);
  assert.match(r.data.errors.media, /5 MB/);

  const bigVideo = { ...FILES.mp4(), buf: pad(Buffer.from("\0\0\0\x18ftypisom", "latin1"), 50 * 1024 * 1024 + 1) };
  r = await expectNothingStored(() => create(O, [bigVideo]));
  assert.equal(r.status, 413);
  assert.match(r.data.errors.media, /50 MB/);

  // Exactly at the image limit is fine.
  const maxImage = { ...FILES.png(), buf: pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 5 * 1024 * 1024) };
  assert.equal((await create(O, [maxImage])).status, 201);
});

test("invalid file types are rejected by declared type AND by actual content", async () => {
  const text = Buffer.from("just some text, definitely not an image or video");
  const cases = [
    ["plain text file", { buf: text, type: "text/plain", name: "notes.txt" }],
    ["SVG", { buf: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), type: "image/svg+xml", name: "x.svg" }],
    ["QuickTime by type", { buf: pad(Buffer.from("\0\0\0\x14ftypqt  ", "latin1")), type: "video/quicktime", name: "a.mov" }],
    ["text renamed to .png", { buf: text, type: "image/png", name: "fake.png" }],
    ["Windows .exe as .jpg", { buf: pad(Buffer.from("MZ\x90\0")), type: "image/jpeg", name: "evil.jpg" }],
    ["PNG content declared as video", named({ ...FILES.png(), type: "video/mp4" }, "fake.mp4")],
    ["MP4 content declared as image", named({ ...FILES.mp4(), type: "image/png" }, "fake.png")],
    ["QuickTime content as .mp4", { buf: pad(Buffer.from("\0\0\0\x14ftypqt  ", "latin1")), type: "video/mp4", name: "a.mp4" }],
    ["HEIC content as .mp4", { buf: pad(Buffer.from("\0\0\0\x18ftypheic", "latin1")), type: "video/mp4", name: "a.mp4" }],
    ["empty file", { buf: Buffer.alloc(0), type: "image/png", name: "empty.png" }],
  ];
  for (const [label, file] of cases) {
    const r = await expectNothingStored(() => create(O, [FILES.png(), file]));
    assert.equal(r.status, 400, `${label}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.errors.media, label);
  }
  const r = await expectNothingStored(() => create(O, [{ ...FILES.png(), field: "avatar" }]));
  assert.equal(r.status, 400, "unexpected field name");
});

test("invalid text fields are rejected before any upload", async () => {
  const r = await expectNothingStored(() =>
    create(O, [FILES.png(), FILES.mp4()], { text: { ...fields, title: "x", pricePerHour: "-5" } })
  );
  assert.equal(r.status, 400);
  assert.ok(r.data.errors.title && r.data.errors.pricePerHour);
});

test("backward compatibility: legacy 'image' field, no files, and imageUrl-only listings", async () => {
  let r = await create(O, [{ ...FILES.jpg(), field: "image" }]);
  assert.equal(r.status, 201);
  assert.equal(r.data.media.length, 1);
  assert.equal(r.data.imageUrl, r.data.media[0].url);

  r = await create(O, []);
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.media, []);
  assert.equal(r.data.imageUrl, null);

  // A listing from before media existed: only imageUrl, no media rows.
  const legacy = await prisma.item.create({
    data: {
      ...fields, pricePerHour: "99", ownerId: O.id,
      imageUrl: "https://res.cloudinary.com/demo/image/upload/v1/rentany_items/old.png",
    },
  });
  r = await api("GET", `/items/${legacy.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.imageUrl, legacy.imageUrl);
  assert.deepEqual(r.data.media, []);
  const list = await api("GET", "/items");
  assert.equal(list.data.find((i) => i.id === legacy.id).imageUrl, legacy.imageUrl);
});

test("owner can add media: appended in order, cover unchanged", async () => {
  const r = await addMedia(O, multi.id, [FILES.png(), FILES.mp4()]);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.deepEqual(r.data.media.map((m) => m.sortOrder), [0, 1, 2, 3, 4]);
  assert.deepEqual(r.data.media.slice(3).map((m) => m.type), ["IMAGE", "VIDEO"]);
  assert.equal(r.data.imageUrl, multi.imageUrl);
  assert.equal((await api("GET", `/items/${multi.id}`)).data.media.length, 5);

  assert.equal((await addMedia(O, multi.id, [])).status, 400, "no files");
});

test("adding media respects limits including what the item already has", async () => {
  let r = await expectNothingStored(() => addMedia(O, full.id, [FILES.png()]));
  assert.equal(r.status, 400);
  assert.match(r.data.errors.media, /at most 10/);
  const two = (await create(O, [FILES.mp4(), FILES.webm()])).data;
  r = await expectNothingStored(() => addMedia(O, two.id, [FILES.mp4()]));
  assert.equal(r.status, 400);
  assert.match(r.data.errors.media, /at most 2 videos/);
});

test("nobody but the owner can add or remove media", async () => {
  let r = await expectNothingStored(() => addMedia(R, multi.id, [FILES.png()]));
  assert.equal(r.status, 403);
  assert.equal((await addMedia(null, multi.id, [FILES.png()])).status, 401);
  assert.equal((await addMedia(O, 99999999, [FILES.png()])).status, 404);

  const target = multi.media[0];
  const destroysBefore = store.destroys.length;
  r = await removeMedia(R, multi.id, target.id);
  assert.equal(r.status, 403);
  assert.equal((await removeMedia(null, multi.id, target.id)).status, 401);
  assert.ok(await prisma.itemMedia.findUnique({ where: { id: target.id } }), "media still there");
  assert.equal(store.destroys.length, destroysBefore, "nothing deleted from Cloudinary");

  // Owner of both items, but the media belongs to the other one.
  r = await removeMedia(O, full.id, target.id);
  assert.equal(r.status, 404);
  assert.equal((await removeMedia(O, multi.id, 99999999)).status, 404);
  assert.equal((await removeMedia(O, multi.id, "abc")).status, 400);
});

test("owner removes media: Cloudinary asset deleted, cover moves to the next image", async () => {
  const before = (await api("GET", `/items/${multi.id}`)).data;
  const [first, second] = before.media;
  const firstRow = await prisma.itemMedia.findUnique({ where: { id: first.id } });

  let r = await removeMedia(O, multi.id, first.id);
  assert.equal(r.status, 200);
  assert.equal(r.data.media.length, before.media.length - 1);
  assert.equal(r.data.imageUrl, second.url, "cover is now the next image");
  assert.deepEqual(store.destroys.at(-1), { publicId: firstRow.publicId, type: "IMAGE" });

  const video = r.data.media.find((m) => m.type === "VIDEO");
  r = await removeMedia(O, multi.id, video.id);
  assert.equal(store.destroys.at(-1).type, "VIDEO");

  for (const m of r.data.media) r = await removeMedia(O, multi.id, m.id);
  assert.deepEqual(r.data.media, []);
  assert.equal(r.data.imageUrl, null, "no images left -> no cover");
});

test("a failed Cloudinary upload deletes the files that did upload and creates nothing", async () => {
  const itemsBefore = await itemCount();
  const destroysBefore = store.destroys.length;
  store.failUploadNumber = store.n + 2; // second of three
  const r = await create(O, [FILES.png(), FILES.jpg(), FILES.webp()]);
  store.failUploadNumber = null;
  assert.equal(r.status, 502);
  assert.equal(await itemCount(), itemsBefore);
  const uploadedOk = store.uploads.slice(-3).filter((u) => u.n !== store.n - 1).map((u) => `${runTag}${u.n}`);
  assert.deepEqual(store.destroys.slice(destroysBefore).map((d) => d.publicId).sort(), uploadedOk.sort());
});

test("a failed database write deletes the uploaded assets and leaves no item behind", async () => {
  const itemsBefore = await itemCount();
  const destroysBefore = store.destroys.length;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ItemMedia" ADD CONSTRAINT "test_tmp_block_media" CHECK ("sortOrder" < 0) NOT VALID`
  );
  let r;
  try {
    r = await create(O, [FILES.png(), FILES.mp4()]);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "ItemMedia" DROP CONSTRAINT IF EXISTS "test_tmp_block_media"`);
  }
  assert.equal(r.status, 500);
  assert.equal(await itemCount(), itemsBefore, "item insert rolled back with the media insert");
  const uploaded = store.uploads.slice(-2).map((u) => `${runTag}${u.n}`);
  assert.deepEqual(store.destroys.slice(destroysBefore).map((d) => d.publicId).sort(), uploaded.sort());
});

test("concurrent uploads can't push an item past its limits", async () => {
  const item = (await create(O, [...Array(7)].map(() => FILES.png()))).data;
  const destroysBefore = store.destroys.length;
  const uploadsBefore = store.uploads.length;
  // Slow uploads make both requests pass the quick pre-check, so the limit
  // has to be enforced by the locked re-check inside the transaction.
  store.uploadDelayMs = 300;
  let results;
  try {
    results = await Promise.all([addMedia(O, item.id, [FILES.jpg()]), addMedia(O, item.id, [FILES.webp()])]);
  } finally {
    store.uploadDelayMs = 0;
  }
  assert.equal(store.uploads.length - uploadsBefore, 2, "both passed the pre-check and uploaded");
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
  const images = await prisma.itemMedia.count({ where: { itemId: item.id, type: "IMAGE" } });
  assert.equal(images, 8);
  assert.equal(store.destroys.length - destroysBefore, 1, "the losing upload was deleted from Cloudinary");
});

test("temporary upload files are always removed", async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(fs.readdirSync(TEMP_DIR), []);
});
