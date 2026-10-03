import { raiseClaim, acceptClaim, disputeClaim, withdrawClaim } from "../utils/deposits.js";
import { paymentSummary } from "./payment.controller.js";

// POST /api/bookings/:id/deposit/claims  (owner, within 48 h of the return)
export async function createClaim(req, res) {
  const claim = await raiseClaim(req.params.id, req.userId, req.body);
  res.status(201).json({ claimId: claim.id, ...(await paymentSummary(req.params.id, req.userId)) });
}

// POST /api/bookings/:id/deposit/claims/:claimId/accept  (renter)
export async function acceptDepositClaim(req, res) {
  await acceptClaim(req.params.id, req.params.claimId, req.userId);
  res.json(await paymentSummary(req.params.id, req.userId));
}

// POST /api/bookings/:id/deposit/claims/:claimId/dispute  (renter)  body: { response }
export async function disputeDepositClaim(req, res) {
  await disputeClaim(req.params.id, req.params.claimId, req.userId, req.body.response);
  res.json(await paymentSummary(req.params.id, req.userId));
}

// POST /api/bookings/:id/deposit/claims/:claimId/withdraw  (owner)
export async function withdrawDepositClaim(req, res) {
  await withdrawClaim(req.params.id, req.params.claimId, req.userId);
  res.json(await paymentSummary(req.params.id, req.userId));
}
