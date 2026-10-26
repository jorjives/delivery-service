import { join } from "node:path";
import { showName } from "../packs/hidden-characters.js";
import { isBuiltInPack, type Pack } from "../packs/manifest.js";
import type { DeliveryConfig } from "./config.js";

/** Where a pack a project uses came from: a built-in pack, a folder the project lists, or an npm package the owner added. */
export type PackSide =
  | { kind: "built-in"; pack: string }
  | { kind: "folder"; pack: string; manifestFile: string }
  | { kind: "installed"; pack: string; package: string; version: string };

/** Where a clashing name was defined: the project's own configuration, or a pack. */
export type ClashSide = { kind: "own" } | PackSide;

/** Two things that cannot both be used: two packs with one name, or one workflow name defined twice. */
export type Clash = { kind: "pack-name"; name: string; first: ClashSide; second: PackSide } | { kind: "workflow"; workflow: string; first: ClashSide; second: PackSide };

export function sideOf(pack: Pack): PackSide {
  if (isBuiltInPack(pack.dir)) return { kind: "built-in", pack: pack.manifest.name };
  if (pack.origin.kind === "installed") return { kind: "installed", pack: pack.manifest.name, package: pack.origin.package, version: pack.origin.version };
  return { kind: "folder", pack: pack.manifest.name, manifestFile: join(pack.dir, "pack.json") };
}

/**
 * The first clash among the config's own workflows and `packs`, in this order: a listed or added pack named like a
 * built-in; an added pack named like an earlier pack; then a workflow name defined twice, the config's own first, then
 * each pack's workflows in pack order. Undefined when nothing clashes.
 */
export function findClash(config: DeliveryConfig, packs: readonly Pack[]): Clash | undefined {
  const builtIns = packs.filter((pack) => isBuiltInPack(pack.dir));
  const others = packs.filter((pack) => !isBuiltInPack(pack.dir));
  for (const pack of others) {
    const builtIn = builtIns.find((candidate) => candidate.manifest.name === pack.manifest.name);
    if (builtIn !== undefined) return { kind: "pack-name", name: pack.manifest.name, first: sideOf(builtIn), second: sideOf(pack) };
  }
  for (const [index, pack] of others.entries()) {
    if (pack.origin.kind !== "installed") continue;
    const earlier = others.slice(0, index).find((candidate) => candidate.manifest.name === pack.manifest.name);
    if (earlier !== undefined) return { kind: "pack-name", name: pack.manifest.name, first: sideOf(earlier), second: sideOf(pack) };
  }
  const defined = new Map<string, ClashSide>();
  for (const name of Object.keys(config.workflows ?? {})) defined.set(name, { kind: "own" });
  for (const pack of packs) {
    for (const name of Object.keys(pack.workflows)) {
      const first = defined.get(name);
      if (first !== undefined) return { kind: "workflow", workflow: name, first, second: sideOf(pack) };
      defined.set(name, sideOf(pack));
    }
  }
  return undefined;
}

export function sidePhrase(side: ClashSide): string {
  switch (side.kind) {
    case "own":
      return "a workflow in your configuration";
    case "built-in":
      return `"${side.pack}", a pack that comes with the harness`;
    case "folder":
      return `the pack in ${showName(side.manifestFile)}`;
    case "installed":
      return `the pack added from ${showName(side.package)} ${showName(side.version)}`;
  }
}

/** What the owner does to keep one side, by the side that was defined first, and by the side that was defined second. */
function remedyFor(first: ClashSide, second: PackSide): string {
  switch (first.kind) {
    case "own":
      return "Rename your own workflow so each name is used once.";
    case "folder":
      return "To keep the second, take the first out of packs in your configuration.";
    case "installed":
      return `To keep the second, remove the first with: delivery packs remove ${first.pack}`;
    case "built-in":
      return second.kind === "installed"
        ? `A pack that comes with the harness cannot be removed, so remove the added one: delivery packs remove ${second.pack}`
        : `A pack that comes with the harness cannot be removed, so change the "name" of the second so each pack is named once.`;
  }
}

export const clashField = (clash: Clash): "packs" | "workflows" => (clash.first.kind === "own" ? "workflows" : "packs");

export const builtInPackClash = (name: string, manifestFile: string): string =>
  `The pack in ${manifestFile} is named "${name}", the name of a pack that comes with the harness: change its "name" so each pack is named once.`;

export const builtInWorkflowClash = (workflow: string, builtIn: string): string =>
  `The workflow "${workflow}" in your configuration has the name of a workflow in "${builtIn}", a pack that comes with the harness: rename your workflow so each name is used once.`;

export const packWorkflowClash = (workflow: string, first: ClashSide, second: PackSide): string =>
  `Two things define the workflow "${workflow}": ${sidePhrase(first)}, and ${sidePhrase(second)}. ${remedyFor(first, second)}`;

export const packNameClash = (name: string, first: ClashSide, second: PackSide): string =>
  `Two packs are named "${name}": ${sidePhrase(first)}, and ${sidePhrase(second)}. ${remedyFor(first, second)}`;

/** The sentence that says a clash plainly, naming both sides and how to keep one of them. */
export function clashSentence(clash: Clash): string {
  const { first, second } = clash;
  if (clash.kind === "pack-name") {
    if (first.kind === "built-in" && second.kind === "folder") return builtInPackClash(clash.name, showName(second.manifestFile));
    return packNameClash(clash.name, first, second);
  }
  if (first.kind === "own" && second.kind === "built-in") return builtInWorkflowClash(clash.workflow, second.pack);
  return packWorkflowClash(clash.workflow, first, second);
}
