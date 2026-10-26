import { mkdtempSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PackSourceUnavailable } from "../errors.js";
import { sortKeys } from "../packs/install/lock.js";
import { inspectionOf, NO_PROJECT, type Inspection } from "../packs/inspection.js";
import { builtInPacks } from "../packs/manifest.js";
import { publishedKeys } from "../report/json-schema.js";
import { context } from "./init-fixtures.js";
import { EXIT, Refusal, renderFailure } from "./failures.js";
import { type DecisionOutput, PACK_DECISION_SCHEMA, PackDecision, packDecisionSchema, relativeAccount, scrubRoot, withDecisionOutput } from "./pack-decision.js";
import { renderInspection } from "./packs-inspect-render.js";

const [firstPack] = await builtInPacks();
if (firstPack === undefined) throw new Error("the built-in packs are missing");
const inspection: Inspection = inspectionOf(firstPack, NO_PROJECT, [], null);

/** A temporary repository folder, spelt as the machine spells it (a symbolic link is followed). */
const repoDir = (): string => realpathSync(mkdtempSync(join(tmpdir(), "decision-")));

describe("the plain output", () => {
  it("writes the plain lines and the rendered account, and no JSON, without --json", async () => {
    const { ctx, lines } = context(process.cwd());
    const exit = await withDecisionOutput(ctx, "add", async (out) => {
      out.plain(["a"]);
      out.account(inspection);
      out.facts({ pack: "p" });
      return out.end("added", ["b"], EXIT.ok);
    });
    expect(lines).toEqual(["a", ...renderInspection(inspection), "b"]);
    expect(exit).toBe(EXIT.ok);
  });

  it("passes an error through untouched", async () => {
    const { ctx } = context(process.cwd());
    await expect(withDecisionOutput(ctx, "add", async () => { throw new Refusal("no", EXIT.configuration); })).rejects.toThrow("no");
  });
});

describe("the JSON document", () => {
  const body = async (out: DecisionOutput) => {
    out.plain(["a"]);
    out.account(inspection);
    out.facts({ pack: "p" });
    return out.end("added", ["b"], EXIT.ok);
  };

  it("writes one document under --json, with every fact not given as null", async () => {
    const { ctx, lines } = context(process.cwd(), { json: true });
    await withDecisionOutput(ctx, "add", body);
    expect(lines.length).toBe(1);
    const doc = JSON.parse(lines[0] ?? "");
    expect(doc).toEqual({
      schema: PACK_DECISION_SCHEMA,
      command: "add",
      outcome: "added",
      pack: "p",
      package: null,
      fingerprint: null,
      previous: null,
      account: relativeAccount(inspection, process.cwd()),
      notInPack: null,
      changes: null,
      files: null,
      message: "b",
    });
    expect(PackDecision.safeParse(doc).success).toBe(true);
  });

  it("joins the end lines into one message, trimmed", async () => {
    const { ctx, lines } = context(process.cwd(), { json: true });
    await withDecisionOutput(ctx, "add", async (out) => out.end("refused", ["Not added: x", "  Nothing was changed."], EXIT.configuration));
    expect(JSON.parse(lines[0] ?? "").message).toBe("Not added: x Nothing was changed.");
  });

  it("turns a refusal raised under --json into a refused document with exit 2", async () => {
    const { ctx, lines } = context(process.cwd(), { json: true });
    const failure = new PackSourceUnavailable("@acme/x", "latest", "no-npm", "");
    const exit = await withDecisionOutput(ctx, "add", async () => { throw failure; });
    expect(exit).toBe(EXIT.configuration);
    expect(lines.length).toBe(1);
    const doc = JSON.parse(lines[0] ?? "");
    expect(doc.outcome).toBe("refused");
    expect(doc.message).toBe(renderFailure(failure).message);
  });

  it("writes keys sorted at every level", async () => {
    const { ctx, lines } = context(process.cwd(), { json: true });
    await withDecisionOutput(ctx, "add", body);
    const text = lines[0] ?? "";
    expect(text).toBe(JSON.stringify(sortKeys(JSON.parse(text)), null, 2));
    expect(Object.keys(JSON.parse(text))[0]).toBe("account");
    const account = JSON.parse(text).account as Record<string, unknown>;
    expect(Object.keys(account)).toEqual(Object.keys(account).slice().sort());
  });

  it("makes the account's paths relative to the repository, and leaves no machine path anywhere in the document", async () => {
    const repo = repoDir();
    const base = inspectionOf(firstPack, NO_PROJECT, [], null);
    const shown: Inspection = {
      ...base,
      pack: { ...base.pack, source: { ...base.pack.source, path: join(repo, ".delivery/packs/p") } },
      project: { ...base.project, path: repo },
    };
    const { ctx, lines } = context(repo, { json: true });
    await withDecisionOutput(ctx, "add", async (out) => {
      out.repository(repo);
      out.account(shown);
      return out.end("refused", [`Not added: cannot read ${join(repo, "x")}`], EXIT.configuration);
    });
    const text = lines[0] ?? "";
    const doc = JSON.parse(text);
    expect(doc.account.pack.source.path).toBe(".delivery/packs/p");
    expect(doc.account.project.path).toBe(".");
    expect(doc.message).toContain("Not added: cannot read x");
    expect(text).not.toContain(repo);
    expect(text).not.toContain(tmpdir());
  });

  it("makes the account's paths relative when the repository is named by a symbolic link", async () => {
    const real = repoDir();
    const link = join(mkdtempSync(join(tmpdir(), "decision-link-")), "repo");
    symlinkSync(real, link);
    const base = inspectionOf(firstPack, NO_PROJECT, [], null);
    const shown: Inspection = {
      ...base,
      pack: { ...base.pack, source: { ...base.pack.source, path: join(link, ".delivery/packs/p") } },
      project: { ...base.project, path: real },
    };
    const { ctx, lines } = context(link, { json: true });
    await withDecisionOutput(ctx, "add", async (out) => {
      out.repository(link);
      out.account(shown);
      return out.end("refused", ["Not added: nothing"], EXIT.configuration);
    });
    const doc = JSON.parse(lines[0] ?? "");
    expect(doc.account.pack.source.path).toBe(".delivery/packs/p");
    expect(doc.account.project.path).toBe(".");
  });

  it("scrubs the repository from a refusal raised before the repository is known", async () => {
    const { ctx, lines } = context(process.cwd(), { json: true });
    const failure = new Refusal(`cannot read ${join(ctx.cwd, ".delivery/packs.lock")}`, EXIT.configuration);
    await withDecisionOutput(ctx, "add", async () => { throw failure; });
    expect(JSON.parse(lines[0] ?? "").message).toBe("cannot read .delivery/packs.lock");
  });

  it("rethrows an unexpected fault under --json", async () => {
    const { ctx } = context(process.cwd(), { json: true });
    await expect(withDecisionOutput(ctx, "add", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });

  it("refuses to end silently under --json", async () => {
    const { ctx } = context(process.cwd(), { json: true });
    await expect(withDecisionOutput(ctx, "add", async () => EXIT.ok)).rejects.toThrow("the command ended without saying what it decided");
  });
});

describe("scrubRoot", () => {
  it("removes the root from its own paths, and names it by a dot otherwise", () => {
    expect(scrubRoot("/r/repo/.delivery/packs.lock and /r/repo", "/r/repo")).toBe(".delivery/packs.lock and .");
  });
});

describe("the decision document's schema", () => {
  it("leaves no key optional", () => expect(publishedKeys(packDecisionSchema(), PACK_DECISION_SCHEMA).filter((l) => l.endsWith("(optional)"))).toEqual([]));

  describe("the decision document's stability promise", () => {
    const promised = readFileSync(new URL("./pack-decision-published-keys.txt", import.meta.url), "utf-8").trimEnd().split("\n");
    const current = publishedKeys(packDecisionSchema(), PACK_DECISION_SCHEMA);
    it("keeps every key and name ever published, each the kind of value it was", () => expect(promised.filter((l) => !current.includes(l))).toEqual([]));
    it("puts every key and name published now under the promise: add its line to pack-decision-published-keys.txt", () =>
      expect(current.filter((l) => !promised.includes(l))).toEqual([]));
  });
});
