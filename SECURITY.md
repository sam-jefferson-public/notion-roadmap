# Security notes

## Your Notion token never reaches the browser

The integration secret is held server-side (`NOTION_TOKEN`) and the browser only ever
sees `/api/roadmap`, which returns the already-mapped rows. That is the reason this is a
hosted page rather than a static file you open directly — a static page would have to
carry the token to call Notion, and anyone could read it.

Give the integration **read** content access only. It never needs to write.

## What the page exposes

Everyone who can reach the page sees every initiative the integration can read. The view
does **not** apply per-viewer Notion permissions. Put it behind whatever authentication
your organisation already uses; do not put it on the open internet.

## Exported files

The export writes a self-contained HTML file with the data baked into it. That file needs
no login and cannot be recalled once sent. Treat one like a spreadsheet of the same data.
`.gitignore` excludes `Roadmap-*.html` so an export is never committed by accident.

## Reporting something

If you find a security problem, please open an issue describing the impact rather than a
working exploit.
