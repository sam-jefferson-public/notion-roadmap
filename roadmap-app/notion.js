// Anti-corruption layer between Notion and the app.
//
// The renderer only ever sees the app's stable internal shape (see `adapt` below).
// Everything that ties us to Notion's *current* structure — property names, types,
// value synonyms, excluded statuses and lane presentation — lives in mapping.json,
// the single source of truth. So if someone renames "Swimlane", retypes RAG from
// emoji to words, or adds/removes fields, you fix mapping.json (a config edit) and the
// view keeps working. It never hard-crashes on a schema change, and anything it can't
// place is surfaced as a warning instead of silently vanishing.
//
// Shared by server.js (self-hosted) and api/roadmap.js (serverless). The Tauri app has
// a parallel Rust implementation driven by a mirror of mapping.json.
//
// Required environment variables:
//   NOTION_TOKEN     - internal integration secret (read-only)
//   DATA_SOURCE_ID   - overrides mapping.json's dataSourceId if the DB is rebuilt

const MAP = require("./mapping.json");

const TOKEN          = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.DATA_SOURCE_ID || MAP.dataSourceId;
const NOTION_VERSION = MAP.notionVersion || "2025-09-03";

// Small in-process cache + last-known-good so simultaneous viewers don't each hit
// Notion, and a transient/breaking Notion error keeps showing the last good picture.
const CACHE_MS = 60000;
let _cache = null, _cacheAt = 0, _lastGood = null;

// --- tolerant readers -------------------------------------------------------
// Each reader accepts a Notion property of any shape and coerces it, so a field
// whose *type* changed in Notion still yields a value instead of null.

function readText(prop) {
  if (!prop || typeof prop !== "object") return null;
  if (Array.isArray(prop.title))     return prop.title.map(t => t.plain_text).join("") || null;
  if (Array.isArray(prop.rich_text)) return prop.rich_text.map(t => t.plain_text).join("") || null;
  if (prop.select)  return prop.select.name || null;
  if (prop.status)  return prop.status.name || null;
  if (prop.formula) return prop.formula.string != null ? prop.formula.string
                         : (prop.formula.number != null ? String(prop.formula.number) : null);
  if (typeof prop.number === "number") return String(prop.number);
  if (typeof prop.checkbox === "boolean") return prop.checkbox ? "true" : "false";
  return null;
}

function readMulti(prop) {
  if (!prop || typeof prop !== "object") return [];
  if (Array.isArray(prop.multi_select)) return prop.multi_select.map(o => o.name);
  if (prop.select && prop.select.name)  return [prop.select.name];
  return [];
}

function readDate(prop) {
  if (!prop || typeof prop !== "object") return { start: null, end: null };
  const d = prop.date || (prop.formula && prop.formula.date) || null;
  return d ? { start: d.start || null, end: d.end || null } : { start: null, end: null };
}

// Relations arrive as [{id}, …]. Ids are compared across pages, so strip the dashes:
// Notion is inconsistent about whether a uuid carries them.
function normId(id) {
  return id ? String(id).replace(/-/g, "").toLowerCase() : null;
}

function readRelation(prop) {
  if (!prop || typeof prop !== "object") return [];
  if (Array.isArray(prop.relation)) return prop.relation.map(r => normId(r && r.id)).filter(Boolean);
  return [];
}

// Dates may arrive as "2026-08-26" or as a full datetime; compare on the day only.
function dayOf(v) {
  return v ? String(v).slice(0, 10) : null;
}

// Find a property on a page by its configured name, falling back to any alias.
function findProp(props, field) {
  if (props[field.notion] !== undefined) return props[field.notion];
  for (const a of (field.aliases || [])) if (props[a] !== undefined) return props[a];
  return undefined;
}

function canonicalSwimlane(raw) {
  if (raw == null || raw === "") return { lane: null };              // untagged → not on the roadmap
  const key = String(raw).trim().toLowerCase();
  if (MAP.swimlaneMap && MAP.swimlaneMap[key]) return { lane: MAP.swimlaneMap[key] };
  const hit = MAP.lanes.find(l => l.key.toLowerCase() === key);
  if (hit) return { lane: hit.key };
  return { lane: MAP.unmappedLane, unknown: String(raw).trim() };    // tagged, but unknown lane
}

function canonicalRag(raw) {
  if (raw == null || raw === "") return { rag: null };
  const key = String(raw).trim().toLowerCase();
  if (MAP.ragMap && MAP.ragMap[key]) return { rag: MAP.ragMap[key] };
  return { rag: null, unknown: String(raw).trim() };
}

// --- the adapter ------------------------------------------------------------
// Pure: raw Notion pages -> { results, warnings }. No I/O, so it's directly testable.
// A Committed Date only means something if it was set for THIS initiative.
// Duplicating a sub-item in Notion copies its baseline, so the copy inherits a date it
// never committed to — and would otherwise draw a large, meaningless drift badge. This
// pass marks those baselines with a reason instead of deleting them: the value survives
// into the payload (the hover card explains it) but the view suppresses the drift
// treatment. Rules live in mapping.json under "baselineTrust".
function reviewBaselines(rows) {
  const rules = MAP.baselineTrust || {};
  const byId = {};
  for (const r of rows) if (r.id) byId[r.id] = r;

  // Sub-items grouped by parent, so a baseline shared between siblings is visible.
  const siblings = {};
  for (const r of rows) {
    if (r.parent_id && byId[r.parent_id]) (siblings[r.parent_id] = siblings[r.parent_id] || []).push(r);
  }

  for (const r of rows) {
    r.baseline_ignored = null;
    const base = dayOf(r.baseline);
    if (!base) continue;

    // On a launch (a single delivery date with no end) cd_start IS the landing, so
    // treating it as the delivery start compares the baseline against the landing
    // itself and flags every slip as impossible. Only a real window has a delivery
    // start distinct from its landing; otherwise fall back to when work began.
    const cdStart = dayOf(r.cd_start), cdEnd = dayOf(r.cd_end);
    const isWindow = cdStart && cdEnd && cdEnd > cdStart;
    const delStart = isWindow ? cdStart : (dayOf(r.ip_start) || cdStart);
    const parent = r.parent_id ? byId[r.parent_id] : null;
    let reason = null;

    // A committed landing date cannot fall before the delivery it is supposed to land.
    if (rules.ignoreBeforeDeliveryStart && delStart && base < delStart) {
      reason = "precedes-delivery-start";
    }
    // Identical to the parent's baseline: inherited, not committed.
    if (!reason && rules.ignoreSharedWithParent && parent && dayOf(parent.baseline) === base) {
      reason = "copied-from-parent";
    }
    // Two or more siblings carrying the same baseline: copied from one another.
    if (!reason && rules.ignoreSharedWithSiblings && parent) {
      const twins = (siblings[r.parent_id] || []).filter(s => s !== r && dayOf(s.baseline) === base);
      if (twins.length) reason = "copied-between-sub-items";
    }
    r.baseline_ignored = reason;
  }
  return rows;
}

function adapt(pages) {
  const F = MAP.fields;
  const seen = {};
  Object.keys(F).forEach(k => (seen[k] = false));
  const unknownLane = {}, unknownRag = {};
  let noName = 0;
  const results = [];

  for (const page of (pages || [])) {
    const props = (page && page.properties) || {};
    const url = page && page.url;   // the initiative's Notion page URL (click-through target)
    const get = (k) => { const p = findProp(props, F[k]); if (p !== undefined) seen[k] = true; return p; };

    // Read every field FIRST so "field missing" detection stays accurate even for the
    // rows we go on to drop below.
    const statusRaw = readText(get("status"));
    const swRaw = readText(get("swimlane"));
    const ragRaw = readText(get("rag"));
    const name = readText(get("name"));
    const cd = readDate(get("cd"));
    const discRange = readDate(get("discDates"));
    const disc = readDate(get("discStart"));
    const ip = readDate(get("ipStart"));
    const done = readDate(get("done"));      // when it left In Progress; orders the Measure list
    const base = readDate(get("baseline"));
    const desc = readText(get("desc"));       // Notion-AI summary of what this initiative IS
    const update = readText(get("update"));
    const updateAt = readDate(get("updateAt"));
    const parent = readRelation(get("parent"));

    // Drops: excluded status, or untagged (no swimlane). Don't raise data-quality
    // warnings for rows that aren't on the roadmap anyway.
    if (MAP.excludeStatus.includes(statusRaw)) continue;
    const sw = canonicalSwimlane(swRaw);
    if (sw.lane == null) continue;

    // Kept — now accumulate warnings.
    if (sw.unknown) unknownLane[sw.unknown] = (unknownLane[sw.unknown] || 0) + 1;
    const rg = canonicalRag(ragRaw);
    if (rg.unknown) unknownRag[rg.unknown] = (unknownRag[rg.unknown] || 0) + 1;
    if (!name) noName++;

    results.push({
      "Initiative Name": name || "(untitled)",
      swimlane: sw.lane,
      Status: statusRaw,
      RAG: rg.rag,
      baseline: base.start,   // committed landing date (single date; frozen when set)
      url: url || null,
      id: normId(page && page.id),          // used to match sub-items to their parent
      parent_id: parent[0] || null,         // "Parent item" is limited to one in Notion
      cd_start: cd.start,
      cd_end: cd.end,
      disc_start: discRange.start || disc.start,   // prefer the "Discovery Dates" range
      disc_end: discRange.end,                     // real discovery end, when it's set
      ip_start: ip.start,
      done_date: done.start,
      description: desc,                           // "what is this" — leads the detail card
      update: update,                              // Latest Update narrative (how it is going)
      update_at: updateAt.start,
    });
  }

  reviewBaselines(results);

  const warnings = [];
  if (pages && pages.length) {
    for (const k of Object.keys(F)) {
      if (!seen[k]) warnings.push(
        `Field "${k}" (Notion property "${F[k].notion}") wasn't found on any initiative. ` +
        `If it was renamed, update its "notion" name or add an alias in mapping.json.`);
    }
  }
  for (const [v, n] of Object.entries(unknownLane))
    warnings.push(`${n} initiative${n > 1 ? "s" : ""} tagged "${v}" don't match a known lane — shown under "${MAP.unmappedLane}". Add "${v}" to mapping.json to place them.`);
  for (const [v, n] of Object.entries(unknownRag))
    warnings.push(`${n} initiative${n > 1 ? "s" : ""} have an unrecognised RAG value "${v}" — shown as "not set". Add it to ragMap in mapping.json.`);
  if (noName) warnings.push(`${noName} initiative${noName > 1 ? "s" : ""} have no name.`);
  if (pages && pages.length && !results.length)
    warnings.push(`No initiatives could be placed on the roadmap. Check the swimlane field in Notion against mapping.json.`);

  return { results, warnings };
}

// --- live fetch -------------------------------------------------------------
async function fetchInitiatives() {
  if (!TOKEN) {
    const err = new Error("Missing NOTION_TOKEN environment variable");
    err.status = 500;
    throw err;
  }
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;

  const pages = [];
  let cursor;
  do {
    // No server-side filter: a renamed/retyped property can no longer make the whole
    // query 400. We fetch every row and decide what belongs in adapt(). The data
    // source is small, so the extra rows cost nothing.
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const resp = await fetch(`https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      if (_lastGood) {
        // Keep showing the last good roadmap instead of dropping to preview data.
        return { ..._lastGood, stale: true,
          warnings: [`Live refresh failed (Notion ${resp.status}); showing the last good data.`, ...(_lastGood.warnings || [])] };
      }
      const err = new Error(`Notion API error ${resp.status}: ${detail}`);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();
    if (Array.isArray(data.results)) pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  const { results, warnings } = adapt(pages);
  const payload = { results, warnings, lanes: MAP.lanes, generated_at: new Date().toISOString() };
  _cache = payload;
  _cacheAt = Date.now();
  _lastGood = payload;
  return payload;
}

module.exports = { fetchInitiatives, adapt, reviewBaselines, mapping: MAP };
