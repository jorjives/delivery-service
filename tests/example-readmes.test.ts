// The example READMEs tell a reader which `delivery` commands to run. A command the tool
// no longer has stops the reader dead, so every `delivery <command>` they name must be one
// `delivery --help` lists.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, runDelivery } from "./helpers.js";

const READMES = ["examples/code-review-example/README.md", "examples/no-tests-example/README.md", "examples/moves-pack/README.md"];

/** The commands `delivery --help` lists under "Commands:". */
function listedCommands(): Set<string> {
  const { stdout } = runDelivery(["--help"]);
  const lines = stdout.split("\n");
  const rest = lines.slice(lines.indexOf("Commands:") + 1);
  return new Set(rest.flatMap((line) => /^ {2}(\S+)/.exec(line)?.[1] ?? []));
}

/** Each command word in `delivery <word>` as the README writes it, in code spans and code blocks. */
function namedCommands(readme: string): string[] {
  return [...readme.matchAll(/\bdelivery ([a-z][a-z-]*)/g)].map((match) => match[1] as string);
}

describe("the example READMEs", () => {
  const listed = listedCommands();

  it.each(READMES)("%s names only commands that delivery --help lists", (path) => {
    const unknown = [...new Set(namedCommands(readFileSync(join(REPO_ROOT, path), "utf-8")))].filter((name) => !listed.has(name));
    expect(unknown).toEqual([]);
  });
});
