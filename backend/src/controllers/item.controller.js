import prisma from "../config/prisma.js";
import { AppError } from "../utils/AppError.js";

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
    // No phone here: contact details are shared only once a booking is accepted.
    include: { owner: { select: { id: true, name: true } } },
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

// POST /api/items  (requires requireAuth + upload.single("image") + createItemValidator)
export async function createItem(req, res) {
  const { title, description, category, pricePerHour, location } = req.body;

  const item = await prisma.item.create({
    data: {
      title,
      description,
      category,
      pricePerHour,
      location,
      imageUrl: req.file ? req.file.path : null,
      ownerId: req.userId,
    },
  });

  res.status(201).json(item);
}
