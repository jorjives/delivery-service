import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ZodType } from "zod";
import { messageOf } from "./gate-support.js";

/** The typed errors a plugin kind throws, so gates and closers keep their own. */
export interface PluginErrors {
  loadFailure: new (modulePath: string, detail: string) => Error;
  invalidExport: new (modulePath: string, exportName: string, detail: string) => Error;
}

/**
 * Load a user-supplied plugin module (a custom gate or closer). A relative
 * `modulePath` is resolved against `repoPath`, the repository root: never the
 * worktree under judgement and never the process's working directory.
 * Absolute paths pass through unchanged. Throws `errors.loadFailure` if the
 * module cannot be imported and `errors.invalidExport` if the selected export
 * is not an object carrying every named method, both before any method is
 * called.
 */
export async function loadPlugin<T extends object>(
  repoPath: string,
  modulePath: string,
  exportName: string,
  methods: readonly (keyof T & string)[],
  errors: PluginErrors,
): Promise<T> {
  const absolutePath = resolve(repoPath, modulePath);

  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  } catch (err) {
    throw new errors.loadFailure(modulePath, messageOf(err));
  }

  const exported = loaded[exportName];
  if (typeof exported !== "object" || exported === null) {
    throw new errors.invalidExport(
      modulePath,
      exportName,
      exported === undefined ? "export not found" : "export is not an object",
    );
  }

  const candidate = exported as Record<string, unknown>;
  for (const method of methods) {
    if (typeof candidate[method] !== "function") {
      throw new errors.invalidExport(modulePath, exportName, `missing "${method}" method`);
    }
  }

  return exported as T;
}

/** Where a guarded call lives, for the error sentence a person reads. */
export interface PluginCallSite {
  plugin: string; // "Custom gate" | "Custom closer"
  reportName: string; // "GateReport" | "CloseReport"
  method: string;
  modulePath: string;
}

/**
 * Safety net: a plugin is third-party code. Whatever it throws, sync or async,
 * becomes `fail(detail)`, never an exception reaching the harness; and whatever
 * it returns must satisfy `schema` before the harness is allowed to believe it.
 */
export function guardMethod<A extends unknown[], R>(
  call: (...args: A) => Promise<R>,
  schema: ZodType<R>,
  fail: (detail: string) => R,
  where: PluginCallSite,
): (...args: A) => Promise<R> {
  return async (...args) => {
    let returned: unknown;
    try {
      returned = await call(...args);
    } catch (err) {
      return fail(`${where.plugin} "${where.modulePath}" threw during ${where.method}: ${messageOf(err)}`);
    }

    const parsed = schema.safeParse(returned);
    if (!parsed.success) {
      return fail(
        `${where.plugin} "${where.modulePath}" did not return a valid ${where.reportName} from ${where.method}: ${parsed.error.message}`,
      );
    }
    return parsed.data;
  };
}
