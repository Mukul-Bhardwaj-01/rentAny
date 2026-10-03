import { Router } from "express";
import { listDepositClaims, resolveDepositClaim, retryRefund } from "../controllers/admin.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireAdmin } from "../middleware/admin.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { listClaimsValidator, resolveClaimValidator, idParamValidator } from "../validators/payment.validators.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Admin API only (no admin UI yet). Admins are designated in the database.
const router = Router();
router.use(requireAuth, asyncHandler(requireAdmin));

router.get("/deposit-claims", validate(listClaimsValidator, "query"), asyncHandler(listDepositClaims));
router.post(
  "/deposit-claims/:id/resolve",
  validate(idParamValidator, "params"),
  validate(resolveClaimValidator),
  asyncHandler(resolveDepositClaim)
);
router.post("/refunds/:id/retry", validate(idParamValidator, "params"), asyncHandler(retryRefund));

export default router;
