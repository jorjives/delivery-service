# Keep the documentation true: a pack with a setting

This is a `delivery.pack/3` pack with one find and one act. The find compares the pages in a folder with the code; the act fixes one page. It declares one setting, `docs-folder`, with the default `docs`.

To try it, list this folder under `packs` in your `delivery.config.json`, then run `delivery preview --workflow docs:fix`. The step text names `docs`, and the line beneath it says the folder came from the default.

To use your own folder, add this to `delivery.config.json` and run the preview again:

```json
"packSettings": { "docs": { "docs-folder": "handbook" } }
```

The step text now names `handbook`, and the line beneath it says the value came from your configuration.
