import { PackSourceUnavailable } from "../../errors.js";
import type { PackageSpec } from "./pack-spec.js";
import { checkedIntegrity, sriOf, type FetchedPackage, type PackSource } from "./pack-source.js";

export interface FakePackSource extends PackSource {
  publish(name: string, version: string, tarball: Uint8Array, options?: { tags?: readonly string[] }): void;
  unreachable(): void;
  corrupt(name: string, version: string): void;
  readonly fetched: PackageSpec[];
}

interface Published {
  tarball: Uint8Array;
  integrity: string;
  corrupted: boolean;
}

interface Package {
  versions: Map<string, Published>;
  tags: Map<string, string>;
  newest: string;
}

/** An in-memory package source for tests: publish versions and tags, then fetch them as npm would, offline. */
export function fakePackSource(): FakePackSource {
  const packages = new Map<string, Package>();
  let down = false;
  const fetched: PackageSpec[] = [];

  const resolve = (name: string, request: string): string => {
    const pkg = packages.get(name);
    if (pkg === undefined) throw new PackSourceUnavailable(name, request, "not-found", "");
    if (pkg.versions.has(request)) return request;
    const tagged = pkg.tags.get(request) ?? (request === "latest" ? pkg.newest : undefined);
    if (tagged === undefined) throw new PackSourceUnavailable(name, request, "no-version", "");
    return tagged;
  };

  return {
    fetched,
    publish(name, version, tarball, options = {}) {
      const pkg = packages.get(name) ?? { versions: new Map(), tags: new Map(), newest: version };
      pkg.versions.set(version, { tarball, integrity: sriOf(tarball), corrupted: false });
      pkg.newest = version;
      for (const tag of options.tags ?? []) pkg.tags.set(tag, version);
      packages.set(name, pkg);
    },
    unreachable() {
      down = true;
    },
    corrupt(name, version) {
      const published = packages.get(name)?.versions.get(version);
      if (published !== undefined) published.corrupted = true;
    },
    async fetch(spec) {
      fetched.push(spec);
      if (down) throw new PackSourceUnavailable(spec.name, spec.request, "unreachable", "");
      const version = resolve(spec.name, spec.request);
      const published = packages.get(spec.name)!.versions.get(version)!;
      const bytes = published.corrupted ? new Uint8Array([...published.tarball, 0]) : published.tarball;
      const result: FetchedPackage = { name: spec.name, version, integrity: published.integrity, tarball: bytes };
      return checkedIntegrity(result);
    },
  };
}
