import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { sriOf } from "../src/packs/install/pack-source.js";

/** How a test publishes a version: named tags it moves, and an integrity other than the tarball's own, to test refusal. */
export interface PublishOptions {
  tags?: readonly string[];
  integrity?: string;
}

/** A throwaway npm registry on 127.0.0.1 that a test publishes into and can take offline. */
export interface LocalRegistry {
  url: string;
  publish(name: string, version: string, tarball: Uint8Array, options?: PublishOptions): void;
  close(): Promise<void>;
}

interface PublishedVersion {
  name: string;
  version: string;
  tarball: string;
  integrity: string;
}

interface PublishedPackage {
  versions: Map<string, PublishedVersion>;
  distTags: Record<string, string>;
}

/** Starts the registry. Packuments are served at `/<name>`, tarballs at `/<name>/-/<file>.tgz`, and everything else is a 404. */
export async function startLocalRegistry(): Promise<LocalRegistry> {
  const packages = new Map<string, PublishedPackage>();
  const tarballs = new Map<string, Uint8Array>();
  let url = "";

  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const tarball = tarballs.get(path);
    if (tarball !== undefined) {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end(tarball);
      return;
    }
    const pkg = packages.get(path.slice(1));
    if (pkg !== undefined) {
      const versions = Object.fromEntries(
        [...pkg.versions].map(([version, published]) => [
          version,
          { name: published.name, version, dist: { tarball: published.tarball, integrity: published.integrity } },
        ]),
      );
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ name: path.slice(1), "dist-tags": pkg.distTags, versions }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    publish(name, version, tarball, options = {}) {
      const pkg: PublishedPackage = packages.get(name) ?? { versions: new Map(), distTags: {} };
      packages.set(name, pkg);
      const path = `/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
      tarballs.set(path, tarball);
      pkg.versions.set(version, { name, version, tarball: `${url}${path}`, integrity: options.integrity ?? sriOf(tarball) });
      pkg.distTags.latest = version;
      for (const tag of options.tags ?? []) pkg.distTags[tag] = version;
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
