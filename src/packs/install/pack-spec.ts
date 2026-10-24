import { PackSpecRefused } from "../../errors.js";

/** The npm package an owner named: its name, the version or tag asked for, and whether the owner wrote one. */
export interface PackageSpec {
  name: string;
  request: string;
  typed: boolean;
}

const NAME_AND_REQUEST = /^(@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*(@[0-9A-Za-z.^~<>=|*+_-]+)?$/;
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/;
const MAX_NAME_LENGTH = 214;

/** The text before the request: the first `@` that is not the scope's leading `@`. */
function splitRequest(text: string): { name: string; request?: string } {
  const at = text.indexOf("@", 1);
  return at === -1 ? { name: text } : { name: text.slice(0, at), request: text.slice(at + 1) };
}

/** Which kind of address the text looks like, or undefined when it is a plain npm name. Web and path come first so `./pack` is a path, not `owner/repo`. */
function refusalOf(text: string): PackSpecRefused["looksLike"] | undefined {
  if (text.startsWith("http:") || text.startsWith("https:")) return "web";
  if (/^[.\/~]/.test(text) || text.startsWith("file:") || text.endsWith(".tgz") || text.endsWith(".tar.gz")) return "path";
  if (/^(git\+|git:|github:|gitlab:|bitbucket:|gist:)/.test(text) || text.endsWith(".git") || OWNER_REPO.test(text)) return "git";
  if (!NAME_AND_REQUEST.test(text) || splitRequest(text).name.length > MAX_NAME_LENGTH) return "name";
  return undefined;
}

/** Reads the package an owner names, refusing anything that is not a plain npm name, since npm runs prepare scripts for git and folder sources. */
export function parsePackageSpec(text: string): PackageSpec {
  const looksLike = refusalOf(text);
  if (looksLike !== undefined) throw new PackSpecRefused(text, looksLike);
  const { name, request } = splitRequest(text);
  return { name, request: request ?? "latest", typed: request !== undefined };
}
