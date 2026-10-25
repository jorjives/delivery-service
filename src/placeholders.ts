import type { TaskDef } from "./schema.js";

/** One renderer for both placeholder namespaces, so the grammar has one owner: `{{task.<field>}}` and `{{settings.<name>}}`. */
const TASK_PLACEHOLDER = /\{\{task\.([A-Za-z0-9_]+)\}\}/g;
const SETTING_PLACEHOLDER = /\{\{settings\.([a-z0-9][a-z0-9-]*)\}\}/g;

/** A field's text: a string as it is, a number or boolean as written, and anything else (object, array, null) as compact JSON. */
function fieldText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

/** Fills `{{task.<field>}}` placeholders from the task's own fields, leaving an unmatched placeholder as written. */
export function renderTask(prompt: string, taskDef: TaskDef): string {
  return prompt.replace(TASK_PLACEHOLDER, (placeholder, field: string) => (taskDef[field] === undefined ? placeholder : fieldText(taskDef[field])));
}

/** The `{{task.<field>}}` placeholders in a prompt that the task has no field for, as written and without repeats. */
export function unmatchedTaskPlaceholders(prompt: string, taskDef: TaskDef): string[] {
  const unmatched = [...prompt.matchAll(TASK_PLACEHOLDER)].filter(([, field]) => taskDef[field as string] === undefined).map(([placeholder]) => placeholder);
  return [...new Set(unmatched)];
}

/** Fills `{{settings.<name>}}` placeholders that have a value, in one pass, leaving any other placeholder as written. */
export function renderSettings(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(SETTING_PLACEHOLDER, (placeholder, name: string) => {
    return Object.hasOwn(values, name) ? (values[name] as string) : placeholder;
  });
}

/** The setting names a text uses, in first-use order and without repeats. */
export function settingNamesIn(text: string): string[] {
  return [...new Set([...text.matchAll(SETTING_PLACEHOLDER)].map(([, name]) => name as string))];
}
