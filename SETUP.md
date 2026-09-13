# Setup

About ten minutes. No build step, no framework, no dependencies.

You need a Notion database of initiatives, and Node 18 or newer to serve the page.

## 1. Create a Notion integration

1. Go to <https://www.notion.so/my-integrations> and create a new **internal** integration.
2. Give it **read** content access. It never needs to write.
3. Copy the secret. It starts `ntn_`. Treat it like a password — it is not needed in the
   browser and must never be committed.

## 2. Connect it to your database

Open your database in Notion, then `•••` → **Connections** → **Connect to** → your
integration.

Without this the API returns an empty list even with a valid secret.

## 3. Find your data source id

Open the database as a full page. The URL looks like:

```
https://www.notion.so/workspace/abcdef1234567890abcdef1234567890?v=...
```

The 32-character string before the `?` is the id. Put it in
`roadmap-app/mapping.json` as `dataSourceId`, or set `DATA_SOURCE_ID` in the environment
(which takes precedence).

## 4. Point the mapping at your own properties

Open `roadmap-app/mapping.json` and change each `notion` value to match what your
properties are actually called:

```jsonc
"swimlane": { "notion": "Swimlane", "type": "select",
              "aliases": ["Lane", "Workstream", "Category"] }
```

Only two are needed for something to appear at all:

| Field | Notion type | Why it matters |
|---|---|---|
| `swimlane` | select | The inclusion filter. Untagged initiatives never appear. |
| `cd` *or* `ipStart` | date | Without a usable date there is no bar to draw. |

Everything else is optional and degrades gracefully: no RAG shows grey, no update shows an
empty card, no committed date shows no slippage.

Set `lanes` to your own swimlane options — order top to bottom, with colours.

## 5. Run it

```bash
cd roadmap-app
NOTION_TOKEN=ntn_your_secret_here node server.js
```

Open <http://localhost:3000>.

The badge top-right tells you what you are looking at:

| Badge | Meaning |
|---|---|
| Live from Notion | Fetched fresh |
| Last good data | The fetch failed; showing the previous good result |
| Preview data | Never reached Notion — this is the built-in demo, not your data |

If you see **Preview data**, the fetch failed. Check the terminal, and check the
integration is connected to the database.

## 6. Host it

`roadmap-app/api/roadmap.js` is a serverless function and `index.html` is static, so it
deploys to Vercel, Netlify or Cloudflare Pages as-is. Set `NOTION_TOKEN` as a secret
environment variable in the host's dashboard — never in the repo.

**Put it behind your organisation's login.** Everyone who can reach the page sees
everything the integration can read; the view does not apply per-viewer Notion
permissions. See [SECURITY.md](SECURITY.md).

## When Notion changes underneath you

Rename a property and the page keeps working if the old name is in `aliases`. If not, you
get an amber banner naming the property and what to edit — and the rest of the roadmap
still renders.

That is the whole point of `mapping.json`: schema changes are a config edit, not a code
change, and never a silent blank chart.

## Optional: the Claude route

`roadmap-claude/` publishes the roadmap as a page inside Claude that reads Notion through
each viewer's own connector, so colleagues can open a live view without you hosting
anything. See `roadmap-claude/PROJECT.md`. Entirely optional — the hosted page above is
the main path.
