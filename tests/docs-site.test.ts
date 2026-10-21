// The docs site lists its pages by hand (nav, llms.txt sections) and the command
// reference is grouped by task rather than generated, so two things can drift:
// a page missing from one list, and a command or option the reference never names.
// These tests fail when either happens.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT, runDelivery } from "./helpers.js";

const config = parse(readFileSync(join(REPO_ROOT, "mkdocs.yml"), "utf-8"), { logLevel: "error" }) as {
  exclude_docs: string;
  markdown_extensions: Array<string | Record<string, { custom_fences?: Array<{ name: string }> }>>;
  nav: unknown;
  plugins: Array<string | Record<string, { sections: Record<string, string[]> }>>;
};

/** Every page path under a nav entry, however deeply it is nested. */
function navPages(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(navPages);
  if (node && typeof node === "object") return Object.values(node).flatMap(navPages);
  return [];
}

const excluded = config.exclude_docs.split("\n").map((line) => line.trim()).filter(Boolean);
const pages = readdirSync(join(REPO_ROOT, "docs"))
  .filter((name) => name.endsWith(".md") && !excluded.includes(name))
  .sort();
const llmsPlugin = config.plugins.find((plugin) => typeof plugin === "object" && "llmstxt" in plugin) as
  | { llmstxt: { sections: Record<string, string[]> } }
  | undefined;

describe("the docs site", () => {
  it("lists every published page in the nav", () => {
    const listed = new Set(navPages(config.nav));
    expect(pages.filter((page) => !listed.has(page))).toEqual([]);
  });

  it("lists every published page in the llms.txt sections", () => {
    const listed = new Set(Object.values(llmsPlugin?.llmstxt.sections ?? {}).flat());
    expect(pages.filter((page) => !listed.has(page))).toEqual([]);
  });
});

// Flows are drawn, not just described: Mermaid blocks in the Markdown, rendered
// by the theme. Each page below explains a flow a reader may want to follow.
describe("the diagrams", () => {
  const diagramPages: string[] = ["concepts.md", "work-a-backlog.md", "task-packs.md"];
  const fence = "```mermaid";

  it("are rendered by the site", () => {
    const superfences = config.markdown_extensions.find((ext) => typeof ext === "object" && "pymdownx.superfences" in ext) as
      | { "pymdownx.superfences": { custom_fences?: Array<{ name: string }> } }
      | undefined;
    expect(superfences?.["pymdownx.superfences"].custom_fences?.map((f) => f.name)).toContain("mermaid");
  });

  it.each(diagramPages)("%s draws its flow", (page) => {
    expect(readFileSync(join(REPO_ROOT, "docs", page), "utf-8")).toContain(fence);
  });

  it("only appear on published pages", () => {
    const unpublished = readdirSync(join(REPO_ROOT, "docs")).filter((n) => n.endsWith(".md") && excluded.includes(n));
    expect(diagramPages.filter((page) => unpublished.includes(page))).toEqual([]);
  });
});

/** The names and long options a `--help` text lists, read from its own sections. */
const helpCache = new Map<string, { commands: string[]; options: string[] }>();
function helpOf(args: string[]): { commands: string[]; options: string[] } {
  const cached = helpCache.get(args.join(" "));
  if (cached) return cached;
  const text = runDelivery([...args, "--help"]).stdout;
  const section = (heading: string): string[] => {
    const start = text.indexOf(`\n${heading}:\n`);
    if (start === -1) return [];
    const rest = text.slice(start + heading.length + 3).split(/\n(?=\S)/)[0] ?? "";
    return rest.split("\n");
  };
  const commands = section("Commands").flatMap((line) => /^ {2}([a-z][a-z-]*)/.exec(line)?.[1] ?? []).filter((name) => name !== "help");
  const options = section("Options").flatMap((line) => /^ {2}(?:-\w, )?(--[a-z-]+)/.exec(line)?.[1] ?? []).filter((flag) => flag !== "--help");
  const result = { commands, options };
  helpCache.set(args.join(" "), result);
  return result;
}

describe("the command reference", () => {
  const reference = readFileSync(join(REPO_ROOT, "docs/cli-reference.md"), "utf-8");
  const top = helpOf([]);
  const everyCommand = [[] as string[], ...top.commands.map((name) => [name])].flatMap((path) => {
    const sub = helpOf(path).commands.map((name) => [...path, name]);
    return [path, ...sub];
  });

  it("names every command the command line lists", () => {
    const missing = everyCommand.filter((path) => path.length > 0 && !reference.includes(`delivery ${path.join(" ")}`));
    expect(missing.map((path) => path.join(" "))).toEqual([]);
  });

  it("names every option of every command", () => {
    const missing = everyCommand.flatMap((path) => helpOf(path).options.filter((flag) => !reference.includes(`\`${flag}`) && !reference.includes(`${flag}\``)).map((flag) => `${path.join(" ") || "delivery"} ${flag}`));
    expect(missing).toEqual([]);
  });
});
