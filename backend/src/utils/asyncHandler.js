// Wraps an async route handler so any thrown/rejected error reaches the
// central error middleware instead of needing try/catch in every controller.
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
