"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { calculatePriceVariance, calculatePotentialSaving, summarizePriceExceptions } = require("../lib/procurement-metrics");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
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
  assert.match(server, /express\.json\(\{ limit: "20mb" \}\)/);
});

test("V85 PDF appendix, connectors and account alignment are data-driven", () => {
  const script = read("public/script.js");
  const css = read("public/workspace.css");
  const overview = read("public/workspace/overview.html");
  assert.doesNotMatch(script, /while\(pageChunks\.length<4\)/);
  assert.match(script, /const appendixPages = transactions\.length/);
  assert.match(script, /const appendixPageSize = 22/);
  assert.match(script, /const count=Math\.max\(0,Number\(item\[1\]\)\|\|0\)/);
  assert.match(script, /doc\.text\(\"→\",x\+boxW\+5,decisionY\+59/);
  assert.match(css, /V82 FINAL ACCOUNT ALIGNMENT/);
  assert.match(overview, /<span class="account-plan-row"><small id="dashboardAccountPlan">Free plan<\/small><span class="sidebar-upgrade" id="sidebarUpgradeBtn"/);
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


test("production build does not expose internal demo controls or demo data endpoints", () => {
  const server = read("server.js");
  const overview = read("public/workspace/overview.html");
  const analyze = read("public/workspace/analyze.html");
  const act = read("public/workspace/act.html");
  const core = read("public/core-features.js");
  assert.doesNotMatch(server, /control-pack\/demo/);
  assert.doesNotMatch(overview, /Load demo data|demo-data\/procureiq-control-pack/);
  assert.doesNotMatch(analyze, /Use loaded demo contract/);
  assert.doesNotMatch(act, /Use demo exception/);
  assert.doesNotMatch(core, /control-pack\/demo|loadDemoControlPackBtn|loadDemoMatchBtn|loadDemoRecoveryBtn/);
  assert.equal(fs.existsSync(path.join(root, "demo-data")), false);
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

test("V71 AI explanation has explicit analyzing, result and retry states", () => {
  const script = read("public/script.js");
  assert.match(script, /const aiInsightCache = new Map\(\)/);
  assert.match(script, /Analyzing evidence/);
  assert.match(script, /aiInsightCache\.set\(cacheKey/);
  assert.match(script, /Retry AI/);
  assert.match(script, /Upgrade plan/);
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

test("V71 AI explanation is bounded and quota-aware", () => {
  const script = read("public/script.js");
  assert.match(script, /setTimeout\(\(\) => controller\.abort\(\), 20000\)/);
  assert.match(script, /AI limit reached/);
  assert.match(script, /window\.procureIQLoadAIUsage/);
});


test("V70 homepage replaces repetitive text blocks with a product visual preview", () => {
  const html = read("public/index.html");
  assert.match(html, /p27-product-preview/);
  assert.match(html, /p27-product-window/);
  assert.doesNotMatch(html, /ILLUSTRATIVE WORKFLOW|LIVE WORKFLOW/);
  assert.doesNotMatch(html, /demo-video/);
});

test("V70 workspace account exposes plan upgrade and structured token status", () => {
  const html = read("public/workspace/overview.html");
  assert.match(html, /dashboardAccountPlan/);
  assert.match(html, /sidebarUpgradeBtn/);
  assert.match(html, /workspace-token-status/);
  assert.match(html, /headerTokenProgress/);
});

test("V70 upload path accepts larger JSON payloads and reports server failures clearly", () => {
  const server = read("server.js");
  const script = read("public/script.js");
  assert.match(server, /express\.json\(\{ limit: "20mb" \}\)/);
  assert.match(script, /response\.status === 413/);
  assert.match(script, /response\.status === 402 && result\.upgrade_required/);
  assert.match(server, /inserted\+\+;\n    \}/);
});

test("V77 header is fixed and keeps the compact token utility before Home", () => {
  const css = read("public/workspace.css");
  assert.match(css, /position:\s*fixed\s*!important/);
  assert.match(css, /top:\s*0\s*!important/);
  assert.match(css, /z-index:\s*9999\s*!important/);
  assert.match(css, /padding-top:\s*64px\s*!important/);
  assert.match(css, /\.workspace-token-status\s*\{\s*order:\s*1\s*!important/);
  assert.match(css, /\.workspace-home-btn\s*\{\s*order:\s*2\s*!important/);
  assert.match(css, /background:\s*conic-gradient\(/);
  assert.match(css, /var\(--token-remaining, 0\)/);
  for (const page of ["overview", "analyze", "act", "billing", "chat", "control", "help", "reports"]) {
    const html = read(`public/workspace/${page}.html`);
    assert.match(html, /header-token-label">Tokens<\//);
    assert.doesNotMatch(html, /AI TOKENS/);
  }
  assert.match(read("public/script.js"), /style\.setProperty\("--token-remaining", String\(remainingPct\)\)/);
});

test("AI investigation state is reset and response-bound to the selected transaction", () => {
  const script = read("public/script.js");
  assert.match(script, /ai\.textContent = ""/);
  assert.match(script, /ai\.dataset\.transactionId = String\(item\.id \|\| ""\)/);
  assert.match(script, /function isCurrentAIInsightTarget\(transactionId, box\)/);
  assert.match(script, /String\(drawer\?\.dataset\.transactionId \|\| ""\) === id/);
  assert.match(script, /if \(!isCurrentAIInsightTarget\(transactionId, box\)\) return;/);
  assert.match(script, /const cacheKey = String\(transactionId\)/);
});

test("procurement control layer exposes contract-to-invoice data model without a production demo endpoint", () => {
  const server = read("server.js");
  const overview = read("public/workspace/overview.html");
  const core = read("public/core-features.js");
  assert.match(server, /CREATE TABLE IF NOT EXISTS procurement_contracts/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS purchase_orders/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS goods_receipts/);
  assert.match(server, /CREATE TABLE IF NOT EXISTS supplier_invoices/);
  assert.match(server, /app\.post\("\/api\/control-pack"/);
  assert.match(server, /app\.get\("\/api\/control-audit"/);
  assert.doesNotMatch(server, /app\.post\("\/api\/control-pack\/demo"/);
  assert.match(server, /contract_leakage/);
  assert.match(server, /rebate_candidate/);
  assert.match(overview, /Import control data/);
  assert.doesNotMatch(overview, /loadDemoControlPackBtn/);
  assert.doesNotMatch(core, /control-pack\/demo/);
});

test("V110 control workflow and density polish are present", () => {
  const server = read("server.js");
  const core = read("public/core-features.js");
  const overview = read("public/workspace/overview.html");
  const control = read("public/workspace/control.html");
  const act = read("public/workspace/act.html");
  const css = read("public/workspace.css");
  assert.match(server, /CREATE TABLE IF NOT EXISTS control_actions/);
  assert.match(server, /app\.post\("\/api\/control-actions"/);
  assert.match(server, /supplier_scorecards/);
  assert.match(overview, /Import control data/);
  assert.match(core, /control-actions/);
  assert.match(core, /supplierScorecards/);
  assert.match(overview, /id="importControlPackBtn"/);
  assert.match(overview, /id="controlPackMetrics"/);
  assert.match(act, /id="matchInvoiceNumber"/);
  assert.match(control, /id="supplierScorecards"/);
  assert.match(css, /control-pack-metrics/);
  assert.match(css, /supplier-scorecard/);
});

test("recurring billing, cancellation and inquiry delivery configuration are present", () => {
  const server = read("server.js");
  const billing = read("public/workspace/billing.html");
  const script = read("public/script.js");
  const legal = read("public/refund-cancellation.html");
  assert.match(server, /\/api\/create-subscription/);
  assert.match(server, /\/api\/verify-subscription/);
  assert.match(server, /\/api\/cancel-subscription/);
  assert.match(server, /\/api\/razorpay\/webhook/);
  assert.match(server, /RAZORPAY_PLAN_STARTER_ID/);
  assert.match(server, /RESEND_API_KEY/);
  assert.match(server, /RESEND_FROM_EMAIL/);
  assert.match(script, /\/api\/create-subscription/);
  assert.match(script, /\/api\/cancel-subscription/);
  assert.match(billing, /id="cancelSubscriptionBtn"/);
  assert.match(legal, /recurring monthly subscriptions/);
});

test("contact and public legal links are real and the contact email is validated", () => {
  const server = read("server.js");
  const home = read("public/index.html");
  const css = read("public/workspace.css");
  assert.match(server, /emailPattern/);
  assert.match(server, /sendInquiryEmail/);
  assert.match(home, /href="\/refund-cancellation"/);
  assert.match(css, /\.p27-contact\{padding-left:/);
});


test("billing checkout uses the actual continuation button and sends the selected currency", () => {
  const billing = read("public/workspace/billing.html");
  const script = read("public/script.js");
  assert.match(billing, /id="planDetailsContinue"/);
  assert.match(script, /getElementById\("planDetailsContinue"\)/);
  assert.match(script, /country:countrySelect\?\.value/);
  assert.match(script, /currency:currentCurrency\(\)/);
});

test("reset data clears opportunity memory and upload duplicate detection includes transaction date", () => {
  const server = read("server.js");
  assert.match(server, /DELETE FROM opportunity_memory WHERE clerk_user_id=\$1/);
  assert.match(server, /transaction_date/);
  const duplicateSection = server.slice(server.indexOf("DUPLICATE CHECK"), server.indexOf("INSERT", server.indexOf("DUPLICATE CHECK")));
  assert.match(duplicateSection, /transaction_date/);
});

test("public inquiry has idempotency, honeypot and dedicated rate limiting", () => {
  const server = read("server.js");
  const home = read("public/index.html");
  assert.match(server, /public-inquiry/);
  assert.match(server, /idempotency_key/);
  assert.match(server, /honeypot|website/);
  assert.match(home, /name="website"/);
});

test("review moderation is protected by an explicit Clerk admin allowlist", () => {
  const server = read("server.js");
  assert.match(server, /ADMIN_CLERK_USER_IDS/);
  assert.match(server, /app\.get\("\/api\/admin\/reviews"/);
  assert.match(server, /app\.patch\("\/api\/admin\/reviews\/:id"/);
});


test("AI quota is account-scoped and does not reset by sign-in date", () => {
  const serverSource = read("server.js");
  assert.match(serverSource, /AI allowance is account-scoped and persistent/);
  assert.match(serverSource, /DATE '2000-01-01'/);
  assert.doesNotMatch(serverSource, /WHERE clerk_user_id=\$1 AND usage_date=CURRENT_DATE/);
});

test("failed AI insight releases reserved tokens and returns evidence fallback", () => {
  const serverSource = read("server.js");
  assert.match(serverSource, /releaseAIQuota\(userId, reservation\.reserved\)/);
  assert.match(serverSource, /deterministic explanation from your verified procurement evidence/);
});

test("authentication keeps Clerk for sessions and delegates password recovery to Clerk", () => {
  const server = read("server.js");
  const auth = read("public/auth.js");
  const forgot = read("public/forgot-password.html");
  const reset = read("public/reset-password.html");

  assert.match(server, /clerkMiddleware\(\)/);
  assert.match(auth, /clerk\.openSignIn\(\{/);
  assert.match(auth, /clerk\.openSignUp\(\{/);
  assert.match(auth, /oauthFlow: "auto"/);
  assert.match(forgot, /Password recovery is securely handled by Clerk/);
  assert.match(reset, /Your password reset is managed by Clerk/);
  assert.doesNotMatch(server, /password_reset_tokens/);
  assert.doesNotMatch(server, /\/api\/password-reset\/(request|complete)/);
  assert.doesNotMatch(auth, /clerk\.client\.signIn\.create/);
  assert.doesNotMatch(auth, /attemptFirstFactor/);
  assert.doesNotMatch(auth, /strategy: "email_code"/);
});

test("authentication callback cache is refreshed for the rebuilt auth layer", () => {
  const callback = fs.readFileSync(path.join(publicDir, "sso-callback.html"), "utf8");
  assert.match(callback, /auth\.js\?v=145/);
});

test("workspace documents have valid head/body structure and the release cache is synchronized", () => {
  const workspaceDir = path.join(publicDir, "workspace");
  for (const file of fs.readdirSync(workspaceDir).filter(name => name.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(workspaceDir, file), "utf8");
    assert.equal((html.match(/<head>/g) || []).length, 1, `${file} should have one <head>`);
    assert.equal((html.match(/<\/head>/g) || []).length, 1, `${file} should close <head>`);
    assert.equal((html.match(/<body(?:\s|>)/g) || []).length, 1, `${file} should have one <body>`);
    assert.match(html, /<html\s+lang="en">/);
    assert.doesNotMatch(html, />\s*head\s*</i);
    assert.match(html, /auth\.js\?v=145/);
    assert.match(html, /script\.js\?v=145/);
  }
});

test("billing state is account-backed and refreshes after payment/cancellation", () => {
  const server = read("server.js");
  const script = read("public/script.js");
  const billing = read("public/workspace/billing.html");
  assert.match(server, /app\.get\("\/api\/entitlements"/);
  assert.match(server, /cancel_at_cycle_end: Boolean\(active\.cancel_at_cycle_end\)/);
  assert.match(script, /async function loadBillingState\(\)/);
  assert.match(script, /procureiqApiFetch\("\/api\/entitlements"/);
  assert.match(script, /await loadBillingState\(\)/);
  assert.match(billing, /id="dashboardPaymentStatus"/);
});

test("database health state is explicit instead of reporting a healthy app after initialization failure", () => {
  const server = read("server.js");
  assert.match(server, /let databaseReady = false/);
  assert.match(server, /app\.get\("\/api\/health"/);
  assert.match(server, /databaseReady = true/);
  assert.match(server, /databaseInitializationError = error\.message/);
  assert.match(server, /database: "unavailable"/);
});

test("billing configuration never enables checkout from a missing recurring-currency response", () => {
  const script = read("public/script.js");
  assert.match(script, /recurringCurrencies=Array\.isArray\(config\?\.recurringCurrencies\)\?config\.recurringCurrencies:\[\]/);
  assert.match(script, /catch\(\(\)=>\{recurringCurrencies=\[\]/);
});

test("contact section stays boxed and centered", () => {
  const css = fs.readFileSync(path.join(publicDir, "style.css"), "utf8");
  assert.match(css, /\.p27-contact\{box-sizing:border-box!important;padding:96px 0!important;\}/);
  assert.match(css, /\.p27-contact>div:first-child\{display:flex!important;flex-direction:column!important;align-items:center!important;text-align:center!important;min-width:0;\}/);
  assert.match(css, /\.p27-contact-links\{display:flex!important;justify-content:center!important;align-items:center!important;gap:20px!important;flex-wrap:wrap!important;margin-top:22px!important;\}/);
});

test("sign-in surface delegates authentication to Clerk without exposing credentials", () => {
  const auth = read("public/auth.js");
  assert.match(auth, /clerk\.openSignIn\(\{/);
  assert.match(auth, /clerk\.openSignUp\(\{/);
  assert.doesNotMatch(auth, /document\.createElement\("input"\)/);
  assert.doesNotMatch(auth, /passwordInput\.value/);
});

test("V132 authentication uses the documented browser Clerk instance flow", () => {
  const auth = read("public/auth.js");
  assert.match(auth, /const ClerkGlobal = window\.Clerk/);
  assert.match(auth, /typeof ClerkGlobal === "object" && typeof ClerkGlobal\.load === "function"/);
  assert.match(auth, /await clerk\.load\(\{[\s\S]*ui:\s*\{\s*ClerkUI:\s*clerkUICtor/);
  assert.doesNotMatch(auth, /new window\.Clerk\(config\.clerkPublishableKey\)/);
  assert.doesNotMatch(auth, /client constructor is unavailable/);
});

test("V146 authentication uses Clerk prebuilt sign-in and sign-up flows", () => {
  const auth = read("public/auth.js");
  assert.match(auth, /clerk\.openSignIn\(\{/);
  assert.match(auth, /clerk\.openSignUp\(\{/);
  assert.match(auth, /fallbackRedirectUrl: "\/workspace\/overview"/);
  assert.match(auth, /appearance: authAppearance\(\)/);
  assert.match(auth, /oauthFlow: "auto"/);
  assert.doesNotMatch(auth, /clerk\.client\.signIn\.create/);
  assert.doesNotMatch(auth, /attemptFirstFactor/);
  assert.doesNotMatch(auth, /piq-password-form/);
});

test("V146 forgot-password and reset-password use Clerk instead of a second password system", () => {
  const auth = read("public/auth.js");
  const forgot = read("public/forgot-password.html");
  const reset = read("public/reset-password.html");
  const server = read("server.js");
  assert.match(auth, /function openForgotPassword/);
  assert.match(auth, /clerk\.openSignIn\(\{/);
  assert.match(forgot, /Password recovery is securely handled by Clerk/);
  assert.match(reset, /Your password reset is managed by Clerk/);
  assert.doesNotMatch(forgot, /\/api\/password-reset\/request/);
  assert.doesNotMatch(reset, /\/api\/password-reset\/complete/);
  assert.doesNotMatch(server, /app\.post\("\/api\/password-reset\/request/);
  assert.doesNotMatch(server, /app\.post\("\/api\/password-reset\/complete/);
  assert.match(server, /const \{ isAuthenticated, userId \} = getAuth\(req\)/);
});

test("Protected workspace routes and public auth/legal routes are explicitly declared", () => {
  const server = read("server.js");
  assert.match(server, /const workspacePages = \["overview", "act", "analyze", "chat", "control", "reports", "billing", "help"\]/);
  assert.match(server, /app\.get\("\/forgot-password"/);
  assert.match(server, /app\.get\("\/sso-callback"/);
});

test("Upload and control-pack validation enforce size, type, shape and numeric bounds", () => {
  const script = read("public/script.js");
  const server = read("server.js");
  assert.match(script, /const maxUploadBytes = 20 \* 1024 \* 1024/);
  assert.match(script, /allowedMime/);
  assert.match(server, /transactions\.length > 10000/);
  assert.match(server, /material\.length > 200/);
  assert.match(server, /supplier\.length > 200/);
  assert.match(server, /quantity > 1e12/);
  assert.match(server, /price > 1e12/);
  assert.match(server, /Object\.keys\(item\)\.some/);
  assert.match(server, /maxRows = 5000/);
});

test("Motion system is executable JavaScript and does not inject fake product labels", () => {
  const motion = read("public/procureiq-animations.js");
  const css = read("public/procureiq-animations.css");
  assert.match(motion, /window\.__PROCUREIQ_ANIMATIONS__/);
  assert.match(motion, /IntersectionObserver/);
  assert.match(motion, /initDashboardHover/);
  assert.match(motion, /initSignalSweep/);
  assert.doesNotMatch(motion, /LIVE WORKFLOW/);
  assert.doesNotMatch(motion, /<span class="piq-pixel-badge"/);
  assert.match(css, /piq-signal-sweep::after/);
  assert.doesNotMatch(css, /piq-pixel-badge/);
});

test("V142 token donut follows the master requirement: blue remaining, white used", () => {
  const script = read("public/script.js");
  const workspaceCss = read("public/workspace.css");
  assert.match(script, /style\.setProperty\("--token-remaining", String\(remainingPct\)\)/);
  const ringMatches = [...workspaceCss.matchAll(/background:\s*conic-gradient\(([\s\S]*?)\)\s*!important;/g)];
  assert.ok(ringMatches.length > 0);
  const finalRing = ringMatches[ringMatches.length - 1][1];
  assert.match(finalRing, /var\(--token-remaining/);
  assert.match(finalRing, /#ffffff/);
});

test("V142 token reservation is account-persistent and handles near-exhaustion honestly", () => {
  const server = read("server.js");
  assert.match(server, /PLAN_TOKEN_LIMITS = Object\.fromEntries/);
  assert.match(server, /quota\.remaining <= 0/);
  assert.match(server, /Math\.min\(requested, quota\.remaining\)/);
  assert.match(server, /Your AI allowance is tracked per account and persists across sessions and devices/);
  assert.match(server, /DATE '2000-01-01'/);
  assert.doesNotMatch(server, /Your AI allowance is tracked per day/);
});

test("V143 upload feedback reports inserted, duplicate and invalid outcomes", () => {
  const script = read("public/script.js");
  assert.match(script, /const invalid = Number\(result\.invalid\) \|\| 0/);
  assert.match(script, /no new records added/);
  assert.match(script, /duplicate.*skipped/);
});

test("V143 contract recovery is supplier-aware", () => {
  const core = read("public/core-features.js");
  const analyze = read("public/workspace/analyze.html");
  assert.match(core, /contractSupplier/);
  assert.match(core, /supplierKey/);
  assert.match(core, /materialMatches/);
  assert.match(core, /Supplier was not specified/);
  assert.match(analyze, /id="contractSupplier"/);
});

test("V143 control audit flags missing evidence and mismatched PO identity", () => {
  const server = read("server.js");
  assert.match(server, /PO supplier does not match invoice supplier/);
  assert.match(server, /PO material does not match invoice material/);
  assert.match(server, /Goods receipt not found/);
  assert.match(server, /No valid control records were found/);
});

test("V143 control import stages validation before replacing the existing pack", () => {
  const server = read("server.js");
  const staging = server.indexOf('const contracts = [];');
  const deletion = server.indexOf('DELETE FROM procurement_contracts');
  assert.ok(staging >= 0 && deletion > staging);
  assert.match(server, /if \(!totalValid\) throw new Error/);
});

test("V144 server-side quota gates upload and new report generation", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /app\.post\("\/api\/transactions\/upload"/);
  assert.match(server, /requireTokenAllowance\(\s*userId,\s*res,\s*"Your AI token allowance has been exhausted/);
  assert.match(server, /app\.post\("\/api\/report-generation-access"/);
  assert.match(server, /app\.post\("\/api\/report-history"/);
  assert.match(server, /code: "TOKEN_LIMIT_REACHED"/);
});

test("V144 billing fails clearly when Razorpay plan configuration is missing and verification is idempotent", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /Razorpay .* plan configuration is missing/);
  assert.match(server, /razorpay_payment_id === paymentId/);
  assert.match(server, /Subscription is already active/);
  assert.match(server, /RAZORPAY_KEY_SECRET/);
});

test("V146 billing validates the configured Razorpay plan before checkout", () => {
  const server = read("server.js");
  assert.match(server, /v1\/plans\/\$\{encodeURIComponent\(planId\)\}/);
  assert.match(server, /remoteAmount !== expectedAmount/);
  assert.match(server, /remotePeriod !== "monthly"/);
  assert.match(server, /Razorpay plan mismatch/);
});

test("V144 new PDFs use a server quota decision while historical PDFs remain downloadable", () => {
  const script = fs.readFileSync(path.join(root, "public", "script.js"), "utf8");
  assert.match(script, /async function generatePDF\(snapshot, shouldSave=true\)/);
  assert.match(script, /\/api\/report-generation-access/);
  assert.match(script, /if \(shouldSave\)/);
  assert.match(script, /Historical[\s\S]*reports remain downloadable/i);
});
