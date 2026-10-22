import { describe, expect, it } from "vitest";
import type { SchedulerBackend } from "./backend.js";
import { DEFAULT_NAME, parseInterval, type Schedule } from "./model.js";

/** What a contract run needs: the adapter, the environment it runs under, and fresh repository paths. */
export interface ContractRig {
  backend: SchedulerBackend;
  env: NodeJS.ProcessEnv;
  /** A fresh repository path; with a suffix, that path's sibling with the suffix appended. */
  repo(suffix?: string): string;
}

const at = (repoPath: string, name: string, every: string): Schedule => ({
  repoPath,
  name,
  every: parseInterval(every),
  launcher: { node: "/usr/bin/node", main: "/opt/delivery/dist/cli/main.js", path: "/usr/local/bin:/usr/bin" },
});

/** The behaviour every scheduler adapter must have. An adapter's test file calls this once with its rig. The rig must report every installed schedule as enabled. */
export function backendContract(label: string, rig: () => ContractRig): void {
  describe(`${label} scheduler backend contract`, () => {
    it("lists a schedule once it is installed", async () => {
      const { backend, env, repo } = rig();
      const path = repo();
      await backend.install(at(path, "nightly", "1d"), env);
      expect(await backend.list(path, env)).toMatchObject([{ name: "nightly", every: "1d", enabled: true }]);
    });

    it("replaces a schedule installed again under the same name", async () => {
      const { backend, env, repo } = rig();
      const path = repo();
      await backend.install(at(path, "hourly", "1h"), env);
      await backend.install(at(path, "hourly", "6h"), env);
      expect(await backend.list(path, env)).toMatchObject([{ name: "hourly", every: "6h" }]);
    });

    it("keeps two names side by side, the default first", async () => {
      const { backend, env, repo } = rig();
      const path = repo();
      await backend.install(at(path, "nightly", "1d"), env);
      await backend.install(at(path, DEFAULT_NAME, "1d"), env);
      expect((await backend.list(path, env)).map((schedule) => schedule.name)).toEqual([DEFAULT_NAME, "nightly"]);
    });

    it("replacing one name leaves the others untouched", async () => {
      const { backend, env, repo } = rig();
      const path = repo();
      await backend.install(at(path, DEFAULT_NAME, "1d"), env);
      await backend.install(at(path, "hourly", "1h"), env);
      await backend.install(at(path, "hourly", "6h"), env);
      const listed = await backend.list(path, env);
      expect(listed).toHaveLength(2);
      expect(listed.find((schedule) => schedule.name === DEFAULT_NAME)?.every).toBe("1d");
    });

    it("keeps repositories apart, even one whose path extends another's", async () => {
      const { backend, env, repo } = rig();
      const path = repo();
      const sibling = repo(".c");
      await backend.install(at(path, DEFAULT_NAME, "1d"), env);
      await backend.install(at(path, "nightly", "1d"), env);
      await backend.install(at(sibling, "nightly", "1h"), env);
      expect(await backend.list(path, env)).toMatchObject([{ name: DEFAULT_NAME }, { name: "nightly", every: "1d" }]);
      expect(await backend.list(sibling, env)).toMatchObject([{ name: "nightly", every: "1h" }]);
    });

    it("removes a schedule once, and says when there was nothing to remove", async () => {
      const { backend, env, repo } = rig();
      const path = repo();
      await backend.install(at(path, DEFAULT_NAME, "1d"), env);
      await backend.install(at(path, "nightly", "1d"), env);
      expect(await backend.remove(path, "nightly", env)).toBe(true);
      expect(await backend.remove(path, "nightly", env)).toBe(false);
      expect((await backend.list(path, env)).map((schedule) => schedule.name)).toEqual([DEFAULT_NAME]);
    });

    it("lists nothing for a repository with no schedules", async () => {
      const { backend, env, repo } = rig();
      expect(await backend.list(repo(), env)).toEqual([]);
    });

    it("gives each schedule its own log command", () => {
      const { backend, repo } = rig();
      const path = repo();
      expect(backend.logCommand(path, DEFAULT_NAME)).not.toBe(backend.logCommand(path, "nightly"));
    });
  });
}
