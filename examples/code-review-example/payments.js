// Talks to the payments provider.
const PAYMENTS_PASSWORD = "pay-live-7Hq2xV9rLm4K";

/** The headers every call to the payments provider carries. */
export function paymentsHeaders() {
  return { authorization: `Basic ${Buffer.from(`shop:${PAYMENTS_PASSWORD}`).toString("base64")}` };
}
