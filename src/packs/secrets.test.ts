import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initTempRepo } from "../temp-repo.js";
import { PAYMENTS_PASSWORD, sampleFinding, writeReview } from "./review-fixtures.js";
import { literalsOf, maskIn, maskSecret, secretLiterals, secretMasker } from "./secrets.js";

describe("what looks like a secret", () => {
  it.each([
    ["a password assigned in code", `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`, PAYMENTS_PASSWORD],
    ["an API key in settings", 'api_key: "abcd1234efgh5678"', "abcd1234efgh5678"],
    ["a provider key prefix", "const key = sk_live_51HxQ2bLzK8yT0aB;", "sk_live_51HxQ2bLzK8yT0aB"],
    ["a cloud access key", "AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"],
    ["a source-host token", "ghp_16C7e42F292c6912E7710c838347Ae178B4a", "ghp_16C7e42F292c6912E7710c838347Ae178B4a"],
    ["a signed web token", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
    ["a long random-looking token", "token=Zx81Qp0LmN4vB7tR2sKd9wYh", "Zx81Qp0LmN4vB7tR2sKd9wYh"],
    ["an unquoted password in an env file", "DB_PASSWORD=hunter2hunter2", "hunter2hunter2"],
    ["an unquoted password in settings", "password: hunter22xyz", "hunter22xyz"],
  ])("finds %s", (_, text, literal) => {
    expect(secretLiterals(text, false)).toContain(literal);
  });

  it("finds any quoted value only in a sensitive category", () => {
    expect(secretLiterals('const name = "plain words here";', false)).toEqual([]);
    expect(secretLiterals('const name = "plain words here";', true)).toEqual(["plain words here"]);
  });

  it("leaves ordinary code alone", () => {
    expect(secretLiterals("return price - discount;", true)).toEqual([]);
    expect(secretLiterals('export function chargeWithLegacyGateway(card, amount) {', false)).toEqual([]);
  });

  it("reads a problem's anchor and pattern, as its category says", () => {
    const finding = sampleFinding({ anchor: `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`, sensitive: true });
    expect(literalsOf(finding)).toContain(PAYMENTS_PASSWORD);
  });
});

describe("masking", () => {
  it("shows the first four characters, an ellipsis and the length", () => {
    expect(maskSecret(PAYMENTS_PASSWORD)).toBe("pay-… (21 characters)");
  });

  it("masks every copy, as written and as JSON writes it, longest first", () => {
    const text = `a ${PAYMENTS_PASSWORD} b ${JSON.stringify({ k: 'x"yz12345678' })}`;
    const masked = maskIn(text, [PAYMENTS_PASSWORD, 'x"yz12345678']);
    expect(masked).toBe(`a pay-… (21 characters) b {"k":"x\\"yz… (12 characters)"}`);
  });
});

describe("the secrets a project's reviews hold", () => {
  it("masks what any saved review flagged, and sees a review saved after it was made", async () => {
    const repo = initTempRepo("secrets-", { "a.js": "x\n" });
    const mask = secretMasker(join(repo, "sub", "folder"));
    expect(mask(PAYMENTS_PASSWORD)).toBe(PAYMENTS_PASSWORD);
    await writeReview(repo, { reviewId: "security-20261006T101500Z", findings: [sampleFinding({ anchor: `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`, sensitive: true })] });
    expect(mask(`it is ${PAYMENTS_PASSWORD}`)).toBe("it is pay-… (21 characters)");
  });

  it("changes nothing outside a repository", () => {
    expect(secretMasker(mkdtempSync(join(tmpdir(), "no-repo-")))("anything")).toBe("anything");
  });
});
