# mekko-mix — source

The sibling `index.html` and `assets/` are the **built** plugin that Sigma
loads. This directory is the source it was built from.

It is here because `sigma-plugin-kit` gitignores `plugins/*/`, on the
assumption that the working copy lives on a developer's own disk. A Claude
Code on the web session has no such disk — the container is reclaimed when the
session ends — so without this the plugin would only ever exist as a bundle,
and the next edit would mean rewriting it.

To iterate:

```bash
# from a sigma-plugin-kit checkout
bash scripts/new-plugin.sh mekko-mix "Revenue Mix Mekko"
cp -R <this dir>/src <this dir>/index.html <this dir>/vite.config.js \
      <this dir>/package.json plugins/mekko-mix/
cd plugins/mekko-mix && npm install && npm run dev
```

Then ship the edit with `bash scripts/pipeline.sh mekko-mix --redeploy`, which
rebuilds and republishes the bundle without touching the `pluginId` or the
workbook.

## Editor panel

Three column bindings, so a workbook spec's plugin `config` must name all
three:

| binding | type | what it is |
| --- | --- | --- |
| `category` | text | the mosaic's columns — width is its share of the grand total |
| `segment` | text | the stack within a column — height is its share of that column |
| `value` | number | the measure both shares are computed from |

Plus a `selectedSegment` variable: clicking a tile writes its segment name into
a bound workbook control, so the rest of the workbook can filter on it.
