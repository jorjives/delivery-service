// Writes an invoice as CSV for the old accounts package.
export function invoiceToCsv(lines) {
  return lines.map((line) => `${line.description},${line.quantity},${line.unitPrice}`).join("\n");
}
