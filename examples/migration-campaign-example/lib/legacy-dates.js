// Deprecated: use format() from ./dates.js instead. See docs/MIGRATION.md.
const pad = (n) => String(n).padStart(2, "0");

export function formatDate(date) {
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

export function formatDateTime(date) {
  return `${formatDate(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
