# Reading list: specification

A module for keeping a personal reading list. Every requirement has an id in square brackets.
A requirement is done when a test named after its id passes, for example `test("R1: ...")`.

## Requirements

- [R1] `add(list, book)` returns a new list with the book added, where a book is
  `{ title, author }`. The list it was given is unchanged.
- [R2] `markRead(list, title, date)` returns a new list in which that book records the date it
  was read. A title that is not on the list throws an error naming the title.
- [R3] `unread(list)` returns the books not yet read, in the order they were added.
- [R4] `readIn(list, year)` returns how many books were read in that calendar year.

## Out of scope

Saving the list to disk, and any user interface.
