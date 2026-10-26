import { relative } from "node:path";
import { showName } from "../packs/hidden-characters.js";
import type { LockEntry } from "../packs/install/lock.js";
import type { PackageSpec } from "../packs/install/pack-spec.js";
import type { FetchedPackage } from "../packs/install/pack-source.js";
import type { ArchiveProblem, PackageRead } from "../packs/install/package-archive.js";
import type { PackProblem } from "../packs/manifest.js";
import { type Clash, type ClashSide, sidePhrase } from "./pack-clash.js";
import type { ConfirmQuestion } from "./init.js";
import { problemLines } from "./packs-inspect-render.js";
import { wrap } from "./text-wrap.js";

/** The last line when an owner says no, or does not answer. */
export const NOTHING_ADDED = "Nothing was added.";

/** Whether a pack is being added to the project, or updated in it: the refusals say which. */
export type PackAction = "add" | "update";

/** The actions a fingerprint is asked for: a pack added, updated, or approved as it stands. */
export type ApprovalAction = PackAction | "approve";

/** The lead of a refusal, by the action that was refused. */
const NOT_DONE: Record<ApprovalAction, string> = { add: "Not added:", update: "Not updated:", approve: "Not approved:" };

/** The second side of a clash: the pack being added, or the new version of the pack being updated. */
const NEW_SIDE: Record<PackAction, string> = { add: "the pack you are adding", update: "the new version" };

/** What the owner is asked to read, before answering, by the action that was refused. */
const READ_BEFORE_ANSWER: Record<ApprovalAction, string> = { add: "account", update: "change", approve: "account" };

/** The package's name, version and what nothing will do before the owner answers: nothing is added, and nothing from the package runs. */
export function foundLines(fetched: FetchedPackage, spec: PackageSpec): string[] {
  const found = spec.typed && spec.request !== fetched.version ? ` (found for ${spec.request})` : "";
  return [
    ...wrap(`Found ${fetched.name} on npm.`, ""),
    ...wrap(`Version: ${fetched.version}${found}`, "  "),
    ...wrap("Nothing is added until you say yes. Nothing from the package is run: its install scripts and its own dependencies are never used.", ""),
  ];
}

const bytesOf = (count: number): string => `${count} ${count === 1 ? "byte" : "bytes"}`;

/** The things a package declares, as a plain list: "a", "a and b", "a, b and c". */
function declaredList(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The files in the package that are not kept, and what the package declares that delivery-service will not run. Empty when there are neither. */
export function notInPackLines(read: Extract<PackageRead, { ok: true }>): string[] {
  const listed =
    read.ignored.length === 0
      ? []
      : [
          "In the package, not part of the pack",
          "  Not kept, and not read:",
          ...read.ignored.flatMap(({ path, bytes }) => wrap(`${path}, ${bytesOf(bytes)}`, "  ", "    ")),
        ];
  const declared =
    read.declares.length === 0 ? [] : wrap(`It declares ${declaredList(read.declares)}; delivery-service does not run or install them.`, "  ");
  return [...listed, ...declared];
}

/** The one question the owner is asked before anything is written: no is the default. */
export const addQuestion = (name: string, version: string): ConfirmQuestion => ({ message: `Add ${name} ${version} to this project?`, default: false });

/** What was written, and the two items to commit, with the commands to see the pack again. */
export const addedLines = (name: string, version: string): string[] => [
  `Added ${name} ${version}.`,
  "  Recorded: .delivery/packs.lock.json",
  `  Kept as:  .delivery/packs/${name}`,
  "Commit both, so everyone gets this same pack.",
  "See its workflows:  delivery packs",
  `Read it again:      delivery packs inspect ${name}`,
];

/** A word of the owner's own arguments as a shell reads it: as typed when a shell would leave it alone, else single-quoted. */
export function shellWord(word: string): string {
  return /^[A-Za-z0-9@/._^~:+-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * The refusal when nothing is there to ask the owner: the account has been shown, and nothing was written. The command is
 * the one to run again with the fingerprint the owner read, and it is never wrapped: a wrap at a space would break the paste.
 * The fingerprint's second half starts at column 0, so the backslash and the line break after the first half join as one word.
 */
export function nobodyToAsk(action: ApprovalAction, command: string, hash: string): string[] {
  return [
    ...wrap(`${NOT_DONE[action]} nothing here can ask you.`, ""),
    ...wrap(`Read the ${READ_BEFORE_ANSWER[action]} above, then ${action} it with the fingerprint you read:`, "  "),
    `    ${command} \\`,
    `      --approve ${hash.slice(0, 32)}\\`,
    hash.slice(32),
    ...wrap("The command is refused if the pack has a different fingerprint.", "  "),
    ...wrap("Nothing was changed.", "  "),
  ];
}

/** The refusal when the fingerprint given is not the one shown: nothing is changed, and the owner reads the account again. */
export function fingerprintDiffers(action: ApprovalAction): string[] {
  return [
    ...wrap(`${NOT_DONE[action]} the fingerprint given is not the one shown above.`, ""),
    ...wrap(`Read the ${READ_BEFORE_ANSWER[action]} again before you give it.`, "  "),
    ...wrap("Nothing was changed.", "  "),
  ];
}

/** The pack is already in the project at the same content, from the same package: there is nothing to do. */
export const alreadyAdded = (name: string, version: string): string => `${name} is already added at ${version}. Nothing to do.`;

/** The pack's name is taken by a pack already added from elsewhere, with other contents: nothing is changed. */
export function addedDifferently(name: string, entry: LockEntry): string[] {
  return [
    ...wrap(`Not added: a pack named ${name} is already added,`, ""),
    ...wrap(`from ${entry.package} ${entry.version}, with other contents.`, "  "),
    ...wrap("Nothing was changed.", "  "),
  ];
}

/** The package itself is refused: the problem is named by its path inside the package, or is about the whole package. */
export function archiveRefusal(action: PackAction, packageName: string, version: string, problem: ArchiveProblem): string[] {
  return [
    ...wrap(`${NOT_DONE[action]} ${packageName} ${version}`, ""),
    ...wrap(`${problem.entry ?? "The package"} ${problem.message}.`, "  ", "    "),
    ...wrap("Nothing was changed.", "  "),
  ];
}

/** The pack folder is refused: each problem is named by its path inside the package, which is the pack folder's path plus the file's. */
export function packRefusal(action: PackAction, packageName: string, version: string, packPath: string, problems: readonly PackProblem[], stagedDir: string): string[] {
  const inPackage = (file: string): string => (packPath === "." ? relative(stagedDir, file) : `${packPath}/${relative(stagedDir, file)}`);
  return [
    ...wrap(`${NOT_DONE[action]} ${packageName} ${version} holds a pack that cannot be used.`, ""),
    ...problemLines(problems, inPackage),
    ...wrap("Nothing was changed.", "  "),
  ];
}

/**
 * The screen when the pack being added clashes with one already in the project: both sides named, and the one thing the
 * owner does to keep the new pack. Nothing is changed. The second side is always the pack being added.
 */
export function clashRefusal(action: PackAction, clash: Clash, repoPath: string): string[] {
  const { first, second } = clash;
  if (second.kind !== "installed") throw new Error("the pack being added must be the second side of a clash");
  const side = first.kind === "folder" ? { ...first, manifestFile: relative(repoPath, first.manifestFile) } : first;
  const subject = clash.kind === "pack-name" ? `two packs are named "${showName(clash.name)}".` : `two things define the workflow "${showName(clash.workflow)}".`;
  const once = clash.kind === "pack-name" ? "Each pack name must be used once." : "Each workflow name must be used once.";
  return [
    ...wrap(`${NOT_DONE[action]} ${subject}`, ""),
    ...wrap(`1. ${sidePhrase(side)}`, "  ", "     "),
    ...wrap(`2. ${NEW_SIDE[action]}, from ${showName(second.package)} ${showName(second.version)}`, "  ", "     "),
    ...wrap(once, ""),
    ...remedyLines(first),
    ...wrap("Nothing was changed.", ""),
  ];
}

/** How the owner keeps the new pack, by the side that was defined first. */
function remedyLines(first: ClashSide): string[] {
  switch (first.kind) {
    case "installed":
      return ["  To keep the new pack, remove the first:", `    delivery packs remove ${showName(first.pack)}`];
    case "folder":
      return wrap("To keep the new pack, take the first out of packs in your configuration.", "  ");
    case "built-in":
      return wrap("A pack that comes with the harness cannot be removed, so ask the authors of the new pack to rename it.", "  ");
    case "own":
      return ["  To keep the new pack, rename your own workflow."];
  }
}
