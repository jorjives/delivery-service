// Converts between metric and imperial units for a recipe site.
export function gramsToOunces(grams) {
  return Math.round(grams / 28.35);
}

export function celsiusToFahrenheit(celsius) {
  return Math.round(celsius * 9 / 5 + 32);
}
