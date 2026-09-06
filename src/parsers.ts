import type { Assertion } from "./schema.js";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const TAP_LINE = /^(ok|not ok)\s+(\d+)(?:\s+-\s+(.*))?$/;

export function parseTap(output: string): Assertion[] {
  const assertions: Assertion[] = [];

  for (const line of output.split("\n")) {
    const m = TAP_LINE.exec(line.trim());
    if (!m) continue;

    const status = m[1];
    const num = m[2];
    if (status === undefined || num === undefined) continue;
    const desc = m[3];
    const id = desc ? `${num} - ${desc}` : num;

    assertions.push({
      id,
      outcome: status === "ok" ? "PASS" : "FAIL",
      detail: line.trim(),
    });
  }

  if (assertions.length === 0) {
    throw new ParseError("ParseError: no TAP test lines found in output");
  }

  return assertions;
}

// Minimal XML extraction — not a full parser, just enough for JUnit testcase elements.
// ponytail: regex XML extraction; upgrade to a streaming parser if nested CDATA or
// namespaced elements become real inputs.

const TESTCASE_OPEN = /<testcase\s([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const ATTR = /(\w+)="([^"]*)"/g;

interface TestcaseAttrs {
  classname?: string;
  name?: string;
}

function extractAttr(tag: string): TestcaseAttrs {
  const attrs: TestcaseAttrs = {};
  let m: RegExpExecArray | null;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(tag)) !== null) {
    const key = m[1];
    const val = m[2];
    if (key === undefined || val === undefined) continue;
    if (key === "classname") attrs.classname = val;
    if (key === "name") attrs.name = val;
  }
  return attrs;
}

export function parseJunit(output: string): Assertion[] {
  // Quick sanity check — JUnit output should contain at least one angle bracket
  if (!output.includes("<")) {
    throw new ParseError("ParseError: input does not look like XML");
  }

  const assertions: Assertion[] = [];
  let match: RegExpExecArray | null;
  TESTCASE_OPEN.lastIndex = 0;

  while ((match = TESTCASE_OPEN.exec(output)) !== null) {
    const attrStr = match[1];
    const body = match[2] ?? "";
    if (attrStr === undefined) continue;
    const attrs = extractAttr(attrStr);

    const name = attrs.name;
    if (!name) continue;

    const id = attrs.classname ? `${attrs.classname}::${name}` : name;

    const tag = body.includes("<error") ? "error" : body.includes("<failure") ? "failure" : null;
    const outcome: "PASS" | "FAIL" | "ERROR" = tag === "error" ? "ERROR" : tag === "failure" ? "FAIL" : "PASS";
    const detail = tag ? (/message="([^"]*)"/.exec(body)?.[1] ?? tag) : id;

    assertions.push({ id, outcome, detail });
  }

  if (assertions.length === 0) {
    throw new ParseError("ParseError: no <testcase> elements found in JUnit XML");
  }

  return assertions;
}

export function parseExitCode(command: string, exitCode: number): Assertion[] {
  return [{
    id: `exit:${command}`,
    outcome: exitCode === 0 ? "PASS" : "FAIL",
    detail: `exit code ${exitCode}`,
  }];
}

export class DuplicateIdError extends Error {
  constructor(readonly duplicateId: string) {
    super(`DuplicateIdError: assertion ID "${duplicateId}" appears more than once`);
    this.name = "DuplicateIdError";
  }
}

export function validateUniqueIds(assertions: Assertion[]): void {
  const seen = new Set<string>();
  for (const a of assertions) {
    if (seen.has(a.id)) throw new DuplicateIdError(a.id);
    seen.add(a.id);
  }
}
