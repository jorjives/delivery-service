import { readFileSync } from "node:fs";

export function loadSettings(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}
