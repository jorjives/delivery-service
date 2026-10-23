import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createSystemctlStandIn } from "./systemctl-stand-in.js";

describe("systemctl stand-in", () => {
  it("answers show for one unit with its own properties, and the rest with the shared ones", () => {
    const standIn = createSystemctlStandIn();
    standIn.showing({ UnitFileState: "disabled" });
    standIn.showingFor("a.timer", { UnitFileState: "enabled" });
    expect(execFileSync(standIn.command, ["--user", "show", "a.timer", "-p", "UnitFileState"], { encoding: "utf-8" })).toBe("UnitFileState=enabled\n");
    expect(execFileSync(standIn.command, ["--user", "show", "b.timer", "-p", "UnitFileState"], { encoding: "utf-8" })).toBe("UnitFileState=disabled\n");
  });
});
