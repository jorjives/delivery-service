export function slug(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function truncate(text, length) {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

export function titleCase(text) {
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
