import type { CloserRef, GateRef } from "../schema.js";
import type { DeliveryConfig } from "./config.js";
import type { ProjectSettings } from "./settings.js";

/** What the check does, as a person reads it. Total over the gate types, so a new one does not compile until it can be described. */
function gatePhrase(gateRef: GateRef): string {
  switch (gateRef.type) {
    case "command":
      return `runs \`${gateRef.command}\``;
    case "custom":
      return `your own check, in \`${gateRef.modulePath}\``;
  }
}

/** What happens to work that passes, as a person reads it. Total over the closer types, as `outcome.ts`'s `landing` is. */
function closerPhrase(closerRef: CloserRef): string {
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

/**
 * How many things the file asks for. No task at all is not a problem: `delivery
 * run --task "..."` names one each time, which is how the harness is used before
 * a project has a list.
 */
function tasksPhrase(config: DeliveryConfig): string {
  if (config.tasks) return `${config.tasks.length} ${config.tasks.length === 1 ? "task" : "tasks"} queued`;
  if (config.task) return "1 task, set in `task`";
  return 'no tasks listed: name one when you run, with `delivery run --task "..."`';
}

/**
 * One line per thing `validate` checked, in the owner's terms: the description,
 * the tasks, what the check runs and what the closing action does. The check
 * and closing action are the ones a run would use, inferred and defaulted
 * values included, so what is reported is what would happen.
 */
export function checkedLines(config: DeliveryConfig, project: ProjectSettings): string[] {
  return [
    `domain description: ${project.domainPrompt === undefined ? "none (it's optional)" : "present"}`,
    tasksPhrase(config),
    `gate: ${gatePhrase(project.gateRef)}`,
    `closer: ${closerPhrase(project.closerRef)}`,
  ].map((line) => `✓ ${line}`);
}
