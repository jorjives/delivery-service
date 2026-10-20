# string-kit API

Small string helpers.

### slug(text)

Lower-cases the text and joins its words with hyphens.

```js
slug(" Hello, World! ") // => "hello-world"
```

### truncate(text, length)

Cuts the text to `length` characters, ending with three dots when it was cut.

```js
truncate("abcdef", 4) // => "a..."
```

### reverse(text)

Reverses the text.

```js
reverse("abc") // => "cba"
```
