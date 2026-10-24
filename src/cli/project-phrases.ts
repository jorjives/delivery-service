import type { CloserRef, GateRef } from "../schema.js";
import { presetPhrase } from "./gate-presets.js";
import type { ProjectSettings } from "./settings.js";

/** What the check does, as a person reads it. Total over the gate types, so a new one does not compile until it can be described. */
function gatePhrase(gateRef: GateRef): string {
  switch (gateRef.type) {
    case "command": {
      const after = gateRef.setup === undefined ? "" : `, after \`${gateRef.setup}\``;
      const then = gateRef.teardown === undefined ? "" : `, then \`${gateRef.teardown}\``;
      return `runs \`${gateRef.command}\`${after}${then}`;
    }
    case "custom":
      return `your own check, in \`${gateRef.modulePath}\``;
  }
}

/** The check a run would use, by name when the file chose a ready-made one and nothing on the command line replaced it. */
export function gateLine({ gateRef, gatePreset }: ProjectSettings): string {
  return gatePreset !== undefined && gateRef.type === "command" ? presetPhrase(gatePreset, gateRef.command) : gatePhrase(gateRef);
}

/** What happens to work that passes, as a person reads it. Total over the closer types, as `outcome.ts`'s `landing` is. */
export function closerPhrase(closerRef: CloserRef): string {
  switch (closerRef.type) {
    case "commit-to-branch":
      return "commits to a new branch";
    case "merge-back":
      return "merges into your base branch";
    case "open-pr":
      return "opens a pull request";
    case "custom":
      return `your own closing action, in \`${closerRef.modulePath}\``;
  }
}
