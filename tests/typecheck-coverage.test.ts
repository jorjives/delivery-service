import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

// `npm run lint`'s tsc step only guards what the tsconfig includes. When demos
// and tests sit outside it they compile nowhere, so a signature change can go
// green with broken call sites behind it.
const tracked = execFileSync("git", ["ls-files", "*.ts"], { cwd: REPO_ROOT, encoding: "utf-8" })
  .split("\n")
  .filter(Boolean);

const compiled = new Set(
  execFileSync("npx", ["tsc", "-p", "tsconfig.json", "--listFilesOnly"], { cwd: REPO_ROOT, encoding: "utf-8" })
    .split("\n")
    .filter(Boolean)
    .map((file) => relative(REPO_ROOT, file)),
);

describe("type-check coverage", () => {
  it.each(tracked)("%s is type-checked by tsconfig.json", (file) => {
    expect(compiled.has(file)).toBe(true);
  });
});
