import { z } from "zod";

/** Why a sequence waits on its earliest undelivered item: parked, waiting for the operator's answer, or being worked (spec §5.10). */
export const HoldReason = z.enum(["parked", "decision", "in_flight"]);
export type HoldReason = z.infer<typeof HoldReason>;

/** A sequence that has items waiting behind its earliest undelivered one, why that one has not moved on, and the source that listed it. */
export const Held = z.object({ sequence: z.string(), item: z.string(), source: z.string(), reason: HoldReason });
export type Held = z.infer<typeof Held>;
