import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PackLockInvalid } from "../../errors.js";
import { publishedKeys } from "../../report/json-schema.js";
import { builtInPacks } from "../manifest.js";
import {
  fingerprintOf,
  packsLockPath,
  packsLockSchema,
  PACKS_LOCK_SCHEMA,
  putLockEntry,
  readLock,
  serialiseLock,
  type LockEntry,
} from "./lock.js";

const repo = (): string => mkdtempSync(join(tmpdir(), "lock-repo-"));

const entry = (name: string): LockEntry => ({
  source: "npm",
  package: `@acme/${name}`,
  request: "latest",
  version: "1.0.0",
  integrity: "sha512-abc",
  fingerprint: `delivery.pack-hash/1:${"a".repeat(64)}`,
  approved: `delivery.pack-hash/1:${"a".repeat(64)}`,
});

it("is empty when no pack has been added", async () => expect(await readLock(repo())).toEqual({ schema: "delivery.packs-lock/1", packs: {} }));

it("writes an entry and reads it back", async () => {
  const dir = repo();
  await putLockEntry(dir, "docs", entry("docs"));
  expect(await readLock(dir)).toEqual({ schema: "delivery.packs-lock/1", packs: { docs: entry("docs") } });
});

it("writes the same bytes for the same entries in any order, with sorted keys and a final newline", async () => {
  const forward = repo();
  await putLockEntry(forward, "b", entry("b"));
  await putLockEntry(forward, "a", entry("a"));
  const backward = repo();
  await putLockEntry(backward, "a", entry("a"));
  await putLockEntry(backward, "b", entry("b"));
  const bytes = readFileSync(packsLockPath(forward), "utf-8");
  expect(readFileSync(packsLockPath(backward), "utf-8")).toBe(bytes);
  expect(bytes.endsWith("\n")).toBe(true);
  expect(Object.keys(JSON.parse(bytes).packs)).toEqual(["a", "b"]);
  expect(serialiseLock(JSON.parse(bytes))).toBe(bytes);
});

it("refuses a record that is not JSON, has an unknown key, or a fingerprint without its label, naming the field", async () => {
  const notJson = repo();
  mkdirSync(join(notJson, ".delivery"));
  writeFileSync(packsLockPath(notJson), "{ not json");
  await expect(readLock(notJson)).rejects.toBeInstanceOf(PackLockInvalid);

  const unknownKey = repo();
  mkdirSync(join(unknownKey, ".delivery"));
  writeFileSync(packsLockPath(unknownKey), JSON.stringify({ schema: "delivery.packs-lock/1", packs: {}, extra: 1 }));
  await expect(readLock(unknownKey)).rejects.toBeInstanceOf(PackLockInvalid);

  const unlabelled = repo();
  mkdirSync(join(unlabelled, ".delivery"));
  writeFileSync(
    packsLockPath(unlabelled),
    JSON.stringify({ schema: "delivery.packs-lock/1", packs: { x: { ...entry("x"), fingerprint: "a".repeat(64) } } }),
  );
  const failure = await readLock(unlabelled).catch((err: unknown) => err);
  expect(failure).toBeInstanceOf(PackLockInvalid);
  expect((failure as PackLockInvalid).field).toBe("packs.x.fingerprint");
});

it("shows an unknown key with its control characters escaped, so a hostile record cannot drive the terminal", async () => {
  const hostile = repo();
  mkdirSync(join(hostile, ".delivery"));
  writeFileSync(packsLockPath(hostile), JSON.stringify({ schema: "delivery.packs-lock/1", packs: {}, "\u001b[2Jx": 1 }));
  const failure = (await readLock(hostile).catch((err: unknown) => err)) as PackLockInvalid;
  expect(failure).toBeInstanceOf(PackLockInvalid);
  // eslint-disable-next-line no-control-regex
  expect(failure.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
});

it("refuses a record from a newer delivery-service with the upgrade sentence", async () => {
  const dir = repo();
  mkdirSync(join(dir, ".delivery"));
  writeFileSync(packsLockPath(dir), JSON.stringify({ schema: "delivery.packs-lock/2", packs: {} }));
  const failure = await readLock(dir).catch((err: unknown) => err);
  expect(failure).toBeInstanceOf(PackLockInvalid);
  expect((failure as PackLockInvalid).detail).toContain("upgrade delivery-service");
});

it("labels a pack's fingerprint with its rule version", async () => {
  const code = (await builtInPacks())[0];
  if (code === undefined) throw new Error("no built-in packs");
  expect(fingerprintOf(code)).toBe(`delivery.pack-hash/1:${code.hash}`);
});

it("serialises two writers instead of losing one", async () => {
  const dir = repo();
  await Promise.all([putLockEntry(dir, "a", entry("a")), putLockEntry(dir, "b", entry("b"))]);
  expect(Object.keys((await readLock(dir)).packs)).toEqual(["a", "b"]);
});

describe("the record's stability promise", () => {
  const promised = readFileSync(new URL("./packs-lock-published-keys.txt", import.meta.url), "utf-8").trimEnd().split("\n");
  const current = publishedKeys(packsLockSchema(), PACKS_LOCK_SCHEMA);
  it("keeps every key and name ever published, each the kind of value it was", () => expect(promised.filter((l) => !current.includes(l))).toEqual([]));
  it("puts every key and name published now under the promise: add its line to packs-lock-published-keys.txt", () =>
    expect(current.filter((l) => !promised.includes(l))).toEqual([]));
  it("leaves no key optional", () => expect(current.filter((l) => l.endsWith("(optional)"))).toEqual([]));
});
