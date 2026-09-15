"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculatePriceVariance, calculatePotentialSaving, summarizePriceExceptions } = require("../lib/procurement-metrics");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("procurement calculations are deterministic", () => {
  assert.equal(calculatePriceVariance(120, 100), 20);
  assert.equal(calculatePotentialSaving(120, 100, 5), 100);
  assert.equal(calculatePotentialSaving(90, 100, 5), 0);
  assert.equal(calculatePriceVariance(120, 0), 0);
});

test("price exception detection flags only higher prices against the same material benchmark", () => {
  const result = summarizePriceExceptions([
    { id: 1, material: "Steel", supplier: "A", price: 100, quantity: 10 },
    { id: 2, material: "Steel", supplier: "B", price: 120, quantity: 5 },
    { id: 3, material: "Steel", supplier: "C", price: 80, quantity: 2 },
    { id: 4, material: "Cable", supplier: "A", price: 50, quantity: 10 }
  ]);

  assert.equal(result.length, 2);
  assert.deepEqual(new Set(result.map(item => item.id)), new Set([1, 2]));
  const higher = result.find(item => item.id === 2);
  assert.equal(higher.minPrice, 80);
  assert.equal(higher.variance, 50);
  assert.equal(higher.saving, 200);
});

test("required security and isolation controls are present in the server", () => {
  const server = read("server.js");
  assert.match(server, /app\.disable\("x-powered-by"\)/);
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /app\.use\("\/workspace", requireAuthenticatedPage\)/);
  assert.match(server, /WHERE id = \$1 AND clerk_user_id = \$2/);
  assert.match(server, /FROM transactions WHERE clerk_user_id=\$1/);
  assert.match(server, /express\.json\(\{ limit: "5mb" \}\)/);
});

test("release cache versions are consistent across workspace pages", () => {
  const publicDir = path.join(root, "public");
  const htmlFiles = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) htmlFiles.push(full);
    }
  }
  walk(publicDir);

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(html, /\/(?:auth|script|core-features)\.js\?v=(?:3[0-9]|4[01])/);
  }
});

test("secret files are excluded and not served from the public tree", () => {
  const gitignore = read(".gitignore");
  assert.match(gitignore, /\.env/);
  assert.equal(fs.existsSync(path.join(root, "public", ".env")), false);
  assert.equal(fs.existsSync(path.join(root, "public", "server.js")), false);
});

test("Investigate action has a direct click path and clickable hit area", () => {
  const script = read("public/script.js");
  const css = read("public/workspace.css");
  assert.match(script, /data-action=\"investigate-opportunity\"/);
  assert.match(script, /function procureIQInvestigate\(button\)/);
  assert.match(script, /let drawer = document\.getElementById\("opportunityDrawer"\)/);
  assert.match(css, /opportunity-review-btn[^{]*\{[\s\S]*pointer-events:\s*auto/);
});
test("PDF typography spacing is explicitly separated", () => {
  const script = read("public/script.js");
  assert.match(script, /subLines\.forEach\(\(lineText,index\)=>doc\.text\(lineText,margin,y\+index\*12\)/);
  assert.match(script, /lines\.forEach\(\(lineText,i\)=>doc\.text\(lineText,margin\+12,y\+35\+i\*lineH\)/);
});

test("audit UX fixes are present", () => {
  const workspaceCss = read("public/workspace.css");
  const reports = read("public/workspace/reports.html");
  const control = read("public/workspace/control.html");
  const overview = read("public/workspace/overview.html");
  const script = read("public/script.js");

  assert.match(workspaceCss, /overflow-x:\s*hidden/);
  assert.match(workspaceCss, /\.reports-loading-state/);
  assert.match(workspaceCss, /\.help-page \.help-grid > \.work-card\s*\{\s*min-height:\s*0\s*!important/);
  assert.match(reports, /id="reportsLoadingState"/);
  assert.doesNotMatch(control, /id="riskSupplierCount">:<\/strong>/);
  assert.match(overview, />Open resolver →<\/a>/);
  assert.match(script, /chat:'\/workspace\/chat'/);
  assert.match(script, /logo-dark\.svg/);
  assert.match(script, /doc\.addImage\(logoDataUrl, "PNG"/);
  assert.match(overview, /Find pricing leakage and missed rebates against confirmed terms\./);
  assert.match(overview, /Spot supplier concentration and evidence gaps early\./);
  assert.match(script, /reportsLoadingState/);
});

test("launch pricing and opportunity-memory foundation are present", () => {
  const server = read("server.js");
  const billing = read("public/workspace/billing.html");
  const script = read("public/script.js");
  assert.match(server, /starter: \{ name: "Starter", monthly: 1499/);
  assert.match(server, /business: \{ name: "Business", monthly: 4999/);
  assert.match(server, /pro: \{ name: "Pro", monthly: 11999/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS opportunity_memory/);
  assert.match(server, /app\.get\("\/api\/outcome-ledger"/);
  assert.match(billing, /id="billingCountry"/);
  assert.match(billing, /data-price-plan="starter"/);
  assert.match(script, /OPPORTUNITY MEMORY/);
  assert.match(script, /procureIQLoadOpportunityMemory/);
});

test("legal refund page and PDF outcome section are present", () => {
  const refund = read("public/refund-cancellation.html");
  const script = read("public/script.js");
  assert.match(refund, /Refund & Cancellation Policy/);
  assert.match(script, /PAGE 5 — Outcome Ledger/);
  assert.match(script, /Complete list of transaction records included in the analysis/);
});


test("launch files expose the V48 product workflow and supported commercial-term formats", () => {
  const script = read("public/script.js");
  const analyze = read("public/workspace/analyze.html");
  assert.match(script, /Explain with AI/);
  assert.match(script, /outcome_recorded/);
  assert.match(analyze, /\.pdf,\.xlsx,\.xls,\.csv/);
  assert.match(analyze, /Potential exposure/);
});

test("secrets remain excluded and all workspace pages reference the current cache version", () => {
  const files = fs.readdirSync(path.join(root, "public", "workspace"));
  for (const file of files.filter(name => name.endsWith(".html"))) {
    const html = read(`public/workspace/${file}`);
    assert.doesNotMatch(html, /auth\.js\?v=47|script\.js\?v=47|core-features\.js\?v=47/);
  }
  assert.match(read(".gitignore"), /(^|\n)\.env(\n|$)/);
});

test("workspace navigation keeps premium destination pages reachable", () => {
  const server = read("server.js");
  const script = read("public/script.js");
  assert.match(server, /Workspace pages remain directly navigable/);
  assert.doesNotMatch(server, /if\(!planAllows\(active\.plan, requiredPlan\)\) return res\.redirect\(302, `\/workspace\/billing\?upgrade=1/);
  assert.match(script, /data-transaction-id="\$\{Number\(item\.id\) \|\| 0\}"/);
  assert.match(script, /id: Number\(d\.transactionId \|\| 0\)/);
  for (const page of ["analyze", "chat", "control", "reports"]) {
    assert.match(script, new RegExp(`${page}:'\\/workspace\\/${page}'`));
  }
});


test("priority filter always exposes high, medium and low", () => {
  const html = fs.readFileSync(path.join(root, "public/workspace/overview.html"), "utf8");
  assert.match(html, /id="priorityFilter"/);
  assert.match(html, /value="HIGH">High/);
  assert.match(html, /value="MEDIUM">Medium/);
  assert.match(html, /value="LOW">Low/);
});

test("Investigate button has a direct click path and hit-area safeguards", () => {
  const js = fs.readFileSync(path.join(root, "public/script.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "public/workspace.css"), "utf8");
  assert.match(js, /data-action=\"investigate-opportunity\"/);
  assert.match(js, /function procureIQInvestigate\(button\)/);
  assert.match(js, /let drawer = document\.getElementById\("opportunityDrawer"\)/);
  assert.match(css, /\.opportunity-review-btn\s*\{[\s\S]*pointer-events:\s*auto/);
});


test("Investigate uses a real navigation fallback after dynamic opportunity rendering", () => {
  const script = read("public/script.js");
  const overview = read("public/workspace/overview.html");
  assert.match(script, /data-action=\"investigate-opportunity\"/);
  assert.match(script, /href=\"\/workspace\/act\?transactionId=\$\{encodeURIComponent\(Number\(item\.id\) \|\| 0\)\}\"/);
  assert.match(script, /function openOpportunityFromQuery\(\)/);
  assert.doesNotMatch(script, /querySelectorAll\('\[data-action=\"investigate-opportunity\"\]'\)\.forEach/);
  assert.match(overview, /id=\"opportunityDrawer\"/);
});

test("opportunity queue surfaces HIGH priority cases before medium and low cases", () => {
  const script = read("public/script.js");
  assert.match(script, /const priorityRank = \{ HIGH: 3, MEDIUM: 2, LOW: 1 \}/);
  assert.match(script, /priorityRank\[b\.priority\] \|\| 0\) - \(priorityRank\[a\.priority\] \|\| 0\)/);
  assert.match(script, /const mediumCount = filtered\.filter/);
  assert.match(script, /const lowCount = filtered\.filter/);
});

test("clear opportunity filters uses the actual overview button id", () => {
  const script = read("public/script.js");
  assert.match(script, /getElementById\("clearOpportunityFilters"\)/);
});


test("priority thresholds produce visible HIGH cases from the bundled demo data", () => {
  const script = read("public/script.js");
  const demo = fs.readFileSync(path.join(root, "demo-data", "procureiq-demo.csv"), "utf8");
  assert.match(script, /if \(variance >= 15\)/);
  assert.match(script, /else if \(variance >= 8\)/);
  const rows = demo.trim().split(/\r?\n/).slice(1).map(line => {
    const [material, supplier, quantity, price] = line.split(",");
    return { material, supplier, quantity: Number(quantity), price: Number(price) };
  });
  const groups = new Map();
  rows.forEach(row => {
    if (!groups.has(row.material)) groups.set(row.material, []);
    groups.get(row.material).push(row);
  });
  let high = 0;
  for (const items of groups.values()) {
    const min = Math.min(...items.map(item => item.price));
    for (const item of items) {
      if (item.price <= min) continue;
      const variance = ((item.price - min) / min) * 100;
      if (variance >= 15) high += 1;
    }
  }
  assert.ok(high > 0, "bundled demo data should contain at least one HIGH opportunity");
});
