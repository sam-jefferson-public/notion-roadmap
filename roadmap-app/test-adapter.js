// Parity tests for notion.js's adapt(), mirroring the Rust suite in
// roadmap-desktop/src-tauri/src/main.rs. The two adapters must behave identically.
//
// There is no Node on the primary dev machine, so this runs under JavaScriptCore with a
// tiny require/module/process shim. From this directory:
//
//   /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc test-adapter.js
//
// Kept jsc-only deliberately: that's what's actually available on this machine.
var ROOT = ".";
var console = { log: print, warn: print, error: print };
var process = { env: {} };

// `patch` optionally mutates mapping.json before notion.js reads it, so config-driven
// behaviour can be tested without editing the file on disk.
function loadNotion(patch) {
  var src = readFile(ROOT + "/notion.js");
  var module = { exports: {} };
  function require(p) {
    if (p === "./mapping.json") {
      var m = JSON.parse(readFile(ROOT + "/mapping.json"));
      if (patch) patch(m);
      return m;
    }
    throw new Error("unexpected require: " + p);
  }
  var fn = new Function("module", "exports", "require", "process", "console", "fetch", src);
  fn(module, module.exports, require, process, console, function () {});
  return module.exports;
}
var N = loadNotion();

var pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; print("  ok   " + name); }
  else { fail++; print("  FAIL " + name + (extra ? "  -> " + extra : "")); }
}

function good() {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    url: "https://www.notion.so/example-initiative",
    properties: {
      "Initiative Name": { title: [{ plain_text: "Unified product pages" }] },
      "Swimlane": { select: { name: "Growth" } },
      "Status": { status: { name: "In Progress" } },
      "RAG": { select: { name: "🟢" } },
      "Committed Date": { date: { start: "2026-07-20", end: null } },
      "Delivery Dates": { date: { start: "2026-06-05", end: "2026-07-31" } },
      "Discovery Dates": { date: { start: null, end: null } },
      "Discovery start": { date: { start: "2026-05-13", end: null } },
      "In Progress start": { date: { start: "2026-06-05", end: null } },
      "Done date": { date: { start: null, end: null } },
      "Description": { rich_text: [{ plain_text: "Bring the legacy product pages onto one component set." }] },
      "Latest Update": { rich_text: [{ plain_text: "Tracking to plan." }] },
      "Update Last Edited": { date: { start: "2026-08-18", end: null } },
      "Parent item": { relation: [] }
    }
  };
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// A sub-item of `parent`, with its own baseline and delivery window.
function childOf(parent, id, name, baseline, delStart, delEnd) {
  var c = clone(good());
  c.id = id;
  c.properties["Initiative Name"] = { title: [{ plain_text: name }] };
  c.properties["Parent item"] = { relation: [{ id: parent.id }] };
  c.properties["Committed Date"] = { date: { start: baseline } };
  c.properties["Delivery Dates"] = { date: { start: delStart, end: delEnd } };
  return c;
}

print("\n--- baseline shape ---");
var out = N.adapt([good()]);
var r = out.results[0];
check("one row emitted", out.results.length === 1);
check("id dash-stripped", r.id === "11111111111111111111111111111111", r.id);
check("parent_id null when unset", r.parent_id === null, JSON.stringify(r.parent_id));
check("description read", r.description === "Bring the legacy product pages onto one component set.", r.description);
check("update text read", r.update === "Tracking to plan.", r.update);
check("update_at read", r.update_at === "2026-08-18", r.update_at);
check("done_date null when unset", r.done_date === null, JSON.stringify(r.done_date));
check("RAG canonicalised", r.RAG === "green", r.RAG);
check("no warnings", out.warnings.length === 0, JSON.stringify(out.warnings));

print("\n--- discovery range preferred over legacy field ---");
var p = clone(good());
p.properties["Discovery Dates"] = { date: { start: "2026-05-12", end: "2026-06-02" } };
r = N.adapt([p]).results[0];
check("disc_start from range", r.disc_start === "2026-05-12", r.disc_start);
check("disc_end from range", r.disc_end === "2026-06-02", r.disc_end);

print("\n--- falls back to legacy 'Discovery start' ---");
r = N.adapt([good()]).results[0];
check("disc_start from legacy", r.disc_start === "2026-05-13", r.disc_start);
check("disc_end null", r.disc_end === null, JSON.stringify(r.disc_end));

print("\n--- parent relation normalised to match parent's id ---");
var child = clone(good());
child.id = "44444444-4444-4444-4444-444444444444";
child.properties["Initiative Name"] = { title: [{ plain_text: "Milestone 1" }] };
child.properties["Parent item"] = { relation: [{ id: "11111111111111111111111111111111" }] };
var res = N.adapt([good(), child]).results;
check("both rows kept", res.length === 2, "" + res.length);
check("child.parent_id === parent.id", res[1].parent_id === res[0].id,
      res[1].parent_id + " vs " + res[0].id);

print("\n--- filter policy: swimlane tag is the gate ---");
p = clone(good()); p.properties["Status"] = { status: { name: "Discarded" } };
check("Discarded dropped", N.adapt([p]).results.length === 0);
p = clone(good()); p.properties["Status"] = { status: { name: "Done" } };
res = N.adapt([p]).results;
check("tagged Done kept", res.length === 1 && res[0].Status === "Done", JSON.stringify(res));
p = clone(good()); p.properties["Swimlane"] = { select: null };
out = N.adapt([p]);
check("untagged dropped", out.results.length === 0);
check("untagged raises warning",
      out.warnings.some(function (w) { return w.indexOf("No initiatives could be placed") >= 0; }),
      JSON.stringify(out.warnings));

print("\n--- tolerance: new fields must not break old/odd payloads ---");
p = clone(good());
delete p.properties["Description"];
check("missing Description -> null, not fatal", N.adapt([p]).results[0].description === null, JSON.stringify(N.adapt([p]).results[0].description));

p = clone(good());
delete p.properties["Discovery Dates"];
delete p.properties["Latest Update"];
delete p.properties["Parent item"];
delete p.id;
out = N.adapt([p]);
check("missing new fields still yields a row", out.results.length === 1);
check("id null when page has none", out.results[0].id === null, JSON.stringify(out.results[0].id));
p = clone(good()); p.properties["Parent item"] = { rich_text: [{ plain_text: "oops" }] };
check("retyped relation -> no parent, no crash", N.adapt([p]).results[0].parent_id === null);
check("garbage input does not throw", (function () {
  try { N.adapt([null, {}, { properties: null }, 42]); return true; } catch (e) { return "threw: " + e; }
})() === true);

print("\n--- Done date ---");
// Orders the "still measuring" list, so it has to come through the adapter.
var dp = clone(good());
dp.properties["Done date"] = { date: { start: "2026-07-31", end: null } };
dp.properties["Status"] = { status: { name: "Measure" } };
var dr = N.adapt([dp]).results[0];
check("done_date read", dr.done_date === "2026-07-31", dr.done_date);
check("Measure row still kept", dr.Status === "Measure", dr.Status);

print("\n--- a launch that slips must still show it ---");
// On a single delivery date with no end, cd_start IS the landing. Comparing the baseline
// against it flagged every slipped launch as impossible and hid the drift entirely.
function launch(baseline, cds, ip){
  var p = clone(good());
  p.properties["Committed Date"] = { date: { start: baseline } };
  p.properties["Delivery Dates"] = { date: { start: cds, end: null } };
  p.properties["In Progress start"] = { date: { start: ip } };
  p.properties["Discovery start"] = { date: null };
  p.properties["Discovery Dates"] = { date: null };
  return N.adapt([p]).results[0];
}
check("slipped launch keeps its baseline",
      launch("2026-08-30","2026-09-20","2026-08-27").baseline_ignored === null,
      launch("2026-08-30","2026-09-20","2026-08-27").baseline_ignored);
check("on-plan launch keeps its baseline",
      launch("2026-09-13","2026-09-13","2026-07-08").baseline_ignored === null);
check("launch baseline before work began still caught",
      launch("2026-07-01","2026-09-20","2026-08-27").baseline_ignored === "precedes-delivery-start",
      launch("2026-07-01","2026-09-20","2026-08-27").baseline_ignored);

print("\n--- baseline trust ---");
// The common real-world case: duplicated milestones share one copied
// baseline, and one older initiative has a baseline predating its own delivery.
r = N.adapt([good()]).results[0];
check("self-consistent baseline trusted", r.baseline_ignored === null, r.baseline_ignored);

p = clone(good());
p.properties["Committed Date"] = { date: { start: "2026-05-29" } };
p.properties["Delivery Dates"] = { date: { start: "2026-06-05", end: "2026-07-31" } };
r = N.adapt([p]).results[0];
check("baseline before delivery start ignored", r.baseline_ignored === "precedes-delivery-start", r.baseline_ignored);
check("ignored baseline is kept, not deleted", r.baseline === "2026-05-29", r.baseline);

var parent = good();
var m2 = childOf(parent, "22222222222222222222222222222222", "Milestone 2", "2026-08-26", "2026-08-18", "2026-09-28");
var m3 = childOf(parent, "33333333333333333333333333333333", "Milestone 3", "2026-08-26", "2026-09-29", "2026-10-26");
res = N.adapt([parent, m2, m3]).results;
check("sibling whose baseline also predates delivery", res[2].baseline_ignored === "precedes-delivery-start", res[2].baseline_ignored);
check("sibling given away only by the shared value", res[1].baseline_ignored === "copied-between-sub-items", res[1].baseline_ignored);

var par = clone(good());
par.properties["Committed Date"] = { date: { start: "2026-09-25" } };
par.properties["Delivery Dates"] = { date: { start: "2026-07-27", end: "2026-09-25" } };
var kid = childOf(par, "44444444444444444444444444444444", "Milestone 1", "2026-09-25", "2026-08-04", "2026-11-30");
res = N.adapt([par, kid]).results;
check("parent's own baseline kept", res[0].baseline_ignored === null, res[0].baseline_ignored);
check("baseline copied from parent ignored", res[1].baseline_ignored === "copied-from-parent", res[1].baseline_ignored);

var lone = childOf(good(), "44444444444444444444444444444444", "Milestone 1", "2026-10-30", "2026-08-04", "2026-10-30");
res = N.adapt([good(), lone]).results;
check("sub-item's own distinct baseline kept", res[1].baseline_ignored === null, res[1].baseline_ignored);

var N2 = loadNotion(function (m) { m.baselineTrust.ignoreBeforeDeliveryStart = false; });
p = clone(good());
p.properties["Committed Date"] = { date: { start: "2026-05-29" } };
p.properties["Delivery Dates"] = { date: { start: "2026-06-05", end: "2026-07-31" } };
check("rule can be switched off in mapping.json",
      N2.adapt([p]).results[0].baseline_ignored === null);

print("\n" + pass + " passed, " + fail + " failed");
