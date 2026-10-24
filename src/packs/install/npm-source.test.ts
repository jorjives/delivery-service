import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, it, expect } from "vitest";
import { startLocalRegistry, type LocalRegistry } from "../../../tests/local-registry.js";
import { npmSource } from "./npm-source.js";
import { packSourceContract } from "./pack-source.contract.js";
import { sriOf } from "./pack-source.js";
import { packageTarball } from "./tarball.js";

const registries: LocalRegistry[] = [];
afterAll(async () => {
  await Promise.all(registries.map((registry) => registry.close()));
});

async function openRegistry(): Promise<LocalRegistry> {
  const registry = await startLocalRegistry();
  registries.push(registry);
  return registry;
}

/** An environment that makes the real npm talk only to the local registry, with its own cache and no user config. */
function npmEnv(url: string): NodeJS.ProcessEnv {
  const userconfig = join(mkdtempSync(join(tmpdir(), "npm-userconfig-")), "npmrc");
  writeFileSync(userconfig, "");
  return {
    ...process.env,
    npm_config_registry: url,
    npm_config_cache: mkdtempSync(join(tmpdir(), "npm-cache-")),
    npm_config_userconfig: userconfig,
    npm_config_fetch_retries: "0",
  };
}

const scratchFolders = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith("delivery-npm-"));

packSourceContract("npm", async () => {
  const registry = await openRegistry();
  const env = npmEnv(registry.url);
  return {
    source: npmSource(env),
    publish: async (name, version, tarball, options) => registry.publish(name, version, tarball, options),
    unreachable: async () => {
      await registry.close();
    },
    corrupt: async (name, version) =>
      registry.publish(name, version, packageTarball({ "pack.json": "{}" }, { name, version, "delivery-pack": "." }), {
        integrity: sriOf(new Uint8Array([1])),
      }),
  };
});

it("resolves a range to the exact version npm picks", async () => {
  const registry = await openRegistry();
  const env = npmEnv(registry.url);
  for (const version of ["1.0.0", "1.2.0", "2.0.0"]) {
    registry.publish("ranged", version, packageTarball({ "pack.json": "{}" }, { name: "ranged", version, "delivery-pack": "." }));
  }
  expect(await npmSource(env).fetch({ name: "ranged", request: "^1.0.0", typed: true })).toMatchObject({ version: "1.2.0" });
});

it("says npm was not found when DELIVERY_NPM names nothing", async () => {
  const registry = await openRegistry();
  const env = npmEnv(registry.url);
  await expect(
    npmSource({ ...env, DELIVERY_NPM: join(tmpdir(), "no-npm-here", "npm") }).fetch({ name: "x", request: "latest", typed: false }),
  ).rejects.toMatchObject({ code: "PACK_SOURCE_UNAVAILABLE", reason: "no-npm" });
});

it("runs no install script of the package: no file the script would create appears", async () => {
  const registry = await openRegistry();
  const env = npmEnv(registry.url);
  const marker = join(mkdtempSync(join(tmpdir(), "marker-")), "ran");
  const script = `node -e "require('fs').writeFileSync('${marker}','')"`;
  registry.publish(
    "scripted",
    "1.0.0",
    packageTarball(
      { "pack.json": "{}" },
      {
        name: "scripted",
        version: "1.0.0",
        "delivery-pack": ".",
        scripts: { preinstall: script, install: script, postinstall: script, prepare: script, prepack: script, postpack: script },
      },
    ),
  );
  await npmSource(env).fetch({ name: "scripted", request: "1.0.0", typed: true });
  expect(existsSync(marker)).toBe(false);
});

it("leaves no scratch folder behind, after a fetch or a failure", async () => {
  const registry = await openRegistry();
  const env = npmEnv(registry.url);
  registry.publish("tidy", "1.0.0", packageTarball({ "pack.json": "{}" }, { name: "tidy", version: "1.0.0", "delivery-pack": "." }));
  const before = scratchFolders().length;
  await npmSource(env).fetch({ name: "tidy", request: "1.0.0", typed: true });
  await expect(npmSource(env).fetch({ name: "no-such-tidy", request: "latest", typed: false })).rejects.toThrow();
  expect(scratchFolders().length).toBe(before);
});
