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

    const status = m[1]!;
    const num = m[2]!;
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
