// Formats a date in UTC with a pattern of dd, MM, yyyy, HH and mm.
const pad = (n) => String(n).padStart(2, "0");

export function format(date, pattern) {
  const parts = {
    dd: pad(date.getUTCDate()),
    MM: pad(date.getUTCMonth() + 1),
    yyyy: String(date.getUTCFullYear()),
    HH: pad(date.getUTCHours()),
    mm: pad(date.getUTCMinutes()),
  };
  return pattern.replace(/dd|MM|yyyy|HH|mm/g, (token) => parts[token]);
}
