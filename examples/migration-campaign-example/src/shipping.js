import { formatDate, formatDateTime } from "../lib/legacy-dates.js";

export const dispatched = (at) => `Dispatched ${formatDateTime(at)}`;
export const expected = (day) => `Expected ${formatDate(day)}`;
