/** The lockfile the vulnerable-version check reads: npm's, at the top of the project. */
// ponytail: the top-level npm lockfile only; a workspace's own lockfile, yarn.lock or pnpm-lock.yaml is not read. Add a reader per format when a pack needs one.
export const LOCKFILE = "package-lock.json";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function inDependencies(deps: Record<string, unknown>, name: string, version: string): boolean {
  return Object.entries(deps).some(
    ([key, entry]) => isRecord(entry) && ((key === name && entry.version === version) || (isRecord(entry.dependencies) && inDependencies(entry.dependencies, name, version))),
  );
}

/**
 * Whether an npm lockfile installs `name` at exactly `version` anywhere in the
 * tree: v2 and v3 list every install under `packages` by its folder, v1 nests
 * them under `dependencies`. Undefined when the text is not a lockfile, so a
 * caller can never read "cannot tell" as "not installed".
 */
export function lockfileHas(text: string, name: string, version: string): boolean | undefined {
  let lock: unknown;
  try {
    lock = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(lock)) return undefined;
  if (isRecord(lock.packages)) {
    return Object.entries(lock.packages).some(([key, entry]) => (key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`)) && isRecord(entry) && entry.version === version);
  }
  if (isRecord(lock.dependencies)) return inDependencies(lock.dependencies, name, version);
  return undefined;
}
