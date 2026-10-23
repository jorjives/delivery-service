import { legacyFormat } from "../lib/legacy-dates.js";

export const receiptLine = (amount, paidOn) => `Paid ${amount} on ${legacyFormat(paidOn)}`;
