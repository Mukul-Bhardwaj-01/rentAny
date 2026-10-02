import { Router } from "express";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../controllers/notification.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { listNotificationsValidator, notificationIdValidator } from "../validators/notification.validators.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// Every notification route needs a logged-in user. There is no POST here:
// notifications are only created server-side by booking actions.
router.use(requireAuth);

router.get("/", validate(listNotificationsValidator, "query"), asyncHandler(getNotifications));
router.get("/unread-count", asyncHandler(getUnreadCount));
router.patch("/read-all", asyncHandler(markAllAsRead));
router.patch("/:id/read", validate(notificationIdValidator, "params"), asyncHandler(markAsRead));

export default router;
