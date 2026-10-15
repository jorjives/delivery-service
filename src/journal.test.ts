import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLine, atomicWrite, atomicWriteJson, MalformedLine, parseLines } from "./journal.js";

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

  it("replaces a text file whole, with the permissions asked for, leaving no temporary file behind", async () => {
    const dir = scratch();
    await atomicWrite(join(dir, "report.txt"), "first\n", 0o600);
    await atomicWrite(join(dir, "report.txt"), "second\n", 0o600);
    expect(readFileSync(join(dir, "report.txt"), "utf-8")).toBe("second\n");
    expect(statSync(join(dir, "report.txt")).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["report.txt"]);
  });

  it("survives two writers racing on the same path, as two concurrent fence-wrapper writes for the same project do", async () => {
    const dir = scratch();
    const file = join(dir, "wrapper.sh");
    // Both writers hold the same content, as two tasks of the same run do when the
    // fence hashes to the same wrapper script: only their rename targets collide.
    const results = await Promise.allSettled([atomicWrite(file, "same content\n"), atomicWrite(file, "same content\n")]);
    for (const result of results) expect(result.status).toBe("fulfilled");
    expect(readFileSync(file, "utf-8")).toBe("same content\n");
    expect(readdirSync(dir)).toEqual(["wrapper.sh"]);
  });
});
