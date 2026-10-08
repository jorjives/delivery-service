import { applyDiscount, invoiceTotal } from "./invoice.js";
import { loadSettings } from "./settings.js";

const settings = loadSettings("settings.json");
console.log(applyDiscount(invoiceTotal(settings.lines, settings.taxPercent), settings.discountPercent));
