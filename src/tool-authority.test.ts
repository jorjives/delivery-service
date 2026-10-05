import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createToolAuthority,
  refusalSentence,
  outsideWorktreeSentence,
  authorityRefusal,
} from "./tool-authority.js";
import type { RoleConfig } from "./role-config.js";
import { WorkerEnvelope, READ_ONLY_TOOLS } from "./role-config.js";

const readOnlyWorker: RoleConfig = {
  role: "worker",
  systemPromptFragment: "You are a read-only worker.",
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Glob"],
};

const editor: RoleConfig = {
  role: "gate-maintenance",
  systemPromptFragment: "You repair the environment.",
  envelopeSchema: WorkerEnvelope,
  allowedTools: ["Read", "Edit", "Write"],
};

const worktree = "/runs/s-1/tree";

/** The options bag the SDK passes as `canUseTool`'s third argument. */
const sdkCallOptions = {
  signal: new AbortController().signal,
  toolUseID: "test-tool-use-id",
  requestId: "test-request-id",
};

describe("the guard the SDK consults before each tool call", () => {
  it("allows a tool the role's config names", async () => {
    const authority = createToolAuthority(readOnlyWorker, worktree);
    const decision = await authority.canUseTool("Read", { file_path: `${worktree}/x` }, sdkCallOptions);
    expect(decision).toEqual({ behavior: "allow", updatedInput: { file_path: `${worktree}/x` } });
    expect(authority.refusals).toEqual([]);
  });

  it("denies a tool outside the role's config and says why in plain English", async () => {
    const authority = createToolAuthority(readOnlyWorker, worktree);
    const decision = await authority.canUseTool("Bash", { command: "rm -rf /" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
    if (decision?.behavior !== "deny") return;
    expect(decision.message).toBe(refusalSentence(readOnlyWorker, "Bash"));
  });

  it("records each refusal, in order, so the harness can report it afterwards", async () => {
    const authority = createToolAuthority(readOnlyWorker, worktree);
    await authority.canUseTool("Bash", {}, sdkCallOptions);
    await authority.canUseTool("Read", {}, sdkCallOptions);
    await authority.canUseTool("WebFetch", {}, sdkCallOptions);
    expect(authority.refusals).toEqual([
      refusalSentence(readOnlyWorker, "Bash"),
      refusalSentence(readOnlyWorker, "WebFetch"),
    ]);
  });
});

describe("the worktree boundary, for tools the role IS permitted", () => {
  it("allows an edit to a file inside the worktree, relative or absolute", async () => {
    const authority = createToolAuthority(editor, worktree);
    for (const file_path of [".env", `${worktree}/config/app.env`]) {
      const decision = await authority.canUseTool("Edit", { file_path }, sdkCallOptions);
      expect(decision?.behavior).toBe("allow");
    }
    expect(authority.refusals).toEqual([]);
  });

  it("refuses an edit to a file outside the worktree, even though Edit is permitted", async () => {
    const authority = createToolAuthority(editor, worktree);
    const target = "/runs/s-1/checks/greeting.check.sh";
    const decision = await authority.canUseTool("Edit", { file_path: target }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
    if (decision?.behavior !== "deny") return;
    expect(decision.message).toBe(outsideWorktreeSentence(editor, "Edit", target));
    expect(authority.refusals).toEqual([outsideWorktreeSentence(editor, "Edit", target)]);
  });

  it("is not fooled by a relative path that climbs out", async () => {
    const authority = createToolAuthority(editor, worktree);
    const decision = await authority.canUseTool("Write", { file_path: "../checks/x.sh" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
  });

  it("is not fooled by a sibling directory that shares the worktree's prefix", async () => {
    const authority = createToolAuthority(editor, worktree);
    const decision = await authority.canUseTool("Edit", { file_path: `${worktree}-evil/x` }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
  });

  it("is not fooled by a home-relative path, which the file tools expand", async () => {
    const authority = createToolAuthority(editor, worktree);
    const decision = await authority.canUseTool("Edit", { file_path: "~/.bashrc" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
  });

  it("refuses a search rooted outside the worktree", async () => {
    const authority = createToolAuthority({ ...editor, allowedTools: ["Grep"] }, worktree);
    const decision = await authority.canUseTool("Grep", { pattern: "x", path: "/runs/s-1/checks" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
  });

  it("refuses a notebook edit outside the worktree", async () => {
    const authority = createToolAuthority({ ...editor, allowedTools: ["NotebookEdit"] }, worktree);
    const decision = await authority.canUseTool("NotebookEdit", { notebook_path: "/elsewhere/n.ipynb" }, sdkCallOptions);
    expect(decision?.behavior).toBe("deny");
  });

  it("refuses whatever path the runtime itself flags as outside the allowed directories", async () => {
    const authority = createToolAuthority({ ...editor, allowedTools: ["Bash"] }, worktree);
    const decision = await authority.canUseTool(
      "Bash",
      { command: "sed -i s/a/b/ /runs/s-1/checks/x.sh" },
      { ...sdkCallOptions, blockedPath: "/runs/s-1/checks/x.sh" },
    );
    expect(decision?.behavior).toBe("deny");
    if (decision?.behavior !== "deny") return;
    expect(decision.message).toContain("/runs/s-1/checks/x.sh");
  });

  it("checks the tool list first, so an out-of-role call is reported as that", async () => {
    const authority = createToolAuthority(readOnlyWorker, worktree);
    await authority.canUseTool("Write", { file_path: "/elsewhere/x" }, sdkCallOptions);
    expect(authority.refusals).toEqual([refusalSentence(readOnlyWorker, "Write")]);
  });
});

describe("the sentences a refusal is reported with", () => {
  it("names the role, the tool, the permitted tools, and that this was deliberate", () => {
    const sentence = refusalSentence(readOnlyWorker, "Bash");
    expect(sentence).toContain("worker");
    expect(sentence).toContain("Bash");
    expect(sentence).toContain("Read, Glob");
    expect(sentence).toContain("working as intended");
  });

  it("names the role, the tool, the path, the worktree rule, and that this was deliberate", () => {
    const sentence = outsideWorktreeSentence(editor, "Edit", "/runs/s-1/checks/x.sh");
    expect(sentence).toContain("gate-maintenance");
    expect(sentence).toContain("Edit");
    expect(sentence).toContain("/runs/s-1/checks/x.sh");
    expect(sentence).toContain("outside the worktree");
    expect(sentence).toContain("working as intended");
  });

  it("never reads as an unexplained failure", () => {
    for (const sentence of [
      refusalSentence(readOnlyWorker, "Bash"),
      outsideWorktreeSentence(editor, "Edit", "/x"),
    ]) {
      expect(sentence).toContain("refused");
      expect(sentence).toContain("not a fault in the run");
      expect(sentence).not.toMatch(/error|Error|exception|denied by the SDK/);
    }
  });
});

describe("classifying what a finished session refused", () => {
  it("reports nothing when nothing was refused", () => {
    expect(authorityRefusal(readOnlyWorker, [], [])).toBeUndefined();
  });

  it("turns the first recorded refusal into one incomplete terminus", () => {
    const first = outsideWorktreeSentence(editor, "Edit", "/x");
    const terminus = authorityRefusal(editor, [first, refusalSentence(editor, "Bash")], []);
    expect(terminus).toEqual({
      status: "incomplete",
      rationale: `gate-maintenance session did not complete: ${first}`,
    });
  });

  it("reads the SDK's own denial record as a second source", () => {
    const terminus = authorityRefusal(readOnlyWorker, [], [{ tool_name: "Write" }]);
    expect(terminus?.rationale).toBe(
      `worker session did not complete: ${refusalSentence(readOnlyWorker, "Write")}`,
    );
  });

  it("makes no authority claim about a denial of a tool the role was permitted", () => {
    expect(authorityRefusal(readOnlyWorker, [], [{ tool_name: "Read" }])).toBeUndefined();
  });

  it("prefers the guard's own record over the SDK's", () => {
    const own = refusalSentence(readOnlyWorker, "Bash");
    const terminus = authorityRefusal(readOnlyWorker, [own], [{ tool_name: "Write" }]);
    expect(terminus?.rationale).toBe(`worker session did not complete: ${own}`);
  });
});

describe("the scanner's guard", () => {
  const scanner: RoleConfig<unknown> = { role: "scanner", systemPromptFragment: "You review.", envelopeSchema: z.object({}), allowedTools: [...READ_ONLY_TOOLS] };

  it("refuses an edit, a command and a read outside the project, and allows a read inside it", async () => {
    const authority = createToolAuthority(scanner, worktree);
    expect((await authority.canUseTool("Edit", { file_path: `${worktree}/a.js` }, sdkCallOptions))?.behavior).toBe("deny");
    expect((await authority.canUseTool("Bash", { command: "ls" }, sdkCallOptions))?.behavior).toBe("deny");
    expect((await authority.canUseTool("Read", { file_path: "/etc/passwd" }, sdkCallOptions))?.behavior).toBe("deny");
    expect((await authority.canUseTool("Read", { file_path: `${worktree}/a.js` }, sdkCallOptions))?.behavior).toBe("allow");
    expect(authority.refusals).toEqual([
      refusalSentence(scanner, "Edit"),
      refusalSentence(scanner, "Bash"),
      outsideWorktreeSentence(scanner, "Read", "/etc/passwd"),
    ]);
  });
});
