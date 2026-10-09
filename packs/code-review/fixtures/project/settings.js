import { readFileSync } from "node:fs";

export function readSettings(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}
