// Slice 5: Large Referenced Data Can Be Stored and Retrieved Separately
// Source: docs/superpowers/specs/2026-09-04-case-file-persistence-slices.md
// Recorded: 2026-09-04 against commit 4e57bc9
//
// Drives the slice's own UAT demo script (npx tsx demos/slice-5-ref-storage.ts)
// and asserts on its printed output.

import { describe, it, expect } from "vitest";
import { runTsx } from "./helpers.js";

describe("UAT: large referenced data can be stored and retrieved separately", () => {
  const { stdout, status } = runTsx(["demos/slice-5-ref-storage.ts"]);

  it("exits cleanly and prints a matching retrieval summary", () => {
    expect(status).toBe(0);
    expect(stdout).toContain("Retrieved content matches what was written: true");
  });

  it("AC: writing a reference blob produces a reference ID that can be used to read it back later", () => {
    expect(stdout).toContain('Wrote reference "gate-detail-1":');
  });

  it("AC: reading back a reference blob by its ID returns the same content that was written", () => {
    const written = stdout.split('Wrote reference "gate-detail-1":\n')[1]?.split("\n\nAppended")[0];
    const retrieved = stdout
      .split('Followed detailRef "gate-detail-1" from history back to the reference:\n')[1]
      ?.split("\n\nRetrieved content matches")[0];
    expect(written).toBeTruthy();
    expect(retrieved).toBe(written);
  });

  it("AC: a history entry that points at a reference can be followed to retrieve the full referenced content", () => {
    expect(stdout).toContain("Appended gate-failure history entry pointing at the reference.");
    expect(stdout).toContain(
      'Followed detailRef "gate-detail-1" from history back to the reference:',
    );
  });
});
