import { describe, expect, it } from "vitest";
import { builtInPackClash, builtInWorkflowClash, clashSentence, type Clash, type ClashSide, packNameClash, packWorkflowClash, sidePhrase } from "./pack-clash.js";

const FOLDER = { kind: "folder", pack: "mine", manifestFile: "/p/mine/pack.json" } as const;
const BUILT_IN = { kind: "built-in", pack: "code" } as const;
const INSTALLED = { kind: "installed", pack: "moves", package: "@acme/moves", version: "3.0.0" } as const;
const OWN = { kind: "own" } as const satisfies ClashSide;

describe("sidePhrase", () => {
  it("names a workflow in the configuration", () => {
    expect(sidePhrase(OWN)).toBe("a workflow in your configuration");
  });

  it("names a built-in pack and says it comes with the harness", () => {
    expect(sidePhrase(BUILT_IN)).toBe(`"code", a pack that comes with the harness`);
  });

  it("names a listed folder by its manifest file", () => {
    expect(sidePhrase(FOLDER)).toBe("the pack in /p/mine/pack.json");
  });

  it("names an added pack by its npm package and version", () => {
    expect(sidePhrase(INSTALLED)).toBe("the pack added from @acme/moves 3.0.0");
  });
});

describe("clashSentence", () => {
  it("routes a built-in name shared with a listed folder to the built-in sentence", () => {
    const clash: Clash = { kind: "pack-name", name: "code", first: BUILT_IN, second: { kind: "folder", pack: "code", manifestFile: "/p/code/pack.json" } };
    expect(clashSentence(clash)).toBe(builtInPackClash("code", "/p/code/pack.json"));
  });

  it("routes a project workflow named like a built-in's to the built-in workflow sentence", () => {
    const clash: Clash = { kind: "workflow", workflow: "code:fix", first: OWN, second: BUILT_IN };
    expect(clashSentence(clash)).toBe(builtInWorkflowClash("code:fix", "code"));
  });

  it("names a folder and an added pack that share a name, keeping the added one by removing the folder", () => {
    const clash: Clash = { kind: "pack-name", name: "moves", first: FOLDER, second: INSTALLED };
    expect(clashSentence(clash)).toBe(
      `Two packs are named "moves": the pack in /p/mine/pack.json, and the pack added from @acme/moves 3.0.0. To keep the second, take the first out of packs in your configuration.`,
    );
  });

  it("names an added pack and a later built-in that share a name, removing the added one", () => {
    const clash: Clash = { kind: "pack-name", name: "code", first: BUILT_IN, second: { ...INSTALLED, pack: "code", package: "@acme/code" } };
    expect(clashSentence(clash)).toBe(
      `Two packs are named "code": "code", a pack that comes with the harness, and the pack added from @acme/code 3.0.0. A pack that comes with the harness cannot be removed, so remove the added one: delivery packs remove code`,
    );
  });

  it("names an added pack that a folder shares a name with, removing the first by its pack name", () => {
    const clash: Clash = { kind: "pack-name", name: "moves", first: INSTALLED, second: FOLDER };
    expect(clashSentence(clash)).toBe(
      `Two packs are named "moves": the pack added from @acme/moves 3.0.0, and the pack in /p/mine/pack.json. To keep the second, remove the first with: delivery packs remove moves`,
    );
  });

  it("names a project workflow and an added pack's workflow, asking the project to rename its own", () => {
    const clash: Clash = { kind: "workflow", workflow: "moves:scan", first: OWN, second: INSTALLED };
    expect(clashSentence(clash)).toBe(
      `Two things define the workflow "moves:scan": a workflow in your configuration, and the pack added from @acme/moves 3.0.0. Rename your own workflow so each name is used once.`,
    );
  });
});

describe("packWorkflowClash", () => {
  it("names an added first pack by its removal command when the second is a folder", () => {
    expect(packWorkflowClash("moves:scan", INSTALLED, FOLDER)).toBe(
      `Two things define the workflow "moves:scan": the pack added from @acme/moves 3.0.0, and the pack in /p/mine/pack.json. To keep the second, remove the first with: delivery packs remove moves`,
    );
  });

  it("names a built-in first and an added second by the removal of the added one", () => {
    expect(packWorkflowClash("code:scan", BUILT_IN, INSTALLED)).toBe(
      `Two things define the workflow "code:scan": "code", a pack that comes with the harness, and the pack added from @acme/moves 3.0.0. A pack that comes with the harness cannot be removed, so remove the added one: delivery packs remove moves`,
    );
  });

  it("names a built-in first and a folder second by the name of the second", () => {
    expect(packWorkflowClash("code:scan", BUILT_IN, FOLDER)).toBe(
      `Two things define the workflow "code:scan": "code", a pack that comes with the harness, and the pack in /p/mine/pack.json. A pack that comes with the harness cannot be removed, so change the "name" of the second so each pack is named once.`,
    );
  });
});

describe("packNameClash", () => {
  it("names a built-in and a listed folder that share a name, changing the folder's name", () => {
    expect(packNameClash("code", BUILT_IN, FOLDER)).toBe(
      `Two packs are named "code": "code", a pack that comes with the harness, and the pack in /p/mine/pack.json. A pack that comes with the harness cannot be removed, so change the "name" of the second so each pack is named once.`,
    );
  });
});
