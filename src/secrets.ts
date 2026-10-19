import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { BACKLOG_DIR, parseItem } from "./backlog.js";

/** The shortest text treated as a secret: anything shorter is too common to mask without masking ordinary words. */
const SHORTEST = 8;

/** Shapes that are secrets whatever surrounds them: private-key headers and the key formats of common providers. */
const SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
/** A quoted value given to something named like a password, secret, token or API key. */
const ASSIGNED = /(?:password|passwd|secret|token|api[_-]?key)\w*["']?\s*[:=]\s*(["'`])([^"'`\s]{8,})\1/gi;
/** An unquoted value given to such a name, as an env file or settings file writes it. */
const ASSIGNED_BARE = /(?:password|passwd|secret|token|api[_-]?key)\w*\s*[:=]\s*([^\s"'`,;]{8,})/gi;
/** Any quoted value: a secret only in a category the pack marks sensitive. */
const QUOTED = /(["'`])([^"'`\n]{8,})\1/g;
/** A run of key-like characters long enough to be a generated token. */
const TOKEN = /[A-Za-z0-9+/_-]{20,}/g;

function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / text.length;
    bits -= share * Math.log2(share);
  }
  return bits;
}

/** Letters and digits mixed, and as varied as generated text is: a token, not a word or a path. */
const randomLooking = (token: string): boolean => /[A-Za-z]/.test(token) && /\d/.test(token) && entropy(token) >= 3.5;

/**
 * Every secret-shaped text in `text`, found by the harness, never on an
 * agent's say-so. Generous by design: masking something harmless costs a
 * little clarity, showing a secret costs the owner the secret.
 */
export function secretLiterals(text: string, sensitive: boolean): string[] {
  const found = new Set<string>();
  for (const shape of SHAPES) for (const [match] of text.matchAll(shape)) found.add(match);
  for (const match of text.matchAll(ASSIGNED)) found.add(match[2] ?? "");
  for (const match of text.matchAll(ASSIGNED_BARE)) found.add(match[1] ?? "");
  if (sensitive) for (const match of text.matchAll(QUOTED)) found.add(match[2] ?? "");
  for (const [match] of text.matchAll(TOKEN)) if (randomLooking(match)) found.add(match);
  return [...found].filter((literal) => literal.length >= SHORTEST);
}

/** A secret as every output shows it: its first four characters, an ellipsis and its length. */
export const maskSecret = (literal: string): string => `${literal.slice(0, 4)}… (${literal.length} characters)`;

/** `text` with every copy of every literal masked, as written and as JSON escapes it, longest first so one secret inside another is masked whole. */
export function maskIn(text: string, literals: Iterable<string>): string {
  let out = text;
  for (const literal of [...new Set(literals)].sort((a, b) => b.length - a.length)) {
    const plainMask = maskSecret(literal);
    const jsonForm = JSON.stringify(literal).slice(1, -1);
    const jsonFirst4 = JSON.stringify(literal.slice(0, 4)).slice(1, -1);
    const jsonMask = `${jsonFirst4}… (${literal.length} characters)`;

    out = out.split(literal).join(plainMask);
    out = out.split(jsonForm).join(jsonMask);
  }
  return out;
}

const cache = new Map<string, { stamp: string; literals: string[] }>();

/**
 * Every secret a sensitive backlog item's check flags, read again only when the backlog folder changes (by name and
 * modification time), so a command that adds an idea masks it in the same breath.
 */
export function knownSecrets(repoRoot: string): string[] {
  const root = join(repoRoot, BACKLOG_DIR);
  let files: string[];
  try {
    files = readdirSync(root).filter((name) => name.endsWith(".md")).map((name) => join(root, name));
  } catch {
    return [];
  }
  const stamp = files.map((file) => `${file}:${statSync(file).mtimeMs}`).join("|");
  const hit = cache.get(root);
  if (hit?.stamp === stamp) return hit.literals;
  const literals = files.flatMap((file) => {
    const parsed = parseItem(basename(file), readFileSync(file, "utf-8"));
    const check = parsed.ok ? parsed.item.check : undefined;
    return check?.kind === "anchor-gone" && check.sensitive === true ? secretLiterals(check.anchor, true) : [];
  });
  cache.set(root, { stamp, literals });
  return literals;
}

/** The repository `startDir` is in: the nearest folder up with a `.git` entry (a folder, or a file in a linked working copy). */
function repoRootOf(startDir: string): string | undefined {
  for (let dir = startDir; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** A function masking every secret the repository's reviews hold, read as each text is masked. Outside a repository it changes nothing. */
export function secretMasker(startDir: string): (text: string) => string {
  const root = repoRootOf(startDir);
  return root === undefined ? (text) => text : (text) => maskIn(text, knownSecrets(root));
}
