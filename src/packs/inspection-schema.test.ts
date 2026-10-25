import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { publishedKeys } from "../report/json-schema.js";
import { builtInPacks } from "./manifest.js";
import { INSPECTION_SCHEMA, inspectionOf, inspectionRefusal, inspectionSchema, NO_PROJECT } from "./inspection.js";

const schema = inspectionSchema();
const published = z.fromJSONSchema(schema);
const overTheWire = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
const inspections = (await builtInPacks()).map((pack) => inspectionOf(pack, NO_PROJECT, [], null));

it("names its version", () => expect(schema.title).toBe("delivery.pack-inspection/1"));

it("accepts the account of every built-in pack and a refusal", () => {
  for (const i of inspections) expect(published.safeParse(overTheWire(i)).error).toBeUndefined();
  expect(published.safeParse(overTheWire(inspectionRefusal([{ file: "/p/pack.json", field: null, message: "is missing" }]))).success).toBe(true);
});

it("still accepts an account with a key a later release added", () => {
  expect(published.safeParse({ ...(overTheWire(inspections[0]) as object), later: [] }).success).toBe(true);
});

it("refuses an account that lacks a published key, or holds another kind of value under one", () => {
  const doc = overTheWire(inspections[0]) as Record<string, unknown>;
  const without = { ...doc };
  delete without.findings;
  expect(published.safeParse(without).success).toBe(false);
  expect(published.safeParse({ ...doc, workflows: "none" }).success).toBe(false);
});

it("leaves no key optional", () => expect(publishedKeys(schema, INSPECTION_SCHEMA).filter((l) => l.endsWith("(optional)"))).toEqual([]));

describe("the inspection's stability promise", () => {
  const promised = readFileSync(new URL("./pack-inspection-published-keys.txt", import.meta.url), "utf-8").trimEnd().split("\n");
  const current = publishedKeys(schema, INSPECTION_SCHEMA);
  it("keeps every key and name ever published, each the kind of value it was", () => expect(promised.filter((l) => !current.includes(l))).toEqual([]));
  it("puts every key and name published now under the promise: add its line to pack-inspection-published-keys.txt", () => expect(current.filter((l) => !promised.includes(l))).toEqual([]));
  it("promises what install will compare: the version, the fingerprint and the raw instructions", () =>
    expect(promised).toEqual(expect.arrayContaining([
      'delivery.pack-inspection/1.schema = "delivery.pack-inspection/1"',
      "delivery.pack-inspection/1.pack.hash: string",
      "delivery.pack-inspection/1.workflows[].steps[].instructions.authored: string",
    ])));
});
