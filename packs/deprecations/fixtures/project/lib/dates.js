/** Writes a date as day/month/year, such as 1/2/2026. It replaces legacyFormat, which writes the same text. */
export function formatDate(date) {
  return [date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()].join("/");
}

/** Writes a date as year-month-day, such as 2026-02-01. */
export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}
