// A personal reading list, kept as a plain array of books. See docs/spec.md.
export function add(list, book) {
  return [...list, { title: book.title, author: book.author }];
}
