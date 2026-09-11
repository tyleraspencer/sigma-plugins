# sigma-plugins

Public hosting for Sigma Computing custom-viz plugins, served via GitHub Pages.

Each plugin is a single self-contained `index.html` that loads the Sigma plugin
SDK from unpkg, so there is no build step and no bundler.

    plugins/<plugin-name>/index.html
      -> https://tyleraspencer.github.io/sigma-plugins/plugins/<plugin-name>/index.html

That URL is what you register with a Sigma org via `POST /v2/plugins`.

**This repo is public on purpose.** Sigma renders a plugin in an iframe and must
be able to fetch the URL anonymously; a private repo's Pages output cannot be.
Nothing secret belongs here — no tokens, no `.env`, no customer data.

**Serve from GitHub Pages, not jsDelivr.** jsDelivr returns `.html` as
`text/plain`, which renders the plugin as raw source text and hangs PNG export.

Plugins here are built and deployed by the private `sigma-plugin-kit` toolkit.
