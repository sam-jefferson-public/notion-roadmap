// Serverless function (Vercel / Node 18+). Thin wrapper over the shared adapter in
// ../notion.js so there is exactly ONE Notion-mapping implementation for the web app.
// All field mapping and schema-resilience lives in notion.js + mapping.json.
//
// Env vars (set in the host, never sent to the browser):
//   NOTION_TOKEN     - internal integration secret (read-only)
//   DATA_SOURCE_ID   - optional override of mapping.json's dataSourceId

const { fetchInitiatives } = require("../notion");

module.exports = async function handler(req, res) {
  try {
    const payload = await fetchInitiatives();
    // Cache at the edge for 5 min so the embed is fast; refresh happens in background.
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(payload);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e) });
  }
};
