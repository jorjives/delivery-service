import { formatDate } from "../lib/legacy-dates.js";

export const dueLine = (due) => `Payment due by ${formatDate(due)}`;
