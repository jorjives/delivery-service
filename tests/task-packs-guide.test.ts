import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approved } from "../src/cli/backlog-commands.js";
import { flatten, REPO_ROOT } from "./helpers.js";

const guide = readFileSync(join(REPO_ROOT, "docs/task-packs.md"), "utf-8");

describe("the task packs guide", () => {
  it("shows every command an owner uses, from review to sign-off", () => {
    for (const command of ["delivery review code", "delivery review security", "delivery backlog", "delivery approve", "delivery approve --all", "delivery decline", "delivery run --sources", "delivery sign-off", "delivery reject", "delivery packs"]) expect(guide).toContain(command);
  });

  it("says a review only adds ideas, and that a problem the harness cannot find is not added", () => {
    expect(guide).toContain("changes nothing else");
    expect(guide).toContain("cannot find");
  });

  it("quotes the harness's own words where it shows them", () => {
    expect(guide).toContain(approved([{ file: "x.md", status: "idea", fields: {}, body: "# The total can go below zero\n" }])[1]);
    expect(flatten(guide)).toContain("On GitHub, adding the label is the approval");
  });
});
