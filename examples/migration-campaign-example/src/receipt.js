import { formatDateTime } from "../lib/legacy-dates.js";

export const stamp = (at) => `Paid ${formatDateTime(at)}`;
