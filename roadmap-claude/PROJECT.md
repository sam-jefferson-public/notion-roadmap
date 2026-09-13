# The Claude route (optional)

A way to give colleagues a live roadmap without hosting anything.

`build-template.py` generates two pages from the same source as the hosted app:

| File | What it is | A viewer needs |
|---|---|---|
| `LIVE.html` | Published once as a Claude artifact. Queries Notion through **each viewer's own** connector when they open it. | Claude, the Notion connector, and access to the database |
| `TEMPLATE.html` | A snapshot. Rows are pasted in, then it is shared as a file. | nothing — it opens in any browser |

Because each viewer queries as themselves, they only ever see what their own Notion
permissions allow. That is stronger than the hosted page, which shows everyone everything
the integration can read.

## Why generate rather than copy

Both pages are **build output**. `build-template.py` assembles them from
`../roadmap-app/index.html`, `notion.js` and `mapping.json`, so the renderer is not
duplicated and cannot drift. Re-run it after any change:

```bash
cd roadmap-claude && python3 build-template.py
```

Never edit `LIVE.html` or `TEMPLATE.html` by hand — the next build overwrites them.

## The design rule

**The template carries the adapter; the model only moves data.**

A naive version would ask a model to read the database and draw a roadmap, re-deriving the
field mapping every run with nothing to check it against. Instead the page embeds the same
tested adapter the hosted app uses, so RAG canonicalisation, the swimlane filter, sub-item
linking and the committed-date rules all run in code. The model runs one fixed query and
pastes the rows into a placeholder.

The only piece unique to this route is `sql-shim.js`, which re-wraps the connector's
flattened rows into the shape the adapter expects. It is deliberately small and covered by
`test-shim.js` (28 checks).

## Setting it up

1. Run `python3 build-template.py`.
2. Publish `LIVE.html` as a Claude artifact declaring the `mcp` capability for your Notion
   connector, and `downloads` if you want the export button.
3. Replace the data source id in the generated query with your own.

For the snapshot route, put `TEMPLATE.html` in a Claude project's knowledge and instruct
it to run the query, replace `/*__ROWS__*/` with the results and `/*__GENERATED_AT__*/`
with the current time, and change nothing else.

## Honest limitations

- A snapshot costs roughly 21,000 tokens of model output per run, because the model
  re-emits the whole page. It takes a couple of minutes. The live page costs nothing per
  refresh, which is why it is the preferred route.
- An artifact link is a page on claude.ai and needs a Claude account either way. Only the
  exported **file** reaches someone without one.
- A capability grant bars public sharing of the artifact.
