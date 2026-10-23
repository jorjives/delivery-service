import { fieldOf, valueAt, type Issue } from "../schema-issues.js";
import type { PackProblem } from "./manifest.js";
import type { FindWorkflow, PackManifest, PackWorkflow } from "./pack-format.js";

/** Names quoted and joined as an English list, `"a" and "b"` or `"a", "b" and "c"`. Given two or more. */
function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * The mistakes a delivery.pack/3 manifest can make that its shape does not catch: exactly one find; every idea
 * names an act; every act is offered by a find; and an act a find chooses between has a summary. Every rule is
 * checked, so an author sees them all at once.
 */
export function ruleProblems(file: string, manifest: PackManifest): PackProblem[] {
  const entries = Object.entries(manifest.workflows);
  const finds = entries.filter((entry): entry is [string, FindWorkflow] => entry[1].kind === "find");
  const acts = entries.filter(([, workflow]) => workflow.kind === "act").map(([name]) => name);
  const actsOf = (ideasFor: readonly string[]): string[] => [...new Set(ideasFor)].filter((name) => acts.includes(name));
  const problems: PackProblem[] = [];
  const problem = (field: string, message: string): void => {
    problems.push({ file, field, message });
  };

  if (finds.length !== 1) {
    const holds = finds.length === 0 ? "none" : `${finds.length} (${finds.map(([name]) => `"${name}"`).join(", ")})`;
    problem("workflows", `"workflows" must hold exactly one workflow with "kind": "find", but it holds ${holds}`);
  }

  for (const [name, find] of finds) {
    find.ideasFor.forEach((target, index) => {
      const field = `workflows.${name}.ideasFor.${index}`;
      const named: PackWorkflow | undefined = manifest.workflows[target];
      if (named?.kind === "act") return;
      if (named?.kind === "find") problem(field, `"${field}" is a find workflow; it can only offer act workflows`);
      else if (acts.length === 0) problem(field, `"${field}" is "${target}", but this pack has no act workflows`);
      else problem(field, `"${field}" is "${target}", but this pack's act workflows are: ${acts.join(", ")}`);
    });
  }

  const offered = new Set(finds.flatMap(([, find]) => find.ideasFor));
  for (const act of acts) {
    if (!offered.has(act)) {
      problem(`workflows.${act}`, `"workflows.${act}" is not listed in any find workflow's "ideasFor", so no idea could reach it`);
    }
  }

  for (const [name, workflow] of entries) {
    if (workflow.kind !== "act" || workflow.summary !== undefined) continue;
    const needer = finds.find(([, find]) => find.ideasFor.includes(name) && actsOf(find.ideasFor).length > 1);
    if (needer === undefined) continue;
    const [findName, find] = needer;
    const field = `workflows.${name}.summary`;
    problem(field, `"${field}" is missing: the find workflow "${findName}" needs it to choose between ${quotedList(actsOf(find.ideasFor))}`);
  }
  return problems;
}

/**
 * The sentence for a key a delivery.pack/3 pack puts where the format does not allow it, where that key has a
 * sentence of its own. Undefined means the generic data-only sentence serves.
 */
export function formatSentence(issue: Issue, raw: unknown): string | undefined {
  if (issue.code !== "unrecognized_keys") return undefined;
  const key = issue.keys[0];
  const field = `"${fieldOf(issue)}"`;
  if (issue.path.length === 0 && key === "settings") return `${field} is reserved for pack settings, which this harness does not read yet`;
  if (issue.path.length !== 2 || issue.path[0] !== "workflows") return undefined;
  const kind = valueAt(raw, [...issue.path, "kind"]);
  if (kind === "find" && (key === "summary" || key === "guards" || key === "hold")) return `${field} is only for act workflows`;
  if (kind === "act" && key === "ideasFor") return `${field} is only for find workflows`;
  return undefined;
}
