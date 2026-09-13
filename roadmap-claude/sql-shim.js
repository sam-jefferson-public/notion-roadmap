// Translate the rows Notion's MCP connector returns (SQL-flattened) into the page shape
// the real adapter expects, so adapt() and reviewBaselines() in notion.js do the actual
// work. Nothing here canonicalises RAG, applies excludeStatus, resolves swimlanes or
// judges baselines: that all stays in the tested adapter. This shim only re-wraps values.
//
// Keeping it this thin is the point. It is the only code in the Claude-project path that
// does not already have a test suite behind it, so it must stay boring.

// A Notion page URL ends in the page id with the dashes stripped:
//   https://app.notion.com/11111111111111111111111111111111
function idFromUrl(url) {
  if (!url) return null;
  var m = String(url).match(/([0-9a-fA-F]{32})(?:[?#].*)?$/);
  return m ? m[1].toLowerCase() : null;
}

// Every mapped property is emitted even when empty. Notion returns the key with a null
// value for an unset field, and the adapter uses "was this key ever seen?" to detect a
// renamed field. Omitting an all-empty column would raise a schema-drift warning on every
// snapshot where nobody happened to fill it in.
// The SQL connector returns url as https://app.notion.com/<id>, which 404s in Notion.
// The canonical form carries a /p/ segment: https://app.notion.com/p/<id>. Rebuilding from
// the id is idempotent, so a URL that already has /p/ (or a www.notion.so title slug) comes
// back canonical rather than mangled.
function pageUrl(url) {
  var id = idFromUrl(url);
  return id ? "https://app.notion.com/p/" + id : (url || null);
}

function txt(v)  { return v == null || v === "" ? { rich_text: [] } : { rich_text: [{ plain_text: String(v) }] }; }
function ttl(v)  { return v == null || v === "" ? { title: [] }     : { title: [{ plain_text: String(v) }] }; }
function sel(v)  { return v == null || v === "" ? { select: null }  : { select: { name: String(v) } }; }
function stat(v) { return v == null || v === "" ? { status: null }  : { status: { name: String(v) } }; }
function date(s, e) {
  if (s == null && e == null) return { date: null };
  return { date: { start: s || null, end: e || null } };
}

// "Parent item" arrives as a JSON string holding page URLs, or occasionally already parsed.
function relation(v) {
  var arr = v;
  if (typeof v === "string") {
    try { arr = JSON.parse(v); } catch (e) { return { relation: [] }; }
  }
  if (!Array.isArray(arr)) return { relation: [] };
  return {
    relation: arr.map(function (u) {
      var id = idFromUrl(typeof u === "string" ? u : (u && u.url));
      return id ? { id: id } : null;
    }).filter(Boolean)
  };
}

// One SQL row -> one Notion-shaped page. Property names must match mapping.json.
// Anything that is not an object becomes an empty page rather than throwing: this runs on
// whatever a query returned, and one odd row must not lose the whole roadmap.
function sqlRowToPage(r) {
  if (!r || typeof r !== "object") r = {};
  return {
    id: idFromUrl(r.url),
    url: pageUrl(r.url),
    properties: {
      "Initiative Name":        ttl(r.name),
      "Swimlane":            sel(r.lane),
      "Status":                 stat(r.status),
      "RAG":                    sel(r.rag),
      "Committed Date": date(r.baseline, null),
      "Delivery Dates": date(r.cd_start, r.cd_end),
      "Discovery Dates":        date(r.disc_start, r.disc_end),
      "Discovery start":        date(r.disc_legacy, null),
      "In Progress start":      date(r.ip_start, null),
      "Done date":              date(r.done_date, null),
      "Description":            txt(r.description),
      // `update` is a reserved SQL word, so the query aliases it latest_update. Accept the
      // plain name too, so row dumps taken before that fix still load.
      "Latest Update":             txt(r.latest_update != null ? r.latest_update : r.update),
      "Update Last Edited": date(r.update_at, null),
      "Parent item":            relation(r.parent)
    }
  };
}

function sqlRowsToPages(rows) {
  return (Array.isArray(rows) ? rows : []).map(sqlRowToPage);
}

if (typeof module !== "undefined") module.exports = { sqlRowToPage, sqlRowsToPages, idFromUrl, pageUrl };
