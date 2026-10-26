import { describe, expect, it } from "vitest";
import { approvalMatches, decideApproval } from "./pack-approval.js";
import type { ConfirmQuestion } from "./init.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import { fingerprintDiffers, nobodyToAsk, shellWord } from "./packs-add-render.js";

const HASH = "0123456789abcdef".repeat(4);
const Q: ConfirmQuestion = { message: "Add it?", default: false };
const dir = process.cwd();

/** The text of some lines with every run of white space made one space, so where a line wraps does not matter. */
const flat = (lines: readonly string[]): string => lines.join(" ").replace(/\s+/g, " ");

describe("approvalMatches", () => {
  it.each([
    [HASH, true],
    [`delivery.pack-hash/1:${HASH}`, true],
    [HASH.toUpperCase(), false],
    [` ${HASH}`, false],
    [HASH.slice(0, 32), false],
    [`delivery.pack-hash/2:${HASH}`, false],
    ["", false],
  ])("matches %j: %s", (given, expected) => expect(approvalMatches(given, HASH)).toBe(expected));
});

describe("decideApproval", () => {
  it("asks nothing when a fingerprint is given, even at a terminal", async () => {
    const { ask, asked } = scriptedAsk({ confirm: false });
    expect(await decideApproval(HASH, HASH, context(dir).ctx, ask, Q)).toBe("yes");
    expect(await decideApproval("f".repeat(64), HASH, context(dir).ctx, ask, Q)).toBe("differs");
    expect(asked).toEqual([]);
  });

  it("is nobody without a terminal, and nobody under --json, asking nothing", async () => {
    for (const options of [{ interactive: false }, { json: true }]) {
      const { ask, asked } = scriptedAsk({ confirm: true });
      expect(await decideApproval(undefined, HASH, context(dir, options).ctx, ask, Q)).toBe("nobody");
      expect(asked).toEqual([]);
    }
  });

  it("asks at a terminal when no fingerprint is given", async () => {
    const yes = scriptedAsk({ confirm: true });
    expect(await decideApproval(undefined, HASH, context(dir).ctx, yes.ask, Q)).toBe("yes");
    expect(yes.asked).toEqual([Q]);
    const no = scriptedAsk({ confirm: false });
    expect(await decideApproval(undefined, HASH, context(dir).ctx, no.ask, Q)).toBe("no");
    expect(no.asked).toEqual([Q]);
  });
});

describe("nobodyToAsk", () => {
  it("prints a command that pastes as one, within 60 columns", () => {
    const lines = nobodyToAsk("add", "delivery packs add @acme/delivery-pack-docs", HASH);
    expect(lines).toEqual([
      "Not added: nothing here can ask you.",
      "  Read the account above, then add it with the fingerprint",
      "  you read:",
      "    delivery packs add @acme/delivery-pack-docs \\",
      `      --approve ${HASH.slice(0, 32)}\\`,
      HASH.slice(32),
      "  The command is refused if the pack has a different",
      "  fingerprint.",
      "  Nothing was changed.",
    ]);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(60);
    // the three command lines, joined as a shell joins them, give the command
    expect(lines.slice(3, 6).join("\n").replace(/\\\n/g, "").replace(/\s+/g, " ").trim()).toBe(`delivery packs add @acme/delivery-pack-docs --approve ${HASH}`);
  });

  it("never wraps the command, so a long package name gives a longer line", () => {
    const command = `delivery packs add @acme/${"x".repeat(60)}`;
    expect(nobodyToAsk("add", command, HASH)).toContain(`    ${command} \\`);
  });

  it("names the change for an update and the account for an approve", () => {
    const update = nobodyToAsk("update", "delivery packs update docs", HASH);
    expect(update[0]).toBe("Not updated: nothing here can ask you.");
    expect(flat(update)).toContain("Read the change above, then update it");
    const approve = nobodyToAsk("approve", "delivery packs approve docs", HASH);
    expect(approve[0]).toBe("Not approved: nothing here can ask you.");
    expect(flat(approve)).toContain("Read the account above, then approve it");
  });
});

describe("shellWord", () => {
  it.each([
    ["@acme/delivery-pack-docs", "@acme/delivery-pack-docs"],
    ["^1.0.0", "^1.0.0"],
    [">=1.0.0 <2", "'>=1.0.0 <2'"],
    ["it's", "'it'\\''s'"],
  ])("quotes %j only where a shell would change it", (word, shown) => expect(shellWord(word)).toBe(shown));
});

describe("fingerprintDiffers", () => {
  it("refuses a different fingerprint by the action", () =>
    expect(fingerprintDiffers("add")).toEqual(["Not added: the fingerprint given is not the one shown above.", "  Read the account again before you give it.", "  Nothing was changed."]));
});
