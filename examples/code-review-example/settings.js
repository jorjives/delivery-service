import { readFileSync } from "node:fs";

/** The shop's settings, from a JSON file. */
export function loadSettings(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}
