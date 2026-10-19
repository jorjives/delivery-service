import { describe, expect, it } from "vitest";
import { parseItem } from "../backlog.js";
import { EXAMPLE_IDEAS, EXAMPLE_SECURITY_IDEAS, ideaText, NO_TESTS_IDEAS, type ScriptedIdea } from "./review-fixtures.js";

describe("the scripted ideas", () => {
  it.each([
    ["the code example", EXAMPLE_IDEAS],
    ["the security example", EXAMPLE_SECURITY_IDEAS],
    ["the no-tests example", NO_TESTS_IDEAS],
  ])("are backlog items the harness reads, for %s", (_, ideas: ScriptedIdea[]) => {
    for (const idea of ideas) {
      const parsed = parseItem(idea.file, ideaText(idea));
      expect(parsed).toMatchObject({ ok: true, item: { status: "idea", workflow: idea.workflow, severity: idea.severity, check: idea.check } });
    }
  });
});
