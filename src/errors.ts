export class FileNotFound extends Error {
  readonly code = "FILE_NOT_FOUND" as const;
  constructor(readonly surfaceDir: string, readonly filePath: string) {
    super(`Case file not found: ${filePath} in ${surfaceDir}`);
    this.name = "FileNotFound";
  }
}

export class CorruptCaseFile extends Error {
  readonly code = "CORRUPT_CASE_FILE" as const;
  constructor(
    readonly surfaceDir: string,
    readonly detail: string,
  ) {
    super(`Corrupt case file in ${surfaceDir}: ${detail}`);
    this.name = "CorruptCaseFile";
  }
}

export class ImmutabilityViolation extends Error {
  readonly code = "IMMUTABILITY_VIOLATION" as const;
  constructor(
    readonly surfaceDir: string,
    readonly field: string,
  ) {
    super(`Cannot overwrite ${field} in ${surfaceDir}: already set`);
    this.name = "ImmutabilityViolation";
  }
}

export class WriteFailure extends Error {
  readonly code = "WRITE_FAILURE" as const;
  constructor(
    readonly surfaceDir: string,
    readonly detail: string,
  ) {
    super(`Write failed in ${surfaceDir}: ${detail}`);
    this.name = "WriteFailure";
  }
}

export class ParseError extends Error {
  readonly code = "PARSE_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class DuplicateIdError extends Error {
  readonly code = "DUPLICATE_ID" as const;
  constructor(readonly duplicateId: string) {
    super(`DuplicateIdError: assertion ID "${duplicateId}" appears more than once`);
    this.name = "DuplicateIdError";
  }
}

export class GateModuleLoadFailure extends Error {
  readonly code = "GATE_MODULE_LOAD_FAILURE" as const;
  constructor(
    readonly modulePath: string,
    readonly detail: string,
  ) {
    super(`GateModuleLoadFailure: cannot load custom gate module "${modulePath}": ${detail}`);
    this.name = "GateModuleLoadFailure";
  }
}

export class InvalidGateExport extends Error {
  readonly code = "INVALID_GATE_EXPORT" as const;
  constructor(
    readonly modulePath: string,
    readonly exportName: string,
    readonly detail: string,
  ) {
    super(
      `InvalidGateExport: export "${exportName}" of "${modulePath}" is not a gate: ${detail}`,
    );
    this.name = "InvalidGateExport";
  }
}
