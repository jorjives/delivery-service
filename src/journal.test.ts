import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLine, atomicWriteJson, MalformedLine, parseLines } from "./journal.js";

const scratch = () => mkdtempSync(join(tmpdir(), "journal-"));
const asNumber = (value: unknown): number => {
  if (typeof value !== "number") throw new Error(`not a number: ${JSON.stringify(value)}`);
  return value;
};

describe("reading a journal back", () => {
  it("is empty for a journal nothing was appended to", () => {
    expect(parseLines("", asNumber)).toEqual([]);
  });

  it("gives every line back, oldest first", () => {
    expect(parseLines("1\n2\n3\n", asNumber)).toEqual([1, 2, 3]);
  });

  it("drops a final line cut short by a crash mid-append", () => {
    expect(parseLines('1\n2\n{"t":', asNumber)).toEqual([1, 2]);
  });

  it("drops a final line that parses but is not an entry, as a torn write can leave", () => {
    expect(parseLines('1\n"x"', asNumber)).toEqual([1]);
  });

  it("refuses a bad line anywhere but the end, naming the line", () => {
    expect(() => parseLines('1\n{"t":\n3\n', asNumber)).toThrow(MalformedLine);
    expect(() => parseLines('1\n{"t":\n3\n', asNumber)).toThrow(/^Malformed log entry at line 2: /);
  });
});

describe("writing a journal", () => {
  it("appends one JSON line per value", async () => {
    const file = join(scratch(), "log.jsonl");
    await appendLine(file, { t: "a" });
    await appendLine(file, { t: "b" });
    expect(readFileSync(file, "utf-8")).toBe('{"t":"a"}\n{"t":"b"}\n');
  });

  it("replaces a JSON file whole, leaving no temporary file behind", async () => {
    const dir = scratch();
    await atomicWriteJson(join(dir, "run.json"), { a: 1 });
    await atomicWriteJson(join(dir, "run.json"), { a: 2 });
    expect(JSON.parse(readFileSync(join(dir, "run.json"), "utf-8"))).toEqual({ a: 2 });
    expect(readdirSync(dir)).toEqual(["run.json"]);
  });
});
