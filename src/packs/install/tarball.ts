import { gzipSync } from "node:zlib";
import { Header } from "tar";

/** One entry of a tarball built for a test or a fake: its path exactly as written, its type (a file by default), and its body or link target. */
export interface TarEntry {
  path: string;
  type?: "File" | "Directory" | "SymbolicLink" | "Link" | "FIFO";
  body?: string | Uint8Array;
  linkpath?: string;
}

const BLOCK = 512;

/** A gzipped tarball of `entries`, written as given, so a test can build a hostile archive. */
export function tarballOf(entries: readonly TarEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const type = entry.type ?? "File";
    const body = typeof entry.body === "string" ? new TextEncoder().encode(entry.body) : (entry.body ?? new Uint8Array(0));
    const size = type === "File" ? body.length : 0;
    const header = Buffer.alloc(BLOCK);
    new Header({ path: entry.path, type, mode: 0o644, mtime: new Date(0), size, linkpath: entry.linkpath }).encode(header, 0);
    parts.push(header);
    if (size > 0) parts.push(body, new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK));
  }
  parts.push(new Uint8Array(2 * BLOCK));
  return gzipSync(Buffer.concat(parts));
}

/** A gzipped tarball of a package as `npm pack` writes it: `package/package.json` first, then each file under `package/`, sorted by path. */
export function packageTarball(files: Readonly<Record<string, string>>, packageJson: Record<string, unknown>): Uint8Array {
  const entries: TarEntry[] = [{ path: "package/package.json", body: JSON.stringify(packageJson) }];
  for (const [path, body] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1))) entries.push({ path: `package/${path}`, body });
  return tarballOf(entries);
}
