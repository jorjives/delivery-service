import { relative } from "node:path";
import type { LockEntry } from "../packs/install/lock.js";
import type { PackageSpec } from "../packs/install/pack-spec.js";
import type { FetchedPackage } from "../packs/install/pack-source.js";
import type { ArchiveProblem, PackageRead } from "../packs/install/package-archive.js";
import type { PackProblem } from "../packs/manifest.js";
import type { ConfirmQuestion } from "./init.js";
import { problemLines, wrap } from "./packs-inspect-render.js";

/** The last line when an owner says no, or does not answer. */
export const NOTHING_ADDED = "Nothing was added.";

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

/** The refusal when nothing is there to ask the owner: the account has been shown, and nothing was written. */
export function nobodyToAsk(): string[] {
  return [
    ...wrap("Not added: nothing here can ask you.", ""),
    ...wrap("Run the command in a terminal to read the account and answer.", "  "),
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
export function archiveRefusal(packageName: string, version: string, problem: ArchiveProblem): string[] {
  return [
    ...wrap(`Not added: ${packageName} ${version}`, ""),
    ...wrap(`${problem.entry ?? "The package"} ${problem.message}.`, "  ", "    "),
    ...wrap("Nothing was changed.", "  "),
  ];
}

/** The pack folder is refused: each problem is named by its path inside the package, which is the pack folder's path plus the file's. */
export function packRefusal(packageName: string, version: string, packPath: string, problems: readonly PackProblem[], stagedDir: string): string[] {
  const inPackage = (file: string): string => (packPath === "." ? relative(stagedDir, file) : `${packPath}/${relative(stagedDir, file)}`);
  return [
    ...wrap(`Not added: ${packageName} ${version} holds a pack that cannot be used.`, ""),
    ...problemLines(problems, inPackage),
    ...wrap("Nothing was changed.", "  "),
  ];
}
