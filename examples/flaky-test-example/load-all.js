// Loads every id with `load`, all at once, and returns what each one loaded.
export async function loadAll(ids, load) {
  const results = [];
  await Promise.all(ids.map(async (id) => results.push(await load(id))));
  return results;
}
