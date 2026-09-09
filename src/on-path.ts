import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** True if an executable of this name is found on `PATH`. */
export function isOnPath(name: string): boolean {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir !== "" && existsSync(join(dir, name)));
}
