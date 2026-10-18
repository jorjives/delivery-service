import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test support: a stand-in for `systemctl`, the same swap-the-executable approach gh-stand-in takes, so `delivery
 * schedule` can be exercised without touching the contributor's own systemd. It records every call, answers `show`
 * with the properties a test sets, and, after `noBus()`, fails every call as systemctl does with no user manager.
 * Plain sh using builtins only, so it runs whatever PATH the test gives.
 */
export interface SystemctlStandIn {
  /** Absolute path of the stand-in executable. */
  command: string;
  /** Each call's arguments, space-joined, oldest first. */
  calls(): string[];
  /** Fail every later call as systemctl does on a machine with no user manager running. */
  noBus(): void;
  /** What every later `show` prints. */
  showing(properties: Record<string, string>): void;
}

const SCRIPT = String.raw`#!/bin/sh
d=${"${0%/*}"}
printf '%s\n' "$*" >> "$d/calls.log"
if [ -f "$d/no-bus" ]; then
  printf 'Failed to connect to bus: No medium found\n' >&2
  exit 1
fi
if [ "$2" = show ] && [ -f "$d/show.txt" ]; then
  while IFS= read -r line; do printf '%s\n' "$line"; done < "$d/show.txt"
fi
exit 0
`;

export function createSystemctlStandIn(): SystemctlStandIn {
  const dir = mkdtempSync(join(tmpdir(), "systemctl-stand-in-"));
  const command = join(dir, "systemctl");
  writeFileSync(command, SCRIPT, { mode: 0o755 });
  const log = join(dir, "calls.log");
  return {
    command,
    calls: () => (existsSync(log) ? readFileSync(log, "utf-8").split("\n").filter(Boolean) : []),
    noBus: () => writeFileSync(join(dir, "no-bus"), ""),
    showing: (properties) =>
      writeFileSync(join(dir, "show.txt"), Object.entries(properties).map(([key, value]) => `${key}=${value}\n`).join("")),
  };
}
