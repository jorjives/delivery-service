import { z } from "zod";
import { CloserRef, GateRef, TaskDef } from "../schema.js";

/** The one filename family a project uses, and the forms it may take. A `.js` or `.mjs` file exports the same object, for a project that computes a value. */
export const CONFIG_BASENAME = "delivery.config";
export const CONFIG_EXTENSIONS = [".json", ".js", ".mjs"] as const;

/** The four keys a config file takes, as the sentence a refusal ends with. */
export const CONFIG_KEYS = "`task`, `gate`, `closer` and `budgets`";

/** The closer types a person can name without a module path of their own, from the library's own list so the two can never disagree. */
export const BUILT_IN_CLOSERS: string[] = CloserRef.options
  .map((option) => option.shape.type.value)
  .filter((type) => type !== "custom");

/** A closer type the harness does not know, answered with the choices rather than with a schema complaint. */
export function unknownCloser(type: unknown): string {
  const named = typeof type === "string" && type !== "" ? `the closer type \`${type}\`` : "that closer type";
  const quoted = BUILT_IN_CLOSERS.map((choice) => `\`${choice}\``);
  const choices = `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
  return (
    `I don't know ${named}. The built-in choices are ${choices}. ` +
    `To use your own, put \`{ "type": "custom", "modulePath": "./closers/mine.js" }\` in ${CONFIG_BASENAME}.json.`
  );
}

/**
 * Caps only, one per attempt category, each optional and merged over the
 * default set. `used` is never here: usage is counted from the run's own log,
 * so a config file that could set it could lie about what a run had spent.
 */
export const Budgets = z
  .object({
    correction: z.number().int().positive(),
    gateError: z.number().int().positive(),
    gateMaintenance: z.number().int().positive(),
    terminus: z.number().int().positive(),
    close: z.number().int().positive(),
  })
  .partial()
  .strict();
export type Budgets = z.infer<typeof Budgets>;

/**
 * The whole of a `delivery.config.json`. `task`, `gate` and `closer` are the
 * library's own schemas, composed rather than restated, so the file can never
 * drift from what the harness accepts. `.strict()` on both objects means a typo
 * is named rather than silently ignored.
 */
export const DeliveryConfig = z
  .object({
    task: TaskDef.optional(),
    gate: GateRef.optional(),
    closer: CloserRef.optional(),
    budgets: Budgets.optional(),
  })
  .strict();
export type DeliveryConfig = z.infer<typeof DeliveryConfig>;

/** The value the file actually held at an issue's path, so a complaint can quote it back. */
function valueAt(raw: unknown, path: readonly PropertyKey[]): unknown {
  let here: unknown = raw;
  for (const step of path) {
    if (typeof here !== "object" || here === null) return undefined;
    here = (here as Record<PropertyKey, unknown>)[step];
  }
  return here;
}

/**
 * One plain-language sentence about the first thing wrong with a config file,
 * naming the key or the value. The first issue is enough: a person fixes one
 * thing and runs again, and a list of schema complaints is the stack trace this
 * command exists to avoid.
 */
export function describeProblem(file: string, error: z.ZodError, raw: unknown): string {
  const issue = error.issues[0];
  if (!issue) return `I can't use ${file}.`;
  const where = issue.path.join(".");

  if (issue.code === "unrecognized_keys") {
    const takes = where === "" ? `A config file takes only ${CONFIG_KEYS}.` : `\`${where}\` doesn't take it.`;
    return `I can't use ${file}: there's no setting called \`${issue.keys[0]}\`. ${takes}`;
  }
  if (where === "closer.type") return unknownCloser(valueAt(raw, issue.path));
  if (issue.path[0] === "budgets" && issue.path.length > 1) {
    return (
      `I can't use ${file}: the limit \`${where}\` is \`${JSON.stringify(valueAt(raw, issue.path))}\`. ` +
      `A limit is a whole number of attempts, 1 or more.`
    );
  }
  return `I can't use ${file}: the setting \`${where || "(the file itself)"}\` is \`${JSON.stringify(valueAt(raw, issue.path))}\` (${issue.message}).`;
}
