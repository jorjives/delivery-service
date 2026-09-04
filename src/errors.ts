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
