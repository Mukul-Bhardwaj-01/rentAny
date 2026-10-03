// Razorpay Standard Checkout, loaded from Razorpay's CDN (it can't be
// bundled). Only the public key id and a server-created order are used here;
// the result is always re-checked by our backend.
const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";
let loading = null;

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;
        reject(new Error("Couldn't load Razorpay. Check your connection and try again."));
      };
      document.body.appendChild(script);
    });
  }
  return loading;
}

// Opens Checkout for an order from POST /bookings/:id/payment/order.
// Resolves to { status: "success", response } | { status: "dismissed", error? }.
export async function openCheckout(order) {
  await loadRazorpay();
  return new Promise((resolve) => {
    let lastError = null;
    // Close Checkout when the payment deadline passes.
    const secondsLeft = Math.floor((new Date(order.paymentDueAt) - Date.now()) / 1000);
    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: order.name,
      description: order.description,
      prefill: order.prefill,
      notes: { bookingId: String(order.bookingId) },
      theme: { color: "#0f172a" },
      ...(secondsLeft > 60 ? { timeout: secondsLeft } : {}),
      handler: (response) => resolve({ status: "success", response }),
      modal: { ondismiss: () => resolve({ status: "dismissed", error: lastError }) },
    });
    // A failed attempt keeps Checkout open so the renter can retry there.
    rzp.on("payment.failed", (resp) => {
      lastError = resp?.error?.description || "The payment failed";
    });
    rzp.open();
  });
}
