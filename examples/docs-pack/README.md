# Keep the documentation true: a pack with settings

This is a `delivery.pack/3` pack with one find and one act. The find compares the pages in a folder with the code; the act fixes one page. It declares two settings. `docs-folder` is the folder that holds the pages, with the default `docs`. `hold-from` is the severity from which a fix waits for your sign-off, with the default `high`.

To try it, list this folder under `packs` in your `delivery.config.json`, then run `delivery preview --workflow docs:fix`. The step text names `docs`, and the line beneath it says the folder came from the default.

To use your own folder, add this to `delivery.config.json` and run the preview again:

```json
"packSettings": { "docs": { "docs-folder": "handbook" } }
```

The step text now names `handbook`, and the line beneath it says the value came from your configuration.

A fix of a page rated high or critical waits for your sign-off before it lands. To be asked sooner, give `hold-from` a lower severity in the same entry:

```json
"packSettings": { "docs": { "docs-folder": "handbook", "hold-from": "medium" } }
```

With that value, a fix of a page rated medium or more waits for your sign-off. `delivery packs inspect docs` shows the hold in effect and where it came from.
