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

/** The record a run of several tasks keeps of itself (`run.json`), missing: never a per-task case file. */
export class RunFileNotFound extends Error {
  readonly code = "RUN_FILE_NOT_FOUND" as const;
  constructor(readonly runDir: string, readonly filePath: string) {
    super(`Run record not found: ${filePath} in ${runDir}`);
    this.name = "RunFileNotFound";
  }
}

/** The record a run of several tasks keeps of itself, unreadable: never a per-task case file. */
export class CorruptRunFile extends Error {
  readonly code = "CORRUPT_RUN_FILE" as const;
  constructor(
    readonly runDir: string,
    readonly detail: string,
  ) {
    super(`Corrupt run record in ${runDir}: ${detail}`);
    this.name = "CorruptRunFile";
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

export class CloserModuleLoadFailure extends Error {
  readonly code = "CLOSER_MODULE_LOAD_FAILURE" as const;
  constructor(
    readonly modulePath: string,
    readonly detail: string,
  ) {
    super(`CloserModuleLoadFailure: cannot load custom closer module "${modulePath}": ${detail}`);
    this.name = "CloserModuleLoadFailure";
  }
}

export class InvalidCloserExport extends Error {
  readonly code = "INVALID_CLOSER_EXPORT" as const;
  constructor(
    readonly modulePath: string,
    readonly exportName: string,
    readonly detail: string,
  ) {
    super(`InvalidCloserExport: export "${exportName}" of "${modulePath}" is not a closer: ${detail}`);
    this.name = "InvalidCloserExport";
  }
}

export class MissingBaseline extends Error {
  readonly code = "MISSING_BASELINE" as const;
  constructor(readonly surfaceDir: string) {
    super(`No baseline recorded in ${surfaceDir}: run the gate's baseline before check`);
    this.name = "MissingBaseline";
  }
}

export class ProvisioningFailure extends Error {
  readonly code = "PROVISIONING_FAILURE" as const;
  constructor(
    readonly surfaceDir: string,
    readonly detail: string,
  ) {
    super(`Provisioning failed for ${surfaceDir}: ${detail}`);
    this.name = "ProvisioningFailure";
  }
}

export class IllegalStateTransition extends Error {
  readonly code = "ILLEGAL_STATE_TRANSITION" as const;
  constructor(
    readonly surfaceDir: string,
    readonly state: string,
    readonly edge: string,
  ) {
    super(
      `No "${edge}" edge from state ${state} in ${surfaceDir}: ` +
        `the driver has no transition to take from here`,
    );
    this.name = "IllegalStateTransition";
  }
}

export class InvalidRoleConfig extends Error {
  readonly code = "INVALID_ROLE_CONFIG" as const;
  constructor(
    readonly field: string,
    readonly detail: string,
  ) {
    super(`Invalid role config: ${field} ${detail}`);
    this.name = "InvalidRoleConfig";
  }
}

export class MockNotInstalled extends Error {
  readonly code = "MOCK_NOT_INSTALLED" as const;
  constructor(readonly path: string) {
    super(
      `claude-mock was not found at ${path}. Run npm install in the harness checkout: it installs claude-mock from vendor/claude-mock.`,
    );
    this.name = "MockNotInstalled";
  }
}
