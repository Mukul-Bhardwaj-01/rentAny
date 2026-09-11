import { Router } from "express";
import { getItems, getItemById, getMyItems, createItem } from "../controllers/item.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { upload } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/", getItems);
router.get("/mine", requireAuth, getMyItems);
router.get("/:id", getItemById);
router.post("/", requireAuth, upload.single("image"), createItem);

export default router;
