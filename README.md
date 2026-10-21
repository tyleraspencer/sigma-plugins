# sigma-plugins

Public hosting for Sigma Computing custom-viz plugins, served via GitHub Pages.

Each plugin is the built output of a Vite + React project — an `index.html` plus
the bundle it names under `assets/`, with the Sigma plugin SDK bundled in. The
whole `dist/` tree is published, so a plugin is a directory, not one file.

    plugins/<plugin-name>/index.html
    plugins/<plugin-name>/assets/
      -> https://tyleraspencer.github.io/sigma-plugins/plugins/<plugin-name>/index.html

That URL is what you register with a Sigma org via `POST /v2/plugins`.

**This repo is public on purpose.** Sigma renders a plugin in an iframe and must
be able to fetch the URL anonymously; a private repo's Pages output cannot be.
Nothing secret belongs here — no tokens, no `.env`, no customer data.

**Serve from GitHub Pages, not jsDelivr.** jsDelivr returns `.html` as
`text/plain`, which renders the plugin as raw source text and hangs PNG export.

Plugins here are built and deployed by the private `sigma-plugin-kit` toolkit.
Don't hand-edit anything under `plugins/` — `deploy-plugin.sh` replaces a
plugin's directory wholesale on every deploy, so edits made here are lost
without warning. Change the source in the kit and re-deploy.
