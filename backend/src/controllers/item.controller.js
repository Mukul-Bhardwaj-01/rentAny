import prisma from "../config/prisma.js";

// GET /api/items?search=drill&category=Tools
// Public: browse/search all available items.
export async function getItems(req, res) {
  try {
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
  } catch (err) {
    res.status(500).json({ message: "Could not fetch items", error: err.message });
  }
}

// GET /api/items/:id
export async function getItemById(req, res) {
  try {
    const item = await prisma.item.findUnique({
      where: { id: Number(req.params.id) },
      include: { owner: { select: { id: true, name: true, phone: true } } },
    });

    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: "Could not fetch item", error: err.message });
  }
}

// GET /api/items/mine  (requires requireAuth)
export async function getMyItems(req, res) {
  try {
    const items = await prisma.item.findMany({
      where: { ownerId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: "Could not fetch your listings", error: err.message });
  }
}

// POST /api/items  (requires requireAuth + upload.single("image"))
export async function createItem(req, res) {
  try {
    const { title, description, category, pricePerHour, location } = req.body;

    if (!title || !description || !category || !pricePerHour || !location) {
      return res.status(400).json({ message: "All fields except image are required" });
    }

    const item = await prisma.item.create({
      data: {
        title,
        description,
        category,
        pricePerHour: parseFloat(pricePerHour),
        location,
        imageUrl: req.file ? req.file.path : null,
        ownerId: req.userId,
      },
    });

    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ message: "Could not create item", error: err.message });
  }
}
