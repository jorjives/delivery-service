/** `T` without its time, variant by variant, so a union of recorded steps stays the union it was. */
export type WithoutAt<T> = T extends unknown ? Omit<T, "at"> : never;

/**
 * Test support: recorded steps, or one of them, without the time each was
 * recorded. The one place a test that compares recorded steps exactly drops
 * the time, so the comparison is of what was recorded and never of when.
 */
export function withoutAt<T extends object>(entries: readonly T[]): WithoutAt<T>[];
export function withoutAt<T extends object>(entry: T): WithoutAt<T>;
export function withoutAt(value: object | readonly object[]): unknown {
  if (Array.isArray(value)) return value.map((entry: object) => withoutAt(entry));
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "at"));
}
