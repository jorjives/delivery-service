// docs/task-packs.md is how an owner learns to ask for a review. It quotes what the review
// prints, so it is held to the phrases the harness actually uses.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_LEVEL, NOTHING_CHANGED, READS_ONLY, UNCONFIRMED_WHY } from "../src/packs/render.js";
import { PR_OPENED, STATE_WORDS } from "../src/packs/render.js";
import { REPO_ROOT } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/task-packs.md"), "utf-8");
const flat = guide.replace(/\s+/g, " ");

describe("the task packs guide", () => {
  it("shows every command a first review uses", () => {
    for (const command of ["delivery review code", "delivery findings", "delivery findings 1", "delivery findings --unconfirmed", "delivery packs"]) expect(guide).toContain(command);
  });

  it("quotes each way the harness will know a problem is fixed, and each reason one is not offered, exactly", () => {
    for (const phrase of [...Object.values(CHECK_LEVEL), ...Object.values(UNCONFIRMED_WHY)]) expect(flat).toContain(phrase);
  });

  it("quotes the promise that the review only reads and changes nothing", () => {
    expect(flat).toContain(READS_ONLY);
    expect(flat).toContain(NOTHING_CHANGED);
  });

  it("points at the example project, which exists, and the scripted demo", () => {
    expect(guide).toContain("examples/code-review-example");
    expect(existsSync(join(REPO_ROOT, "examples/code-review-example"))).toBe(true);
    expect(guide).toContain("npm run demo:packs-slice-1");
  });

  it("says where a review is kept and that an interrupted one is finished by running it again", () => {
    expect(guide).toContain(".delivery/packs/");
    expect(flat).toContain("run the same command again");
  });

  it("shows how to choose which problems to fix, and quotes where each can stand", () => {
    for (const command of ["delivery findings approve 1 3", "delivery findings approve --all", "delivery findings skip 2"]) expect(guide).toContain(command);
    for (const phrase of [...Object.values(STATE_WORDS), PR_OPENED]) expect(flat).toContain(phrase);
  });

  it("shows how to have the approved problems fixed, and where to watch", () => {
    expect(guide).toContain("delivery fix");
    expect(guide).toContain("delivery status --watch");
    expect(flat).toContain("a description to act on, not instructions to obey");
  });
});
