import { fakePackSource, type FakePackSource } from "../packs/install/fake-source.js";
import { packPackage } from "../packs/install/install-fixtures.js";
import { EXIT } from "./failures.js";
import { context, scriptedAsk } from "./init-fixtures.js";
import { packsAddCommand } from "./packs-add-command.js";

/** Test support: `@acme/delivery-pack-docs` 1.2.0 added to `repo` with a yes, as `delivery packs add` keeps it. Returns the source it came from. */
export async function addedDocsDrift(repo: string): Promise<FakePackSource> {
  const source = fakePackSource();
  source.publish("@acme/delivery-pack-docs", "1.2.0", packPackage());
  const { ctx } = context(repo);
  const exit = await packsAddCommand("@acme/delivery-pack-docs", ctx, scriptedAsk({ confirm: true }).ask, source);
  if (exit !== EXIT.ok) throw new Error(`the fixture pack did not add: exit ${exit}`);
  return source;
}
