import { z } from "zod";
import { REPORT_SCHEMA, ReportDocument } from "./document.js";
import { EVENT_SCHEMA, ReportEvent, UnknownEvent } from "./events.js";

/** A JSON Schema, as plain data. */
export type JsonSchema = { [key: string]: unknown };

/**
 * One format's schema as a consumer is to hold data to it: generated from the
 * definition that validates the data, and open, so data from a later release
 * of the same version still passes. No object forbids a key it does not name,
 * and a value that is one of a set of names is published as a string with the
 * names known today as examples: a release may add a key or a name, and never
 * removes or re-types one.
 */
export function openSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, {
    // The shape before parsing: zod's own output shape forbids every key it does not name.
    io: "input",
    override: ({ jsonSchema }) => {
      if (jsonSchema.enum !== undefined) {
        jsonSchema.examples = jsonSchema.enum;
        delete jsonSchema.enum;
      }
      // An event is told apart by its `type`, and one of a type this schema does not name matches only the last branch.
      if (jsonSchema.oneOf !== undefined) {
        jsonSchema.anyOf = jsonSchema.oneOf;
        delete jsonSchema.oneOf;
      }
    },
  });
}

/** The published schema of both formats, each under the version it names itself by: what `delivery report --schema` prints. */
export function publishedSchema(): Record<typeof REPORT_SCHEMA | typeof EVENT_SCHEMA, JsonSchema> {
  return { [REPORT_SCHEMA]: openSchema(ReportDocument), [EVENT_SCHEMA]: openSchema(z.union([ReportEvent, UnknownEvent])) };
}

const isObject = (value: unknown): value is JsonSchema => typeof value === "object" && value !== null && !Array.isArray(value);

/** The kinds of value a schema node allows, as one word: "string", "integer|null", "object". */
function kindOf(node: JsonSchema): string {
  const branches = node.anyOf as JsonSchema[] | undefined;
  if (branches) return [...new Set(branches.flatMap((branch) => kindOf(branch).split("|")))].sort().join("|");
  if (node.const !== undefined) return typeof node.const;
  if (Array.isArray(node.type)) return [...(node.type as string[])].sort().join("|");
  return typeof node.type === "string" ? node.type : "any";
}

function linesOf(schema: JsonSchema, path: string): string[] {
  const lines: string[] = [];
  if (schema.const !== undefined) lines.push(`${path} = ${JSON.stringify(schema.const)}`);
  for (const name of (schema.examples as unknown[] | undefined) ?? []) lines.push(`${path} = ${JSON.stringify(name)}`);
  const required = (schema.required as string[] | undefined) ?? [];
  for (const [key, child] of Object.entries(isObject(schema.properties) ? schema.properties : {})) {
    // A key that may be left out says so: every published key is always present, and making one optional breaks that.
    if (isObject(child)) lines.push(`${path}.${key}: ${kindOf(child)}${required.includes(key) ? "" : " (optional)"}`, ...linesOf(child, `${path}.${key}`));
  }
  if (isObject(schema.items)) lines.push(`${path}[]: ${kindOf(schema.items)}`, ...linesOf(schema.items, `${path}[]`));
  if (isObject(schema.additionalProperties)) lines.push(`${path}.*: ${kindOf(schema.additionalProperties)}`, ...linesOf(schema.additionalProperties, `${path}.*`));
  for (const branch of (schema.anyOf as JsonSchema[] | undefined) ?? []) {
    // An event's branch is known by the type it names, so one type's keys never read as another's.
    const type = isObject(branch.properties) && isObject(branch.properties.type) ? branch.properties.type.const : undefined;
    lines.push(...linesOf(branch, typeof type === "string" ? `${path}<${type}>` : path));
  }
  return lines;
}

/**
 * Everything a published schema promises, one line each and sorted: every key
 * by its path with the kind of value it holds (`$.surfaces[].attempts: integer`),
 * and every name a value may take today (`$.kind = "list"`). The stability
 * promise is that no line of this ever goes away within a version.
 */
export const publishedKeys = (schema: JsonSchema, path = "$"): string[] => [...new Set(linesOf(schema, path))].sort();
