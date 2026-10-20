// A shopping basket: lines of { price, quantity }, prices in pence.
export function total(lines) {
  return lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
}
