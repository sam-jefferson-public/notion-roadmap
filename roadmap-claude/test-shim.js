// End-to-end test for the Claude-project path: SQL rows from the Notion connector,
// through sql-shim.js, into the real adapt() + reviewBaselines() from notion.js.
// The rows below use the shapes the Notion connector actually returns.
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc test-shim.js
//
// Run from this directory.
var APP = "../roadmap-app";
var console = { log: print, warn: print, error: print };
var process = { env: {} };

function load(src, requireFn) {
  var module = { exports: {} };
  new Function("module", "exports", "require", "process", "console", "fetch", src)
    (module, module.exports, requireFn, process, console, function () {});
  return module.exports;
}
var SHIM = load(readFile("sql-shim.js"), function () { throw new Error("no requires"); });
var N = load(readFile(APP + "/notion.js"), function (p) {
  if (p === "./mapping.json") return JSON.parse(readFile(APP + "/mapping.json"));
  throw new Error("unexpected require: " + p);
});

var pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; print("  ok   " + name); }
  else { fail++; print("  FAIL " + name + (extra ? "  -> " + extra : "")); }
}
var PARENT = "https://app.notion.com/11111111111111111111111111111111";
var CHILD  = "https://app.notion.com/22222222222222222222222222222222";

var ROWS = [
  { name:"Unified product pages", lane:"Growth", status:"Discovery", rag:"🟢",
    baseline:null, cd_start:"2026-11-09", cd_end:null, disc_start:null, disc_end:null,
    disc_legacy:"2026-07-23", ip_start:null, description:"Bring the legacy product pages onto one component set.",
    update:"Assets received.", update_at:"2026-08-20", parent:null, url:PARENT },
  { name:"Milestone 2: ECOM-led page building is unlocked", lane:"Growth", status:"Discovery", rag:"🟢",
    baseline:"2026-08-26", cd_start:"2026-08-18", cd_end:"2026-09-28", disc_start:null, disc_end:null,
    disc_legacy:null, ip_start:"2026-08-12", description:"Enable ECOM to build pages.",
    update:null, update_at:null, parent:'["'+PARENT+'"]', url:CHILD },
  { name:"Milestone 3", lane:"Growth", status:"Discovery", rag:"🟢",
    baseline:"2026-08-26", cd_start:"2026-09-29", cd_end:"2026-10-26", disc_start:null, disc_end:null,
    disc_legacy:null, ip_start:"2026-08-12", description:"Feature complete.",
    update:null, update_at:null, parent:'["'+PARENT+'"]', url:"https://app.notion.com/33333333333333333333333333333333" },
  { name:"Discarded thing", lane:"Growth", status:"Discarded", rag:"🔴",
    baseline:null, cd_start:"2026-09-01", cd_end:null, disc_start:null, disc_end:null,
    disc_legacy:null, ip_start:null, description:null, update:null, update_at:null,
    parent:null, url:"https://app.notion.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  { name:"Untagged thing", lane:null, status:"In Progress", rag:"🟢",
    baseline:null, cd_start:"2026-09-01", cd_end:null, disc_start:null, disc_end:null,
    disc_legacy:null, ip_start:null, description:null, update:null, update_at:null,
    parent:null, url:"https://app.notion.com/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }
];

print("\n--- shim: url -> page id ---");
check("32-hex id extracted", SHIM.idFromUrl(PARENT) === "11111111111111111111111111111111", SHIM.idFromUrl(PARENT));
check("null url tolerated", SHIM.idFromUrl(null) === null);
check("junk url tolerated", SHIM.idFromUrl("https://example.com/nope") === null);

print("\n--- end to end: SQL rows -> adapt() ---");
var out = N.adapt(SHIM.sqlRowsToPages(ROWS));
var r = out.results;
check("Discarded dropped, untagged dropped", r.length === 3, "got " + r.length);
check("no schema-drift warnings", out.warnings.length === 0, JSON.stringify(out.warnings));
check("RAG emoji canonicalised", r[0].RAG === "green", r[0].RAG);
check("swimlane preserved", r[0].swimlane === "Growth", r[0].swimlane);
check("description carried", r[0].description === "Bring the legacy product pages onto one component set.", r[0].description);
check("legacy Discovery start used", r[0].disc_start === "2026-07-23", r[0].disc_start);

print("\n--- the logic that must NOT move into the model ---");
check("child linked to parent", r[1].parent_id === r[0].id, r[1].parent_id + " vs " + r[0].id);
check("copied baseline caught (siblings)", r[1].baseline_ignored === "copied-between-sub-items", r[1].baseline_ignored);
check("baseline before delivery caught", r[2].baseline_ignored === "precedes-delivery-start", r[2].baseline_ignored);
check("ignored baseline still present", r[1].baseline === "2026-08-26", r[1].baseline);

print("\n--- Done date ---");
// Orders the "still measuring" list, so it has to survive the shim.
var withDone = N.adapt(SHIM.sqlRowsToPages([{ name:"A", lane:"Growth", status:"Measure",
  rag:"\ud83d\udd35", cd_start:"2026-06-05", cd_end:"2026-07-31", done_date:"2026-07-31", url:PARENT }])).results[0];
check("done_date carried through", withDone.done_date === "2026-07-31", withDone.done_date);
check("Measure rows are kept", withDone.Status === "Measure", withDone.Status);
var noDone = N.adapt(SHIM.sqlRowsToPages([{ name:"B", lane:"Growth", status:"Measure",
  rag:"\ud83d\udd35", cd_start:"2026-06-05", cd_end:"2026-07-31", url:PARENT }])).results[0];
check("absent done_date -> null", noDone.done_date === null, JSON.stringify(noDone.done_date));

print("\n--- Notion page URLs ---");
// The SQL connector omits the /p/ segment, and the bare form 404s in Notion.
var CANON = "https://app.notion.com/p/11111111111111111111111111111111";
check("bare url gains /p/", SHIM.pageUrl("https://app.notion.com/11111111111111111111111111111111") === CANON,
      SHIM.pageUrl("https://app.notion.com/11111111111111111111111111111111"));
check("canonical url unchanged", SHIM.pageUrl(CANON) === CANON, SHIM.pageUrl(CANON));
check("query-string form canonicalised", SHIM.pageUrl(CANON + "?pvs=204") === CANON);
check("title-slug form canonicalised",
      SHIM.pageUrl("https://www.notion.so/Unify-PDPs-11111111111111111111111111111111") === CANON);
check("junk url passes through", SHIM.pageUrl("https://example.com/x") === "https://example.com/x");
check("null url stays null", SHIM.pageUrl(null) === null);
check("adapted row carries the canonical url",
      N.adapt(SHIM.sqlRowsToPages([{name:"A",lane:"Growth",status:"In Progress",rag:"\ud83d\udfe2",
        cd_start:"2026-09-01",cd_end:"2026-09-30",url:"https://app.notion.com/11111111111111111111111111111111"}]))
        .results[0].url === CANON);

print("\n--- the reserved-word alias ---");
// "Latest Update" AS update is a SQL syntax error (update is reserved), so the query
// aliases it latest_update. The shim reads either, so older row dumps still load.
function oneRow(extra){
  var row = { name:"A", lane:"Growth", status:"In Progress", rag:"\ud83d\udfe2",
              cd_start:"2026-09-01", cd_end:"2026-09-30", url:PARENT };
  for (var k in extra) row[k] = extra[k];
  return N.adapt(SHIM.sqlRowsToPages([row])).results[0];
}
check("latest_update is read", oneRow({latest_update:"from latest_update"}).update === "from latest_update");
check("plain update still read", oneRow({update:"from update"}).update === "from update");
check("neither present is fine", oneRow({}).update === null);

print("\n--- tolerance ---");
check("empty result set is fine", N.adapt(SHIM.sqlRowsToPages([])).results.length === 0);
check("garbage rows do not throw", (function () {
  try { N.adapt(SHIM.sqlRowsToPages([null, {}, 42, {name:"x"}])); return true; }
  catch (e) { return "threw: " + e; }
})() === true);

print("\n" + pass + " passed, " + fail + " failed");
