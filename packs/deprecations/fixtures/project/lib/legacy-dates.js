/**
 * Writes a date as day/month/year, such as 1/2/2026.
 * @deprecated Replaced by formatDate in lib/dates.js, which writes the same thing.
 */
export function legacyFormat(date) {
  return [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()].join("/");
}
