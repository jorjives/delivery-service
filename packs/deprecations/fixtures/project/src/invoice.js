import { legacyFormat } from "../lib/legacy-dates.js";

export const invoiceHeading = (number, issuedOn) => `Invoice ${number}, issued ${legacyFormat(issuedOn)}`;
