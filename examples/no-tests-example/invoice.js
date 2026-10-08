// Works out what a customer owes.

export function lineTotal(quantity, unitPrice) {
  return quantity * unitPrice;
}

export function invoiceTotal(lines, taxPercent) {
  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line.quantity, line.unitPrice), 0);
  return subtotal + (subtotal * taxPercent) / 100;
}

// The discount is a percentage, like the tax.
export function applyDiscount(total, discountPercent) {
  return total - total * discountPercent;
}
