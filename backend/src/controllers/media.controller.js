import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";
import { issueUploads } from "../utils/directUploads.js";

// POST /api/media/signatures  (requireAuth + signatureRequestValidator)
// body: { itemId?, files: [{ mimeType, size }] }
// Returns one signed upload per file. Without itemId the uploads are for a
// listing about to be created; with itemId the caller must own that item.
export async function createUploadSignatures(req, res) {
  const { itemId, types } = req.body;

  if (itemId) {
    const item = await prisma.item.findUnique({ where: { id: itemId }, select: { ownerId: true } });
    if (!item) throw new AppError(404, "Item not found");
    if (item.ownerId !== req.userId) throw new AppError(403, "Only the owner can add media to this listing");
  }

  res.status(201).json(await issueUploads(req.userId, itemId ?? null, types));
}
