import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { DEFAULT_BUDGETS } from "../src/budgets.js";
import { create } from "../src/case-file.js";
import { cleanGitEnv } from "../src/git-env.js";
import { signedOut } from "../src/mock-session.js";
import type { MockExpectation } from "../src/testing.js";
import type { TaskDef } from "../src/schema.js";

export const REPO_ROOT = join(import.meta.dirname, "..");

/** A fresh temp dir per call; every dir this file made is removed after its tests finish. */
export function useScratch(): (prefix: string) => string {
  const scratches: string[] = [];
  afterAll(() => {
    for (const path of scratches) rmSync(path, { recursive: true, force: true });
  });
  return (prefix: string) => {
    const path = mkdtempSync(join(tmpdir(), prefix));
    scratches.push(path);
    return path;
  };
}

/**
 * Run a git command against a working copy, with a clean, deterministic git env.
 * Stderr is captured (it stays on the thrown error), so a probe that is expected
 * to fail does not print `fatal: ...` into an otherwise green test run.
 */
export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", env: cleanGitEnv(), stdio: "pipe" }).trim();
}

/** `npm pack` the checkout into `destination` (as `npm publish` would) and return the tarball's path. */
export function packTarball(destination: string): string {
  const [{ filename }] = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }),
  ) as [{ filename: string }];
  return join(destination, filename);
}

/** Paths (tracked by git) matching an extended-regex pattern, scoped to the given pathspecs. */
export function gitGrepFiles(pattern: string, scope: string[]): string[] {
  try {
    return execFileSync("git", ["grep", "-l", "-E", pattern, "--", ...scope], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      env: cleanGitEnv(),
    })
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    if ((err as { status?: number }).status === 1) return []; // git grep found nothing
    throw err;
  }
}

export function runTsx(args: string[], env?: NodeJS.ProcessEnv): { stdout: string; stderr: string; status: number } {
  const { stdout, stderr, status } = spawnSync("npx", ["tsx", ...args], { cwd: REPO_ROOT, encoding: "utf-8", env });
  return { stdout, stderr, status: status ?? 1 };
}

/** Slices a UAT demo's numbered console output between two section headings. */
export function sectionOf(stdout: string, from: string, to?: string): string {
  const start = stdout.indexOf(from);
  return to ? stdout.slice(start, stdout.indexOf(to)) : stdout.slice(start);
}

/** A guide's fenced ```ts block whose first line is `// <name>`, exactly as a reader copies it. */
export function snippetFrom(guide: string, name: string): string {
  const start = guide.indexOf("```ts\n// " + name + "\n");
  if (start === -1) throw new Error(`the guide has no \`\`\`ts block starting with // ${name}`);
  const body = start + "```ts\n".length;
  return guide.slice(body, guide.indexOf("```", body));
}

/** A fresh case file directory for one surface asked to do `taskDef`, as a closer is handed it. */
export async function caseDir(surfaceId: string, taskDef: TaskDef): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "case-"));
  await create(dir, { surfaceId, taskDef, gateRef: { type: "command", command: "true", parseMode: "exitcode" } }, DEFAULT_BUDGETS);
  return dir;
}

/** The compiled `delivery` command, as `npm run build` leaves it. */
export const DELIVERY_BIN = join(REPO_ROOT, "dist", "cli", "main.js");

/** Run the compiled `delivery` command as a person would, signed out of the real runtime, capturing what it prints and how it exits. */
export function runDelivery(
  args: string[],
  { cwd = REPO_ROOT, env = process.env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { stdout: string; stderr: string; status: number | null } {
  if (!existsSync(DELIVERY_BIN)) {
    throw new Error("dist/cli/main.js is missing: run `npm run build` (npm test does this for you)");
  }
  const { stdout, stderr, status } = spawnSync(process.execPath, [DELIVERY_BIN, ...args], { cwd, env: signedOut(env), encoding: "utf-8" });
  return { stdout, stderr, status };
}

/** A guide section's first ```text block: what the guide says you will see, blank lines dropped. */
export function outputBlock(section: string): string[] {
  const match = /```text\n([\s\S]*?)```/.exec(section);
  if (!match?.[1]) throw new Error(`no \`\`\`text block in:\n${section}`);
  return match[1].split("\n").filter(Boolean);
}

/** One line a guide shows, as a pattern: `<run-id>`, `<when>`, `<path>` and `[<task-pos>/...]` stand for the parts that differ every run. */
export function documented(line: string): RegExp {
  // Replace placeholders with temp markers to avoid escaping regex metacharacters
  const pattern = line
    .replaceAll("<task-pos>", "<<<TASKPOS>>>")
    .replaceAll("<run-id>", "<<<RUNID>>>")
    .replaceAll("<when>", "<<<WHEN>>>")
    .replaceAll("<path>", "<<<PATH>>>");

  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped.replaceAll("<<<TASKPOS>>>", "\\d+").replaceAll("<<<RUNID>>>", "\\S+").replaceAll("<<<WHEN>>>", ".+").replaceAll("<<<PATH>>>", "[\\S]+")}$`,
    "m",
  );
}

/** A scripted turn that answers one task by adding a module and its passing test, so `npm test` passes. */
export function adds(intent: string, name: string, body: string, check: string): MockExpectation {
  return {
    when: { promptContains: intent },
    effects: [
      { write: { path: `${name}.js`, content: `export const ${name} = ${body};\n` } },
      {
        write: {
          path: `${name}.test.js`,
          content: `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { ${name} } from "./${name}.js";\n\ntest("${name}", () => ${check});\n`,
        },
      },
    ],
    json: { status: "completed", rationale: `added ${name}.js and its test` },
  };
}
