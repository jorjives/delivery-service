# Flags are read from plain objects

## Problem

An early change read flags with `flags.get(name)`, as if they were a Map, and every flag was off.

## What worked

Flags arrive as a plain object parsed from JSON. Read them with `flags[name]`, and compare with
`=== true` so that a string "true" from a hand-edited file does not count as on.

## Next time

Check how a value is built before choosing how to read it: `grep -rn "flags" .`.
