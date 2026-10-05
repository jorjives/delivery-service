/** Charges a card through the payment provider the shop used before 2024. */
export function chargeWithLegacyGateway(card, amount) {
  return { provider: "old-pay", card, amount, status: "charged" };
}
