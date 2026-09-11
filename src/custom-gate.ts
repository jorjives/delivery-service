import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Gate, GateContext } from "./command-gate.js";
import { GateReport } from "./schema.js";
import { GateModuleLoadFailure, InvalidGateExport } from "./errors.js";
import { errorReport, messageOf, duplicateIdReport } from "./gate-support.js";

// Safety net: a custom gate is third-party code. Whatever it throws — sync or
// async — becomes an ERROR report, never an exception reaching the harness; and
// whatever it returns must be a valid, duplicate-free GateReport before the
// harness is allowed to believe it.
function guard(
  call: (ctx: GateContext) => Promise<GateReport>,
  method: string,
  modulePath: string,
): (ctx: GateContext) => Promise<GateReport> {
  return async (ctx) => {
    let returned: unknown;
    try {
      returned = await call(ctx);
    } catch (err) {
      return errorReport(
        `Custom gate "${modulePath}" threw during ${method}: ${messageOf(err)}`,
      );
    }

    const parsed = GateReport.safeParse(returned);
    if (!parsed.success) {
      return errorReport(
        `Custom gate "${modulePath}" did not return a valid GateReport from ${method}: ${parsed.error.message}`,
      );
    }

    const dup = duplicateIdReport(parsed.data.assertions);
    if (dup) return dup;

    return parsed.data;
  };
}

/**
 * Load a user-supplied gate module. `modulePath` is resolved against
 * `baseDir` (the current working directory by default); absolute paths pass through
 * unchanged. Throws `GateModuleLoadFailure` if the module cannot be imported
 * and `InvalidGateExport` if the selected export is not a gate — both before
 * any gate method is called.
 */
export async function loadCustomGate(
  modulePath: string,
  exportName = "default",
  baseDir: string = process.cwd(),
): Promise<Gate> {
  const absolutePath = resolve(baseDir, modulePath);

  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  } catch (err) {
    throw new GateModuleLoadFailure(modulePath, messageOf(err));
  }

  const exported = loaded[exportName];
  if (typeof exported !== "object" || exported === null) {
    throw new InvalidGateExport(
      modulePath,
      exportName,
      exported === undefined ? "export not found" : "export is not an object",
    );
  }

  const candidate = exported as Partial<Gate>;
  for (const method of ["baseline", "check"] as const) {
    if (typeof candidate[method] !== "function") {
      throw new InvalidGateExport(modulePath, exportName, `missing "${method}" method`);
    }
  }

  const gate = exported as Gate;
  return {
    baseline: guard((ctx) => gate.baseline(ctx), "baseline", modulePath),
    check: guard((ctx) => gate.check(ctx), "check", modulePath),
  };
}

/**
 * A `Gate` that loads its module lazily and reports load failures as ERROR
 * reports rather than exceptions — the shape gate resolution needs, where
 * "failed to load" and "failed to run" must look the same to the caller.
 */
export function createCustomGate(
  modulePath: string,
  exportName?: string,
  baseDir?: string,
): Gate {
  let gate: Promise<Gate> | undefined;
  const run =
    (method: "baseline" | "check") =>
    async (ctx: GateContext): Promise<GateReport> => {
      gate ??= loadCustomGate(modulePath, exportName, baseDir);
      try {
        return await (await gate)[method](ctx);
      } catch (err) {
        return errorReport(messageOf(err));
      }
    };

  return { baseline: run("baseline"), check: run("check") };
}
