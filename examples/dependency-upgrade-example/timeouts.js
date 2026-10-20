import ms from "ms";

// Reads a timeout written as "30s" or "5m" in a settings file, in milliseconds.
export function timeout(setting) {
  const value = ms(setting);
  if (value === undefined) throw new Error(`not a duration: ${setting}`);
  return value;
}
