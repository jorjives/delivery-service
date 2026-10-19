import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initTempRepo } from "./temp-repo.js";
import { PAYMENTS_PASSWORD } from "./packs/review-fixtures.js";
import { knownSecrets, maskIn, maskSecret, secretLiterals, secretMasker } from "./secrets.js";

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

/** Writes a backlog idea whose check flags `anchor`, in the repository's backlog folder. */
function writeIdea(repo: string, file: string, anchor: string, sensitive: boolean): void {
  const folder = join(repo, ".delivery", "backlog");
  mkdirSync(folder, { recursive: true });
  const check = `  kind: anchor-gone\n  path: payments.js\n  anchor: ${JSON.stringify(anchor)}\n${sensitive ? "  scope: repo\n  sensitive: true\n" : ""}`;
  writeFileSync(join(folder, file), `---\nstatus: idea\nworkflow: security:fix\nseverity: critical\ncheck:\n${check}---\n# A key is written in the code\n\nIt is.\n`);
}

describe("the secrets a project's backlog holds", () => {
  it("masks what a sensitive idea's check flags, and sees an idea added after it was read", () => {
    const repo = initTempRepo("secrets-", { "a.js": "x\n" });
    const mask = secretMasker(join(repo, "sub", "folder"));
    expect(mask(PAYMENTS_PASSWORD)).toBe(PAYMENTS_PASSWORD);
    writeIdea(repo, "20261006T101500Z-payments-password.md", `const PAYMENTS_PASSWORD = "${PAYMENTS_PASSWORD}";`, true);
    expect(mask(`it is ${PAYMENTS_PASSWORD}`)).toBe("it is pay-… (21 characters)");
  });

  it("holds only the quoted values of a sensitive idea, and no secret from one that is not sensitive", () => {
    const repo = initTempRepo("secrets-plain-", { "a.js": "x\n" });
    writeIdea(repo, "20261006T101500Z-plain.md", `const greeting = "plain words here";`, false);
    expect(knownSecrets(repo)).toEqual([]);
    writeIdea(repo, "20261006T101600Z-sensitive.md", `const greeting = "plain words here";`, true);
    expect(knownSecrets(repo)).toEqual(["plain words here"]);
  });

  it("holds secret-shaped text from a non-sensitive anchor, a pattern, and an item that does not parse", () => {
    const repo = initTempRepo("secrets-shapes-", { "a.js": "x\n" });
    const folder = join(repo, ".delivery", "backlog");
    mkdirSync(folder, { recursive: true });
    writeIdea(repo, "20261006T101500Z-anchor.md", `const k = "${PAYMENTS_PASSWORD}";`, false);
    writeFileSync(join(folder, "20261006T101600Z-pattern.md"), `---\nstatus: idea\ncheck:\n  kind: pattern-absent\n  pattern: "api_key: abcd1234efgh5678"\n  paths: [a.js]\n---\n# A key\n`);
    writeFileSync(join(folder, "20261006T101700Z-broken.md"), `---\nstatus: nonsense\n---\n# Broken\n\ntoken=Zx81Qp0LmN4vB7tR2sKd9wYh\n`);
    expect(knownSecrets(repo)).toEqual(expect.arrayContaining([PAYMENTS_PASSWORD, "abcd1234efgh5678", "Zx81Qp0LmN4vB7tR2sKd9wYh"]));
  });

  it("changes nothing outside a repository", () => {
    expect(secretMasker(mkdtempSync(join(tmpdir(), "no-repo-")))("anything")).toBe("anything");
  });
});
