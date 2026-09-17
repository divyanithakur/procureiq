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


test("Investigate stays in-place after dynamic opportunity rendering", () => {
  const script = read("public/script.js");
  const overview = read("public/workspace/overview.html");
  assert.match(script, /data-action="investigate-opportunity"/);
  assert.doesNotMatch(script, /href="\/workspace\/act\?transactionId=/);
  assert.match(script, /onclick="event\.preventDefault\(\); event\.stopPropagation\(\); window\.procureIQInvestigate\(this\); return false;/);
  assert.match(script, /function procureIQInvestigate\(button\)/);
  assert.match(script, /openOpportunityDrawer\(item\)/);
  assert.doesNotMatch(script, /window\.location\.assign\([^)]*transactionId/);
  assert.match(overview, /id="opportunityDrawer"/);
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


test("V64 keeps Investigate on Overview and opens the drawer in-place", () => {
  const script = read("public/script.js");
  const overview = read("public/workspace/overview.html");
  assert.match(script, /onclick="event\.preventDefault\(\); event\.stopPropagation\(\); window\.procureIQInvestigate\(this\); return false;/);
  assert.doesNotMatch(script, /href="\/workspace\/act\?transactionId=/);
  assert.doesNotMatch(script, /openOpportunityFromQuery\(\)/);
  assert.match(script, /const button = event\.target\.closest\("#drawerAIButton"\)/);
  assert.match(overview, /id="opportunityDrawer"/);
});

test("V64 shows an instant evidence summary before the AI request completes", () => {
  const script = read("public/script.js");
  assert.match(script, /const aiInsightCache = new Map\(\)/);
  assert.match(script, /function buildInstantAIInsight\(button\)/);
  assert.match(script, /Instant evidence summary shown first/);
  assert.match(script, /aiInsightCache\.set\(cacheKey/);
});


test('V64 gives every Investigate button a self-contained real-click path', () => {
  const script = fs.readFileSync(path.join(root, 'public/script.js'), 'utf8');
  assert.match(script, /onclick="event\.preventDefault\(\); event\.stopPropagation\(\); window\.procureIQInvestigate\(this\); return false;/);
  assert.match(script, /function procureIQInvestigate\(button\)/);
  assert.doesNotMatch(script, /function bindInvestigateButtons\(\)/);
});;


test("V64 investigation uses a single direct path and a real drawer AI handler", () => {
  const script = read("public/script.js");
  assert.doesNotMatch(script, /bindInvestigateButtons/);
  assert.match(script, /data-action="investigate-opportunity"/);
  assert.match(script, /window\.procureIQInvestigate\(this\)/);
  assert.match(script, /const button = event\.target\.closest\("#drawerAIButton"\)/);
  assert.match(script, /getAIInsight\(transactionId, button\.dataset\.target/);
});

test("V64 dashboard potential savings is sourced from current opportunities after analysis", () => {
  const script = read("public/script.js");
  assert.match(script, /window\.procurementOpportunities\s*=\s*opportunities/);
  assert.match(script, /const savings = opps\.reduce\(\(sum, opportunity\) =>/);
  assert.match(script, /document\.getElementById\("v16PotentialSavingsHero"\)/);
  assert.match(script, /window\.addEventListener\("procureiq:data-updated", \(\) => \{/);
});

test("V64 upload success is shown only after confirmed API response", () => {
  const script = read("public/script.js");
  const responsePos = script.indexOf('const response = await procureiqApiFetch("/api/transactions/upload"');
  const successPos = script.indexOf("Uploaded successfully:");
  assert.ok(responsePos >= 0 && successPos > responsePos);
  assert.match(script, /if \(!response\.ok\) throw new Error\(result\.error/);
});


test("V64 persists transaction upload batches and report history per account", () => {
  const server = read("server.js");
  const script = read("public/script.js");
  assert.match(server, /ADD COLUMN IF NOT EXISTS upload_batch_id UUID/);
  assert.match(server, /ADD COLUMN IF NOT EXISTS source_file_name TEXT/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS report_history/);
  assert.match(server, /app\.get\("\/api\/report-history"/);
  assert.match(server, /app\.post\("\/api\/report-history"/);
  assert.match(server, /clerk_user_id=\$1/);
  assert.match(script, /procureIQSaveReportSnapshot/);
  assert.match(script, /\/api\/report-history/);
  assert.match(script, /sourceFileName: file\.name/);
});

test("V64 report history is account-backed rather than limited to browser localStorage", () => {
  const script = read("public/script.js");
  const reports = read("public/workspace/reports.html");
  assert.match(script, /Persistent report history unavailable/);
  assert.match(script, /saved analyses and generated reports|saved analyses/);
  assert.match(reports, /Saved analyses &amp; reports/i);
});


test("V64 reports history supports View more and View less", () => {
  const script = read("public/script.js");
  const reports = read("public/workspace/reports.html");
  assert.match(script, /let reportsHistoryExpanded = false/);
  assert.match(script, /history\.slice\(0, 5\)/);
  assert.match(script, /toggleReportsHistoryBtn/);
  assert.match(script, /View more/);
  assert.match(script, /View less/);
  assert.match(reports, /id="reportsHistory"/);
});

test("V64 keeps workspace logo compact for the navigation bar", () => {
  const css = read("public/workspace.css");
  assert.match(css, /app-shell \.app-header \.app-logo \{ width: 128px/);
});

test("V64 AI explanation is bounded so the evidence summary remains usable", () => {
  const script = read("public/script.js");
  assert.match(script, /setTimeout\(\(\) => controller\.abort\(\), 4500\)/);
  assert.match(script, /Instant evidence summary shown first/);
});
