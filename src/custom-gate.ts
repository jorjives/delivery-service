import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Gate, GateContext } from "./command-gate.js";
import { GateReport } from "./schema.js";
import { validateUniqueIds } from "./parsers.js";
import { GateModuleLoadFailure, InvalidGateExport, DuplicateIdError } from "./errors.js";

function errorReport(detail: string): GateReport {
  return { status: "ERROR", assertions: [], detail };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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

    try {
      validateUniqueIds(parsed.data.assertions);
    } catch (err) {
      if (err instanceof DuplicateIdError) {
        return errorReport(`Duplicate assertion ID: ${err.duplicateId}`);
      }
      throw err;
    }

    return parsed.data;
  };
}

/**
 * Load a user-supplied gate module. `modulePath` is resolved against
 * `baseDir` (the project root by default); absolute paths pass through
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
