// A step prompt that uses `{{task.body}}` puts a tracker issue's text among the step's
// instructions, where it carries the weight of an instruction. The docs that describe
// this use must say so, so a user who copies the example approves the label knowingly.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./helpers.js";

const NOTE = /among the step'?s instructions/i;

describe("the note on interpolated issue text", () => {
  for (const page of ["docs/work-sources.md", "docs/configuration-reference.md"]) {
    it(`${page} says interpolated issue text is placed among the step's instructions`, () => {
      const text = readFileSync(join(REPO_ROOT, page), "utf-8");
      expect(text).toMatch(NOTE);
    });
  }
});
