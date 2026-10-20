// Looks up the price of each product, all at once.
export async function pricesFor(products, lookup) {
  const prices = [];
  await Promise.all(products.map(async (product) => prices.push(await lookup(product))));
  return prices;
}
