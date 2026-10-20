// Feature flags read from an object such as { "new-checkout": true }.
export function isOn(flags, name) {
  return flags[name] === true;
}
