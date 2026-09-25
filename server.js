const path = require("path");
const dotenv = require("dotenv");

// ProcureIQ stores local secrets in environment/.env.
// Keep the root .env fallback for compatibility with older setups.
const environmentFile = path.join(__dirname, "environment", ".env");
const rootEnvFile = path.join(__dirname, ".env");

if (require("fs").existsSync(environmentFile)) {
  dotenv.config({ path: environmentFile });
} else {
  dotenv.config({ path: rootEnvFile });
}

const crypto = require("crypto");

const express = require("express");
const { Pool } = require("pg");
const { GoogleGenAI } = require("@google/genai");
const { clerkMiddleware, getAuth, clerkClient } = require("@clerk/express");
const { calculatePriceVariance, calculatePotentialSaving } = require("./lib/procurement-metrics");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

/* =====================================================
   PORT
===================================================== */

const PORT = process.env.PORT || 3000;
const clerkConfigured = Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const razorpayConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const emailConfigured = Boolean(process.env.RESEND_API_KEY && (process.env.RESEND_FROM_EMAIL || process.env.INQUIRY_FROM_EMAIL));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLAN_CATALOG = {
  free: { name: "Free", monthly: 0, maxTransactions: 1000, maxUsers: 1, aiTokens: 5000, aiRequests: 10, features: ["Overview", "Exception Resolver", "Help & Support"] },
  starter: { name: "Starter", monthly: 1499, maxTransactions: 5000, maxUsers: 1, aiTokens: 50000, aiRequests: 100, features: ["Overview", "Exception Resolver", "Reports", "PDF export"] },
  business: { name: "Business", monthly: 4999, maxTransactions: 25000, maxUsers: 5, aiTokens: 200000, aiRequests: 400, features: ["Overview", "Exception Resolver", "Contract Recovery", "Guided Buying", "Supplier Risk", "Reports", "Advanced analysis"] },
  pro: { name: "Pro", monthly: 11999, maxTransactions: 100000, maxUsers: 15, aiTokens: 500000, aiRequests: 1000, features: ["Everything in Business", "Priority support", "API-ready foundation"] },
  enterprise: { name: "Enterprise", monthly: null, maxTransactions: null, maxUsers: null, aiTokens: null, aiRequests: null, features: ["Custom limits", "Custom integrations", "Priority support"] }
};
const PLAN_PRICES = { INR: { starter: 1499, business: 4999, pro: 11999 }, USD: { starter: 18, business: 59, pro: 139 }, EUR: { starter: 16, business: 54, pro: 129 }, GBP: { starter: 14, business: 46, pro: 109 }, AED: { starter: 66, business: 217, pro: 510 }, SGD: { starter: 24, business: 79, pro: 185 } };
const COUNTRY_CURRENCY_DEFAULTS = { IN: "INR", US: "USD", GB: "GBP", AE: "AED", SG: "SGD", DE: "EUR", FR: "EUR" };
const SUPPORTED_CURRENCIES = Object.keys(PLAN_PRICES);
const RECURRING_CURRENCY_PLAN_IDS = {
  INR: { starter: process.env.RAZORPAY_PLAN_STARTER_ID, business: process.env.RAZORPAY_PLAN_BUSINESS_ID, pro: process.env.RAZORPAY_PLAN_PRO_ID },
  USD: { starter: process.env.RAZORPAY_PLAN_STARTER_USD_ID, business: process.env.RAZORPAY_PLAN_BUSINESS_USD_ID, pro: process.env.RAZORPAY_PLAN_PRO_USD_ID },
  EUR: { starter: process.env.RAZORPAY_PLAN_STARTER_EUR_ID, business: process.env.RAZORPAY_PLAN_BUSINESS_EUR_ID, pro: process.env.RAZORPAY_PLAN_PRO_EUR_ID },
  GBP: { starter: process.env.RAZORPAY_PLAN_STARTER_GBP_ID, business: process.env.RAZORPAY_PLAN_BUSINESS_GBP_ID, pro: process.env.RAZORPAY_PLAN_PRO_GBP_ID },
  AED: { starter: process.env.RAZORPAY_PLAN_STARTER_AED_ID, business: process.env.RAZORPAY_PLAN_BUSINESS_AED_ID, pro: process.env.RAZORPAY_PLAN_PRO_AED_ID },
  SGD: { starter: process.env.RAZORPAY_PLAN_STARTER_SGD_ID, business: process.env.RAZORPAY_PLAN_BUSINESS_SGD_ID, pro: process.env.RAZORPAY_PLAN_PRO_SGD_ID }
};
function getPlanDefinition(planKey, currency = "INR") {
  const key = String(planKey || "").toLowerCase();
  const code = String(currency || "INR").toUpperCase();
  if (!PLAN_CATALOG[key] || !PLAN_PRICES[code]?.[key]) return null;
  return { ...PLAN_CATALOG[key], plan: key, currency: code, amount: Math.round(PLAN_PRICES[code][key] * 100) };
}


/* =====================================================
   POSTGRESQL
===================================================== */

let pool;
let databaseReady = false;
let databaseInitializationError = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    // Required for many hosted PostgreSQL providers
    ssl: process.env.DB_SSL_CA
      ? { ca: process.env.DB_SSL_CA, rejectUnauthorized: true }
      : { rejectUnauthorized: false }
  });
} else {
  pool = new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "procureiq",
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 5432
  });
}


/* =====================================================
   GEMINI
===================================================== */

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    })
  : null;


/* =====================================================
   MIDDLEWARE
===================================================== */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});

app.post("/api/razorpay/webhook", express.raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: "Razorpay webhook secret is not configured." });
  const signature = String(req.headers["x-razorpay-signature"] || "");
  const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return res.status(400).json({ error: "Invalid webhook signature." });
  try {
    const event = JSON.parse(req.body.toString("utf8"));
    const entity = event?.payload?.subscription?.entity;
    const subscriptionId = entity?.id;
    if (subscriptionId) {
      const status = String(entity.status || "").toLowerCase();
      const cancelAtCycleEnd = Boolean(entity.cancel_at_cycle_end);
      const expiresAt = entity.current_end ? new Date(Number(entity.current_end) * 1000) : null;
      await ensureSubscriptionsTable();
      await pool.query(`UPDATE subscriptions SET status=$1, cancel_at_cycle_end=$2, expires_at=COALESCE($3,expires_at), updated_at=CURRENT_TIMESTAMP WHERE razorpay_subscription_id=$4`, [status || "unknown", cancelAtCycleEnd, expiresAt, subscriptionId]);
    }
    return res.json({ received: true });
  } catch (error) {
    console.error("Razorpay webhook failed:", error.message);
    return res.status(400).json({ error: "Invalid webhook payload." });
  }
});

app.use(express.json({ limit: "20mb" }));

/* Lightweight in-process API abuse protection. This intentionally has no
   dependency and is a safety layer, not a replacement for an edge/WAF rate
   limiter in a multi-instance production deployment. */
const rateBuckets = new Map();
function rateLimit({ windowMs = 60_000, max = 120, keyPrefix = "api" } = {}) {
  return (req, res, next) => {
    const identity = String(req.ip || req.socket.remoteAddress || "unknown");
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs) {
      bucket = { startedAt: now, count: 0 };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader("Retry-After", Math.ceil((windowMs - (now - bucket.startedAt)) / 1000));
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    next();
  };
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.startedAt < cutoff) rateBuckets.delete(key);
  }
}, 10 * 60_000).unref();

app.use("/api", rateLimit({ windowMs: 60_000, max: 180, keyPrefix: "api" }));

// Prevent cross-site state-changing API requests. Razorpay's signed webhook is
// registered before this middleware and is intentionally exempt.
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = String(req.headers.origin || "").trim();
  const host = String(req.headers.host || "").trim();
  if (!origin) return next();
  try {
    const url = new URL(origin);
    if (url.host !== host || !["http:", "https:"].includes(url.protocol)) {
      return res.status(403).json({ error: "Cross-site API requests are not allowed." });
    }
  } catch (_) {
    return res.status(403).json({ error: "Invalid request origin." });
  }
  next();
});

app.use("/api/public-inquiries", rateLimit({ windowMs: 10 * 60_000, max: 8, keyPrefix: "public-inquiry" }));

// Clerk authentication state is attached to requests before routes are evaluated.
// API routes below explicitly require an authenticated Clerk session.
if (clerkConfigured) {
  app.use(clerkMiddleware());
} else {
  console.warn("⚠️ Clerk is not configured. Add CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to .env");
}

// Public runtime config: only the publishable key is exposed to the browser.
app.get("/api/config", (req, res) => {
  res.json({
    clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || null,
    clerkConfigured,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || null,
    razorpayConfigured,
    emailConfigured,
    databaseReady,
    recurringCurrencies: Object.entries(RECURRING_CURRENCY_PLAN_IDS).filter(([, plans]) => ["starter", "business", "pro"].every(key => Boolean(plans[key]))).map(([currency]) => currency)
  });
});

app.get("/api/health", async (req, res) => {
  if (!databaseReady) {
    return res.status(503).json({
      status: "degraded",
      database: "unavailable",
      authentication: clerkConfigured ? "configured" : "not_configured",
      payments: razorpayConfigured ? "configured" : "not_configured",
      error: "ProcureIQ database initialization has not completed."
    });
  }
  try {
    await pool.query("SELECT 1");
    return res.json({
      status: "ok",
      database: "ready",
      authentication: clerkConfigured ? "configured" : "not_configured",
      payments: razorpayConfigured ? "configured" : "not_configured"
    });
  } catch (error) {
    databaseReady = false;
    databaseInitializationError = error.message;
    return res.status(503).json({
      status: "degraded",
      database: "unavailable",
      authentication: clerkConfigured ? "configured" : "not_configured",
      payments: razorpayConfigured ? "configured" : "not_configured",
      error: "ProcureIQ database is currently unavailable."
    });
  }
});

// Serve frontend files.
// IMPORTANT: only the "public" folder is exposed to the browser. Serving the
// project root (as before) would let anyone download server.js, auth.js,
// package.json and : critically : a .env file placed in the project root,
// leaking database, Clerk, Razorpay and Gemini secrets. Never widen this path.
app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "privacy.html"));
});

app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "terms.html"));
});

app.get("/refund-cancellation", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "refund-cancellation.html"));
});

app.use("/workspace", requireAuthenticatedPage);
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".txt": "text/plain; charset=utf-8",
      ".xml": "application/xml; charset=utf-8"
    };
    const contentType = contentTypes[ext];
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
  }
}));


/* =====================================================
   DATABASE INITIALIZATION
===================================================== */


async function ensureProcurementControlTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS procurement_contracts (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      contract_ref TEXT NOT NULL,
      supplier TEXT NOT NULL,
      material TEXT NOT NULL,
      contracted_unit_price NUMERIC NOT NULL,
      rebate_threshold NUMERIC DEFAULT 0,
      rebate_rate NUMERIC DEFAULT 0,
      effective_from DATE,
      effective_to DATE,
      source_file_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_procurement_contracts_user
      ON procurement_contracts(clerk_user_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      po_number TEXT NOT NULL,
      supplier TEXT NOT NULL,
      material TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      unit_price NUMERIC NOT NULL,
      order_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_user
      ON purchase_orders(clerk_user_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS goods_receipts (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      grn_number TEXT NOT NULL,
      po_number TEXT NOT NULL,
      received_quantity NUMERIC NOT NULL,
      received_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_goods_receipts_user
      ON goods_receipts(clerk_user_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS control_actions (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      po_number TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clerk_user_id, invoice_number)
    );
    CREATE INDEX IF NOT EXISTS idx_control_actions_user
      ON control_actions(clerk_user_id);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS supplier_invoices (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      po_number TEXT NOT NULL,
      supplier TEXT NOT NULL,
      material TEXT NOT NULL,
      quantity NUMERIC NOT NULL,
      unit_price NUMERIC NOT NULL,
      invoice_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_supplier_invoices_user
      ON supplier_invoices(clerk_user_id);
  `);
}

async function initializeDatabase() {
  databaseReady = false;
  databaseInitializationError = null;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        material TEXT NOT NULL,
        supplier TEXT NOT NULL,
        quantity NUMERIC NOT NULL,
        price NUMERIC NOT NULL,
        clerk_user_id TEXT,
        transaction_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;
    `);

    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_date DATE;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS upload_batch_id UUID;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_file_name TEXT;`);
    await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_clerk_user_id
      ON transactions (clerk_user_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_user_batch
      ON transactions (clerk_user_id, upload_batch_id, id);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_history (
        id SERIAL PRIMARY KEY,
        clerk_user_id TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        transactions INTEGER NOT NULL DEFAULT 0,
        total_spend NUMERIC NOT NULL DEFAULT 0,
        total_savings NUMERIC NOT NULL DEFAULT 0,
        opportunity_count INTEGER NOT NULL DEFAULT 0,
        snapshot JSONB NOT NULL,
        UNIQUE (clerk_user_id, id)
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_report_history_user_created
      ON report_history (clerk_user_id, created_at DESC);
    `);

    await ensureProcurementControlTables();

    console.log("✅ PostgreSQL connected successfully");
    console.log("✅ Transactions table ready");
    await ensureInquiriesTable();
    await ensureUsageTable();
    await ensureSubscriptionsTable();
    await ensureReviewsTable();
    await ensureOpportunityMemoryTable();
    console.log("✅ Inquiries table ready");
    console.log("✅ AI usage and reviews tables ready");
    databaseReady = true;
    databaseInitializationError = null;

  } catch (error) {
    databaseReady = false;
    databaseInitializationError = error.message;
    console.error(
      "❌ PostgreSQL initialization failed:",
      error.message
    );
  }
}


/* =====================================================
   AUTHENTICATION
===================================================== */

function requireAuthenticatedUser(req, res) {
  if (!clerkConfigured) {
    res.status(503).json({
      error: "Authentication is not configured. Add Clerk keys to .env."
    });
    return null;
  }

  const { isAuthenticated, userId } = getAuth(req);

  if (!isAuthenticated || !userId) {
    res.status(401).json({
      error: "Authentication required."
    });
    return null;
  }

  return userId;
}

function requireAuthenticatedPage(req, res, next) {
  if (!clerkConfigured) return res.redirect(302, "/?auth=required");
  const { isAuthenticated, userId } = getAuth(req);
  if (!isAuthenticated || !userId) return res.redirect(302, "/?auth=required");
  // Workspace pages remain directly navigable. Premium entitlements are enforced
  // at the feature/API action level so a user never gets unexpectedly redirected
  // away from the page they intentionally selected.
  // This also keeps the workspace usable for demos and makes upgrade prompts contextual.
  return next();
}


/* =====================================================
   RAZORPAY STANDARD WEB CHECKOUT
===================================================== */


function requireRazorpay(res) {
  if (!razorpayConfigured) {
    res.status(503).json({ error: "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env." });
    return false;
  }
  return true;
}

app.post("/api/create-subscription", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId || !requireRazorpay(res)) return;
  try {
    const planKey = String(req.body?.plan || "").toLowerCase();
    const country = String(req.body?.country || "IN").toUpperCase().slice(0, 2);
    const currency = String(req.body?.currency || COUNTRY_CURRENCY_DEFAULTS[country] || "INR").toUpperCase();
    const plan = getPlanDefinition(planKey, currency);
    if (!plan) return res.status(400).json({ error: "Choose a valid paid ProcureIQ plan and supported billing currency." });
    const planId = RECURRING_CURRENCY_PLAN_IDS[currency]?.[planKey];
    if (!razorpayConfigured) return res.status(503).json({ error: "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server environment." });
    if (!planId) return res.status(503).json({ error: `Razorpay ${currency} plan configuration is missing for ${plan.name}. Add the matching RAZORPAY_PLAN_*_ID environment variable.` });
    await ensureSubscriptionsTable();
    const existing = await pool.query(`SELECT razorpay_subscription_id, status, cancel_at_cycle_end, plan, currency, amount FROM subscriptions WHERE clerk_user_id=$1 AND status IN ('created','authenticated','active') AND cancel_at_cycle_end=FALSE ORDER BY updated_at DESC LIMIT 1`, [userId]);
    if (existing.rowCount) {
      const current = existing.rows[0];
      if (current.status === "active" && String(current.plan).toLowerCase() === planKey && String(current.currency).toUpperCase() === currency) {
        return res.status(409).json({ error: "You already have this active subscription." });
      }
      return res.status(409).json({ error: "An active or pending subscription already exists on this account. Cancel it before starting another subscription." });
    }
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");

    // Validate the configured Razorpay plan before creating a subscription.
    // This prevents a mis-mapped environment variable (for example a Starter
    // ID pointing at a Business-priced plan) from opening checkout for the
    // wrong amount.
    const remotePlanResponse = await fetch(`https://api.razorpay.com/v1/plans/${encodeURIComponent(planId)}`, {
      headers: { Authorization: `Basic ${credentials}` }
    });
    const remotePlan = await remotePlanResponse.json().catch(() => ({}));
    const remoteAmount = Number(remotePlan?.item?.amount);
    const expectedAmount = Number(plan.amount);
    const remotePeriod = String(remotePlan?.period || "").toLowerCase();
    if (!remotePlanResponse.ok || remotePlan?.id !== planId) {
      return res.status(502).json({ error: `The configured Razorpay ${currency} ${plan.name} plan could not be verified. Check the matching RAZORPAY_PLAN_*_ID.` });
    }
    if (remoteAmount !== expectedAmount || remotePeriod !== "monthly") {
      return res.status(409).json({
        error: `Razorpay plan mismatch for ${plan.name}. ProcureIQ expects ${plan.currency} ${Number(expectedAmount / 100).toLocaleString("en-IN")} monthly, but the configured Razorpay plan is ${Number(remoteAmount / 100 || 0).toLocaleString("en-IN")} ${String(remotePlan?.period || "")} . Update the matching RAZORPAY_PLAN_*_ID in the environment.`
      });
    }

    const response = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${credentials}` },
      body: JSON.stringify({ plan_id: planId, total_count: 120, customer_notify: 1, notes: { product: "ProcureIQ", plan: planKey, clerk_user_id: userId, currency, country } })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(500).json({ error: result?.error?.description || "Unable to create subscription." });
    await ensureSubscriptionsTable();
    await pool.query(`INSERT INTO subscriptions (clerk_user_id, plan, razorpay_subscription_id, currency, amount, status, expires_at) VALUES ($1,$2,$3,$4,$5,'created',NULL) ON CONFLICT (razorpay_subscription_id) DO NOTHING`, [userId, planKey, result.id, currency, plan.amount]);
    return res.json({ subscription_id: result.id, key_id: process.env.RAZORPAY_KEY_ID, plan: planKey, plan_name: plan.name, currency, amount: plan.amount });
  } catch (error) {
    console.error("Subscription creation failed:", error.message);
    return res.status(500).json({ error: "Unable to start subscription." });
  }
});

app.post("/api/verify-subscription", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId || !requireRazorpay(res)) return;
  const { razorpay_subscription_id: subscriptionId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (!subscriptionId || !paymentId || !signature) return res.status(400).json({ error: "Missing subscription verification fields." });
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${subscriptionId}|${paymentId}`).digest("hex");
  if (expected.length !== String(signature).length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)))) return res.status(400).json({ error: "Invalid subscription signature." });
  try {
    await ensureSubscriptionsTable();
    const stored = await pool.query(`SELECT plan, currency, amount, status, razorpay_payment_id FROM subscriptions WHERE clerk_user_id=$1 AND razorpay_subscription_id=$2 LIMIT 1`, [userId, subscriptionId]);
    if (!stored.rowCount) return res.status(404).json({ error: "Subscription record not found." });
    // Razorpay may retry a successful callback. Treat the same verified
    // payment as idempotent rather than creating a second entitlement.
    if (stored.rows[0].razorpay_payment_id === paymentId && ["active", "authenticated"].includes(String(stored.rows[0].status || "").toLowerCase())) {
      return res.json({ success: true, plan: stored.rows[0].plan, message: "Subscription is already active." });
    }
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
    const remote = await fetch(`https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, { headers: { Authorization: `Basic ${credentials}` } });
    const remoteData = await remote.json().catch(() => ({}));
    if (!remote.ok || remoteData?.id !== subscriptionId) return res.status(400).json({ error: "Subscription could not be verified with Razorpay." });
    if (!["active", "authenticated"].includes(String(remoteData?.status || "").toLowerCase())) return res.status(409).json({ error: `Subscription is not active yet. Current status: ${remoteData?.status || "unknown"}.` });
    if (remoteData?.notes?.clerk_user_id && String(remoteData.notes.clerk_user_id) !== String(userId)) return res.status(403).json({ error: "Subscription does not belong to the signed-in account." });
    const result = await pool.query(`UPDATE subscriptions SET razorpay_payment_id=$1, status='active', starts_at=CURRENT_TIMESTAMP, expires_at=COALESCE($4,CURRENT_TIMESTAMP + INTERVAL '1 month'), updated_at=CURRENT_TIMESTAMP WHERE clerk_user_id=$2 AND razorpay_subscription_id=$3 RETURNING plan`, [paymentId, userId, subscriptionId, remoteData.current_end ? new Date(Number(remoteData.current_end) * 1000) : null]);
    if (!result.rowCount) return res.status(404).json({ error: "Subscription record not found." });
    return res.json({ success: true, plan: result.rows[0].plan, message: "Subscription activated successfully." });
  } catch (error) {
    console.error("Subscription verification failed:", error.message);
    return res.status(500).json({ error: "Unable to activate subscription." });
  }
});

app.post("/api/cancel-subscription", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId || !requireRazorpay(res)) return;
  try {
    const active = await pool.query(`SELECT razorpay_subscription_id FROM subscriptions WHERE clerk_user_id=$1 AND status IN ('active','authenticated') ORDER BY updated_at DESC LIMIT 1`, [userId]);
    const subscriptionId = active.rows[0]?.razorpay_subscription_id;
    if (!subscriptionId) return res.status(404).json({ error: "No active recurring subscription found." });
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
    const response = await fetch(`https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { method: "POST", headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" }, body: JSON.stringify({ cancel_at_cycle_end: 1 }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(500).json({ error: result?.error?.description || "Unable to cancel subscription." });
    await pool.query(`UPDATE subscriptions SET cancel_at_cycle_end=TRUE, updated_at=CURRENT_TIMESTAMP WHERE razorpay_subscription_id=$1`, [subscriptionId]);
    return res.json({ success: true, message: "Subscription cancellation scheduled for the end of the current billing period." });
  } catch (error) {
    console.error("Subscription cancellation failed:", error.message);
    return res.status(500).json({ error: "Unable to cancel subscription." });
  }
});

/* =====================================================
   AI USAGE + REVIEWS
===================================================== */
const FREE_USER_CAP = 50;
const FREE_TOKEN_POOL = 100000;
// AI allowance is account-scoped and persistent. Signing out/in, changing
// devices, or opening a new browser must never create a fresh allowance.
// Keep the enforcement limits in one source of truth with the plan catalog.
// Enterprise remains uncapped here because its limits are configured contractually.
const PLAN_TOKEN_LIMITS = Object.fromEntries(
  Object.entries(PLAN_CATALOG)
    .filter(([plan]) => plan !== "enterprise" && Number.isFinite(Number(PLAN_CATALOG[plan].aiTokens)))
    .map(([plan, definition]) => [plan, Number(definition.aiTokens)])
);
const AI_USAGE_ANCHOR_DATE = "2000-01-01";

async function ensureUsageTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      usage_date DATE NOT NULL DEFAULT DATE '2000-01-01',
      plan TEXT NOT NULL DEFAULT 'free',
      tokens_used BIGINT NOT NULL DEFAULT 0,
      insight_requests INTEGER NOT NULL DEFAULT 0,
      chat_requests INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clerk_user_id, usage_date)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(clerk_user_id, usage_date);`);
  await pool.query(`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';`);
  await pool.query(`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS tokens_used BIGINT NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS insight_requests INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS chat_requests INTEGER NOT NULL DEFAULT 0;`);

  // Migrate legacy daily rows into one persistent account-level record. This
  // preserves usage already consumed instead of giving every login/day a new
  // allowance. The anchor date is an internal storage key, not a reset date.
  await pool.query(`
    INSERT INTO ai_usage (clerk_user_id, usage_date, plan, tokens_used, insight_requests, chat_requests, updated_at)
    SELECT clerk_user_id, DATE '2000-01-01',
           (ARRAY_AGG(plan ORDER BY updated_at DESC))[1],
           SUM(tokens_used), SUM(insight_requests), SUM(chat_requests), CURRENT_TIMESTAMP
    FROM ai_usage
    WHERE usage_date <> DATE '2000-01-01'
    GROUP BY clerk_user_id
    ON CONFLICT (clerk_user_id, usage_date) DO UPDATE SET
      tokens_used = GREATEST(ai_usage.tokens_used, EXCLUDED.tokens_used),
      insight_requests = GREATEST(ai_usage.insight_requests, EXCLUDED.insight_requests),
      chat_requests = GREATEST(ai_usage.chat_requests, EXCLUDED.chat_requests),
      plan = EXCLUDED.plan,
      updated_at = CURRENT_TIMESTAMP
  `);
  await pool.query(`DELETE FROM ai_usage WHERE usage_date <> DATE '2000-01-01'`);
}


async function ensureReviewsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT,
      display_name TEXT,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      review TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);`);
}


async function ensureSubscriptionsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      razorpay_payment_id TEXT UNIQUE,
      razorpay_order_id TEXT UNIQUE,
      razorpay_subscription_id TEXT UNIQUE,
      currency TEXT NOT NULL DEFAULT 'INR',
      amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      cancel_at_cycle_end BOOLEAN NOT NULL DEFAULT FALSE,
      starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';`);
  await pool.query(`ALTER TABLE subscriptions ALTER COLUMN razorpay_payment_id DROP NOT NULL;`);
  await pool.query(`ALTER TABLE subscriptions ALTER COLUMN razorpay_order_id DROP NOT NULL;`);
  await pool.query(`ALTER TABLE subscriptions ALTER COLUMN expires_at DROP NOT NULL;`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT UNIQUE;`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_cycle_end BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_razorpay_subscription ON subscriptions(razorpay_subscription_id) WHERE razorpay_subscription_id IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_expiry ON subscriptions(clerk_user_id, expires_at DESC);`);
}

async function ensureOpportunityMemoryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opportunity_memory (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'detected',
      decision TEXT,
      action TEXT,
      outcome_type TEXT,
      negotiated_saving NUMERIC DEFAULT 0,
      realized_saving NUMERIC DEFAULT 0,
      note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clerk_user_id, transaction_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_opportunity_memory_user ON opportunity_memory(clerk_user_id, updated_at DESC);`);
}

async function getActivePlan(userId) {
  const result = await pool.query(`SELECT plan, currency, amount, starts_at, expires_at, cancel_at_cycle_end FROM subscriptions WHERE clerk_user_id=$1 AND status IN ('active','authenticated') AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ORDER BY expires_at DESC LIMIT 1`, [userId]);
  return result.rows[0] ? { ...result.rows[0], plan: String(result.rows[0].plan).toLowerCase(), cancel_at_cycle_end: Boolean(result.rows[0].cancel_at_cycle_end) } : { plan: 'free', currency: 'INR', amount: 0, starts_at: null, expires_at: null, cancel_at_cycle_end: false };
}

function planAllows(planKey, requiredPlan) {
  const rank = { free: 0, starter: 1, business: 2, pro: 3, enterprise: 4 };
  return (rank[String(planKey).toLowerCase()] ?? 0) >= (rank[String(requiredPlan).toLowerCase()] ?? 0);
}

async function requirePlanPage(req, res, next, requiredPlan) {
  if (!clerkConfigured) return res.redirect(302, '/?auth=required');
  const { isAuthenticated, userId } = getAuth(req);
  if (!isAuthenticated || !userId) return res.redirect(302, '/?auth=required');
  try {
    const active = await getActivePlan(userId);
    if (!planAllows(active.plan, requiredPlan)) return res.redirect(302, `/workspace/billing?upgrade=1&feature=${encodeURIComponent(requiredPlan)}`);
    return next();
  } catch (_) {
    return res.status(503).send('Workspace temporarily unavailable.');
  }
}

async function getUsageRecord(userId) {
  const activePlanResult = await pool.query(`SELECT plan FROM subscriptions WHERE clerk_user_id=$1 AND status IN ('active','authenticated') AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) ORDER BY expires_at DESC LIMIT 1`, [userId]);
  const activePlan = String(activePlanResult.rows[0]?.plan || 'free').toLowerCase();
  const result = await pool.query(`
    INSERT INTO ai_usage (clerk_user_id, usage_date, plan)
    VALUES ($1, DATE '2000-01-01', $2)
    ON CONFLICT (clerk_user_id, usage_date) DO UPDATE SET plan = $2, updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [userId, activePlan]);
  return result.rows[0];
}

async function getFreeUserCapacity(userId) {
  const result = await pool.query(`SELECT COUNT(DISTINCT clerk_user_id)::int AS count FROM ai_usage WHERE usage_date=DATE '2000-01-01' AND plan='free' AND tokens_used > 0`);
  const activeUsers = Number(result.rows[0]?.count) || 0;
  const current = await pool.query(`SELECT 1 FROM ai_usage WHERE clerk_user_id=$1 AND usage_date=DATE '2000-01-01' AND plan='free' LIMIT 1`, [userId]);
  const isCurrent = current.rowCount > 0;
  return { activeUsers, cap: FREE_USER_CAP, reached: activeUsers >= FREE_USER_CAP && !isCurrent };
}

async function getAIQuota(userId) {
  const usage = await getUsageRecord(userId);
  const plan = String(usage.plan || 'free').toLowerCase();
  const limit = PLAN_TOKEN_LIMITS[plan] || PLAN_TOKEN_LIMITS.free;
  const rawUsed = Math.max(0, Number(usage.tokens_used) || 0);
  const used = Math.min(rawUsed, limit);
  if (rawUsed != used) {
    await pool.query(`UPDATE ai_usage SET tokens_used=$2, updated_at=CURRENT_TIMESTAMP WHERE clerk_user_id=$1 AND usage_date=DATE '2000-01-01'`, [userId, used]);
  }
  const capacity = plan === 'free' ? await getFreeUserCapacity(userId) : { activeUsers: 0, cap: FREE_USER_CAP, reached: false };
  return { usage: { ...usage, tokens_used: used }, plan, limit, used, remaining: Math.max(0, limit-used), ...capacity };
}

async function requireTokenAllowance(userId, res, message = "Your AI token allowance has been exhausted. Upgrade your plan to continue processing procurement data.") {
  const quota = await getAIQuota(userId);
  if (quota.reached) {
    res.status(402).json({
      error: "The free workspace capacity is currently full. Upgrade your plan to continue.",
      upgrade_required: true,
      free_user_cap_reached: true,
      tokens_remaining: quota.remaining
    });
    return null;
  }
  if (quota.remaining <= 0) {
    res.status(402).json({
      error: message,
      code: "TOKEN_LIMIT_REACHED",
      usage_limit_reached: true,
      upgrade_required: true,
      tokens_remaining: 0
    });
    return null;
  }
  return quota;
}

async function recordAIUsage(userId, tokens, type) {
  const safeTokens = Math.max(0, Number(tokens) || 0);
  await getUsageRecord(userId);
  await pool.query(`
    UPDATE ai_usage
    SET tokens_used = tokens_used + $2,
        insight_requests = insight_requests + CASE WHEN $3='insight' THEN 1 ELSE 0 END,
        chat_requests = chat_requests + CASE WHEN $3='chat' THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE clerk_user_id=$1 AND usage_date=DATE '2000-01-01'
  `, [userId, safeTokens, type]);
}

async function reserveAIQuota(userId, estimatedTokens) {
  const requested = Math.max(1, Math.ceil(Number(estimatedTokens) || 0));
  const quota = await getAIQuota(userId);
  if (quota.reached) return { ok: false, reason: "workspace_cap", quota };
  if (quota.remaining <= 0) return { ok: false, reason: "token_limit", quota };

  // The estimate is conservative. Near exhaustion, reserve only what the
  // account actually has left instead of incorrectly blocking an otherwise
  // valid AI action with a "limit reached" error.
  const reservation = Math.min(requested, quota.remaining);
  const result = await pool.query(`
    UPDATE ai_usage
    SET tokens_used = tokens_used + $2, updated_at = CURRENT_TIMESTAMP
    WHERE clerk_user_id=$1
      AND usage_date=DATE '2000-01-01'
      AND tokens_used + $2 <= $3
    RETURNING tokens_used
  `, [userId, reservation, quota.limit]);
  if (!result.rowCount) return { ok: false, reason: "token_limit", quota: await getAIQuota(userId) };
  return { ok: true, reserved: reservation, estimated: requested, tokens_used: Number(result.rows[0].tokens_used) || reservation };
}

async function finalizeAIUsage(userId, reservedTokens, actualTokens, type) {
  const reserved = Math.max(0, Number(reservedTokens) || 0);
  const actual = Math.max(0, Number(actualTokens) || 0);
  const delta = actual - reserved;
  const quota = await getAIQuota(userId);
  await pool.query(`
    UPDATE ai_usage
    SET tokens_used = LEAST($3, GREATEST(0, tokens_used + $2)),
        insight_requests = insight_requests + CASE WHEN $4='insight' THEN 1 ELSE 0 END,
        chat_requests = chat_requests + CASE WHEN $4='chat' THEN 1 ELSE 0 END,
        updated_at = CURRENT_TIMESTAMP
    WHERE clerk_user_id=$1 AND usage_date=DATE '2000-01-01'
  `, [userId, delta, quota.limit, type]);
}

async function releaseAIQuota(userId, reservedTokens) {
  const reserved = Math.max(0, Number(reservedTokens) || 0);
  if (!reserved) return;
  await pool.query(`
    UPDATE ai_usage
    SET tokens_used = GREATEST(0, tokens_used - $2), updated_at=CURRENT_TIMESTAMP
    WHERE clerk_user_id=$1 AND usage_date=DATE '2000-01-01'
  `, [userId, reserved]);
}

app.get("/api/usage", async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: "ProcureIQ database is unavailable. Check the server database configuration." });
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const quota = await getAIQuota(userId);
    res.json({ plan: quota.plan, tokens_used: quota.used, token_limit: quota.limit, tokens_remaining: quota.remaining, insight_requests: Number(quota.usage.insight_requests)||0, chat_requests: Number(quota.usage.chat_requests)||0, free_user_cap: FREE_USER_CAP, free_users_active: quota.activeUsers, free_user_cap_reached: quota.reached, free_token_pool: FREE_TOKEN_POOL });
  } catch (error) {
    console.error("Usage endpoint failed:", error.message);
    res.status(500).json({ error: "Unable to load AI usage." });
  }
});

app.get("/api/entitlements", async (req, res) => {
  if (!databaseReady) return res.status(503).json({ error: "ProcureIQ database is unavailable. Check the server database configuration." });
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const active = await getActivePlan(userId);
    const catalog = PLAN_CATALOG[active.plan] || PLAN_CATALOG.free;
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM transactions WHERE clerk_user_id=$1`, [userId]);
    res.json({ plan: active.plan, plan_name: catalog.name, features: catalog.features, max_transactions: catalog.maxTransactions, max_users: catalog.maxUsers, ai_tokens: catalog.aiTokens, ai_requests: catalog.aiRequests, stored_transactions: Number(count.rows[0]?.count)||0, currency: active.currency, amount: Number(active.amount)||0, expires_at: active.expires_at, cancel_at_cycle_end: Boolean(active.cancel_at_cycle_end), supported_currencies: SUPPORTED_CURRENCIES, country_currency_defaults: COUNTRY_CURRENCY_DEFAULTS, prices: PLAN_PRICES });
  } catch (error) {
    console.error("Entitlements endpoint failed:", error.message);
    res.status(500).json({ error: "Unable to load plan entitlements." });
  }
});

app.post("/api/reviews", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  const rating = Number(req.body?.rating);
  const review = String(req.body?.review || "").trim();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: "Please select a rating from 1 to 5." });
  if (!review || review.length > 800) return res.status(400).json({ error: "Please provide a review within 800 characters." });
  try {
    const displayName = "ProcureIQ user";
    await pool.query(`INSERT INTO reviews (clerk_user_id, display_name, rating, review, status) VALUES ($1,$2,$3,$4,'pending')`, [userId, displayName, rating, review]);
    res.json({ success: true, message: "Review submitted for approval." });
  } catch (error) { console.error("Review submission failed:", error.message); res.status(500).json({ error: "Unable to submit review." }); }
});

app.get("/api/reviews", async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, display_name, rating, review, created_at FROM reviews WHERE status='approved' ORDER BY created_at DESC LIMIT 12`);
    const reviews = result.rows;
    const average = reviews.length ? reviews.reduce((sum, item) => sum + Number(item.rating), 0) / reviews.length : 0;
    res.json({ reviews, average });
  } catch (error) { console.error("Review fetch failed:", error.message); res.status(500).json({ error: "Unable to load reviews." }); }
});

function requireReviewAdmin(req, res) {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return null;
  const admins = String(process.env.ADMIN_CLERK_USER_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
  if (!admins.includes(String(userId))) { res.status(403).json({ error: "Admin access required." }); return null; }
  return userId;
}

app.get("/api/admin/reviews", async (req, res) => {
  const userId = requireReviewAdmin(req, res); if (!userId) return;
  try { const result = await pool.query(`SELECT id, display_name, rating, review, status, created_at FROM reviews ORDER BY created_at DESC LIMIT 200`); res.json({ reviews: result.rows }); }
  catch (error) { console.error("Admin review fetch failed:", error.message); res.status(500).json({ error: "Unable to load review moderation queue." }); }
});

app.patch("/api/admin/reviews/:id", async (req, res) => {
  const userId = requireReviewAdmin(req, res); if (!userId) return;
  const id = Number(req.params.id);
  const status = String(req.body?.status || "").toLowerCase();
  if (!Number.isInteger(id) || !["approved", "rejected", "pending"].includes(status)) return res.status(400).json({ error: "Invalid review moderation request." });
  try { const result = await pool.query(`UPDATE reviews SET status=$1 WHERE id=$2 RETURNING id, status`, [status, id]); if (!result.rowCount) return res.status(404).json({ error: "Review not found." }); res.json({ success: true, review: result.rows[0] }); }
  catch (error) { console.error("Admin review moderation failed:", error.message); res.status(500).json({ error: "Unable to update review status." }); }
});

/* =====================================================
   INQUIRIES / SUPPORT
===================================================== */
async function ensureInquiriesTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS idempotency_key TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inquiries_idempotency_key ON inquiries(idempotency_key) WHERE idempotency_key IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inquiries_clerk_user_id ON inquiries(clerk_user_id);`);
}

async function sendInquiryEmail({ name, email, message, inquiryId }) {
  if (!emailConfigured) return { sent: false, configured: false };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: process.env.INQUIRY_FROM_EMAIL,
      to: [process.env.INQUIRY_TO_EMAIL || process.env.INQUIRY_FROM_EMAIL],
      reply_to: email,
      subject: `ProcureIQ inquiry #${inquiryId} from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nInquiry #${inquiryId}\n\n${message}`
    })
  });
  if (!response.ok) throw new Error(`Resend email failed: ${response.status}`);
  return { sent: true, configured: true };
}

// Public contact form endpoint. It intentionally stores only contact details and the inquiry message;
// it does not expose or read financial/workspace data.
app.post("/api/public-inquiries", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  const message = String(req.body?.message || "").trim();
  const honeypot = String(req.body?.website || "").trim();
  const idempotencyKey = String(req.headers["idempotency-key"] || req.body?.submissionId || "").trim().slice(0, 100);
  if (honeypot) return res.status(400).json({ error: "Unable to submit inquiry." });

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email and inquiry are required." });
  }
  if (!emailPattern.test(email) || email.length > 180) {
    return res.status(400).json({ error: "Please enter a valid work email address." });
  }
  if (name.length > 120 || message.length > 3000) {
    return res.status(400).json({ error: "Please keep the inquiry within the allowed length." });
  }

  try {
    await ensureInquiriesTable();
    const result = await pool.query(
      `INSERT INTO inquiries (clerk_user_id, name, email, message, idempotency_key) VALUES (NULL,$1,$2,$3,$4) ON CONFLICT (idempotency_key) DO UPDATE SET email=EXCLUDED.email RETURNING id, created_at`,
      [name, email, message, idempotencyKey || null]
    );
    const delivery = await sendInquiryEmail({ name, email, message, inquiryId: result.rows[0].id });
    if (emailConfigured && !delivery.sent) return res.status(503).json({ error: "Inquiry was saved, but email delivery is not configured." });
    return res.json({ success: true, inquiry_id: result.rows[0].id, created_at: result.rows[0].created_at, email_sent: delivery.sent, message: delivery.sent ? "Inquiry sent successfully." : "Inquiry saved successfully. Email delivery is not configured yet." });
  } catch (error) {
    console.error("Public inquiry submission failed:", error.message);
    return res.status(500).json({ error: "Unable to submit inquiry right now." });
  }
});

app.post("/api/inquiries", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  const message = String(req.body?.message || "").trim();

  if (!name || !email || !message) return res.status(400).json({ error: "Name, email and inquiry are required." });
  if (!emailPattern.test(email) || email.length > 180) return res.status(400).json({ error: "Please enter a valid work email address." });
  if (name.length > 120 || message.length > 3000) return res.status(400).json({ error: "Please keep the inquiry within the allowed length." });

  try {
    await ensureInquiriesTable();
    const result = await pool.query(
      `INSERT INTO inquiries (clerk_user_id, name, email, message) VALUES ($1,$2,$3,$4) RETURNING id, created_at`,
      [userId, name, email, message]
    );
    res.json({ success: true, inquiry_id: result.rows[0].id, created_at: result.rows[0].created_at, message: "Inquiry submitted successfully." });
  } catch (error) {
    console.error("Inquiry submission failed:", error.message);
    res.status(500).json({ error: "Unable to submit inquiry right now." });
  }
});


/* =====================================================
   GET TRANSACTIONS
===================================================== */

app.get("/api/transactions", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const result = await pool.query(`
      SELECT
        id,
        material,
        supplier,
        quantity,
        price,
        transaction_date,
        created_at,
        upload_batch_id,
        source_file_name,
        uploaded_at
      FROM transactions
      WHERE clerk_user_id = $1
      ORDER BY id ASC
    `, [userId]);

    res.json(result.rows);

  } catch (error) {
    console.error(
      "❌ Fetch transactions error:",
      error.message
    );

    res.status(500).json({
      error: "Unable to fetch transactions"
    });
  }
});


/* =====================================================
   UPLOAD TRANSACTIONS
===================================================== */

app.post("/api/transactions/upload", async (req, res) => {

  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  // Upload/analysis is a quota-gated workspace processing action. The
  // database balance is authoritative; this check deliberately happens
  // before validation or transaction processing so a zero-balance account
  // cannot bypass the limit by re-uploading another file.
  const quota = await requireTokenAllowance(
    userId,
    res,
    "Your AI token allowance has been exhausted. Upgrade your plan to continue processing procurement data."
  );
  if (!quota) return;

  const transactions = req.body.transactions;

  /* ---------------------------------------------
     VALIDATE REQUEST
  --------------------------------------------- */

  if (!Array.isArray(transactions)) {
    return res.status(400).json({
      success: false,
      error: "Invalid transaction data."
    });
  }

  if (transactions.length === 0) {
    return res.status(400).json({
      success: false,
      error: "No transactions provided."
    });
  }

  if (transactions.length > 10000) {
    return res.status(413).json({
      success: false,
      error: "The upload is too large. Please upload 10,000 transactions or fewer at a time."
    });
  }


  const activePlan = await getActivePlan(userId);
  const planDefinition = PLAN_CATALOG[activePlan.plan] || PLAN_CATALOG.free;
  const existingCountResult = await pool.query(`SELECT COUNT(*)::int AS count FROM transactions WHERE clerk_user_id=$1`, [userId]);
  const existingCount = Number(existingCountResult.rows[0]?.count) || 0;
  if (planDefinition.maxTransactions && existingCount + transactions.length > planDefinition.maxTransactions) {
    return res.status(402).json({ error: `Your ${planDefinition.name} plan supports up to ${planDefinition.maxTransactions.toLocaleString("en-IN")} stored transactions. Upgrade or reset older data to continue.`, upgrade_required: true });
  }

  const uploadBatchId = crypto.randomUUID();
  const sourceFileName = String(req.body?.sourceFileName || "").trim().slice(0, 255) || null;

  let client;

  try {

    client = await pool.connect();

    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(userId)]);
    const lockedCountResult = await client.query(`SELECT COUNT(*)::int AS count FROM transactions WHERE clerk_user_id=$1`, [userId]);
    const lockedExistingCount = Number(lockedCountResult.rows[0]?.count) || 0;
    if (planDefinition.maxTransactions && lockedExistingCount + transactions.length > planDefinition.maxTransactions) {
      await client.query("ROLLBACK");
      return res.status(402).json({ error: `Your ${planDefinition.name} plan supports up to ${planDefinition.maxTransactions.toLocaleString("en-IN")} stored transactions. Upgrade or reset older data to continue.`, upgrade_required: true });
    }

    let inserted = 0;
    let duplicates = 0;
    let invalid = 0;


    /* ---------------------------------------------
       PROCESS EACH TRANSACTION
    --------------------------------------------- */

    for (const item of transactions) {

      if (!item || typeof item !== "object" || Array.isArray(item)) {
        invalid++;
        continue;
      }

      const allowedFields = new Set(["material", "supplier", "quantity", "price", "transaction_date", "date"]);
      if (Object.keys(item).some(key => !allowedFields.has(key))) {
        invalid++;
        continue;
      }

      const material = String(item.material || "").trim();
      const supplier = String(item.supplier || "").trim();
      const quantity = Number(item.quantity);
      const price = Number(item.price);
      const transactionDate = item.transaction_date || item.date || null;
      const parsedTransactionDate = transactionDate ? new Date(transactionDate) : null;
      if (transactionDate && Number.isNaN(parsedTransactionDate.getTime())) { invalid++; continue; }
      const normalizedTransactionDate = parsedTransactionDate ? parsedTransactionDate.toISOString().slice(0, 10) : null;


      /* -----------------------------------------
         VALIDATION
      ----------------------------------------- */

      if (
        !material ||
        !supplier ||
        material.length > 200 ||
        supplier.length > 200 ||
        !Number.isFinite(quantity) ||
        !Number.isFinite(price) ||
        quantity <= 0 ||
        price < 0 ||
        quantity > 1e12 ||
        price > 1e12
      ) {
        invalid++;
        continue;
      }


      /* -----------------------------------------
         DUPLICATE CHECK
      ----------------------------------------- */

      const duplicateCheck = await client.query(
        `
        SELECT id
        FROM transactions
        WHERE
          material = $1
          AND supplier = $2
          AND quantity = $3
          AND price = $4
          AND transaction_date IS NOT DISTINCT FROM $5
          AND clerk_user_id = $6
        LIMIT 1
        `,
        [
          material,
          supplier,
          quantity,
          price,
          normalizedTransactionDate,
          userId
        ]
      );


      if (duplicateCheck.rows.length > 0) {
        duplicates++;
        continue;
      }


      /* -----------------------------------------
         INSERT
      ----------------------------------------- */

      await client.query(
        `
        INSERT INTO transactions
          (
            material,
            supplier,
            quantity,
            price,
            clerk_user_id,
            transaction_date,
            upload_batch_id,
            source_file_name,
            uploaded_at
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
        `,
        [
          material,
          supplier,
          quantity,
          price,
          userId,
          normalizedTransactionDate,
          uploadBatchId,
          sourceFileName
        ]
      );

      inserted++;
    }


    await client.query("COMMIT");


    /* -----------------------------------------
       RESPONSE
    ----------------------------------------- */

    res.json({
      success: true,
      inserted,
      duplicates,
      invalid,
      total: transactions.length,
      upload_batch_id: uploadBatchId,
      source_file_name: sourceFileName,
      message:
        `${inserted} new transaction(s) added. ` +
        `${duplicates} duplicate(s) skipped.`
    });

  } catch (error) {

    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error(
          "❌ Rollback error:",
          rollbackError.message
        );
      }
    }

    console.error(
      "❌ Upload endpoint error:",
      error.message
    );

    res.status(500).json({
      success: false,
      error: "Unable to save transactions."
    });

  } finally {

    if (client) {
      client.release();
    }

  }
});




/* =====================================================
   PROCUREMENT CONTROL PACK
   Contract -> PO -> GRN -> Invoice intelligence foundation.
   The demo endpoint is deterministic and uses no external market data.
===================================================== */
function finiteNonNegative(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function insertControlPack(userId, pack) {
  const sourceFileName = String(pack?.source_file_name || pack?.sourceFileName || "").trim().slice(0,255) || null;
  const rawContracts = Array.isArray(pack?.contracts) ? pack.contracts : [];
  const rawPurchaseOrders = Array.isArray(pack?.purchase_orders) ? pack.purchase_orders : [];
  const rawReceipts = Array.isArray(pack?.goods_receipts) ? pack.goods_receipts : [];
  const rawInvoices = Array.isArray(pack?.invoices) ? pack.invoices : [];
  const maxRows = 5000;
  if ([rawContracts, rawPurchaseOrders, rawReceipts, rawInvoices].some(rows => rows.length > maxRows)) {
    throw new Error("Control-pack import is too large. Please import 5,000 records or fewer per section.");
  }

  const cleanText = (value, max = 200) => String(value ?? "").trim().slice(0, max);
  const cleanDate = value => {
    if (value === null || value === undefined || value === "") return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0,10);
  };

  const contracts = [];
  const purchaseOrders = [];
  const receipts = [];
  const invoices = [];
  const invalid = { contracts: 0, purchase_orders: 0, goods_receipts: 0, invoices: 0 };

  for (const c of rawContracts) {
    if (!c || typeof c !== "object" || Array.isArray(c)) { invalid.contracts++; continue; }
    const contractRef=cleanText(c.contract_ref), supplier=cleanText(c.supplier), material=cleanText(c.material);
    const price=finiteNonNegative(c.contracted_unit_price);
    const effectiveFrom=cleanDate(c.effective_from), effectiveTo=cleanDate(c.effective_to);
    if (!contractRef || !supplier || !material || price===null || price<=0 || (c.effective_from && !effectiveFrom) || (c.effective_to && !effectiveTo)) { invalid.contracts++; continue; }
    contracts.push({contract_ref:contractRef,supplier,material,contracted_unit_price:price,rebate_threshold:finiteNonNegative(c.rebate_threshold)||0,rebate_rate:finiteNonNegative(c.rebate_rate)||0,effective_from:effectiveFrom,effective_to:effectiveTo,source_file_name:cleanText(c.source_file_name,255)||sourceFileName});
  }
  for (const po of rawPurchaseOrders) {
    if (!po || typeof po !== "object" || Array.isArray(po)) { invalid.purchase_orders++; continue; }
    const qty=finiteNonNegative(po.quantity), price=finiteNonNegative(po.unit_price);
    const poNumber=cleanText(po.po_number), supplier=cleanText(po.supplier), material=cleanText(po.material), orderDate=cleanDate(po.order_date);
    if (!poNumber || !supplier || !material || qty===null || qty<=0 || price===null || price<0 || (po.order_date && !orderDate)) { invalid.purchase_orders++; continue; }
    purchaseOrders.push({po_number:poNumber,supplier,material,quantity:qty,unit_price:price,order_date:orderDate});
  }
  for (const gr of rawReceipts) {
    if (!gr || typeof gr !== "object" || Array.isArray(gr)) { invalid.goods_receipts++; continue; }
    const qty=finiteNonNegative(gr.received_quantity), grnNumber=cleanText(gr.grn_number), poNumber=cleanText(gr.po_number), receivedDate=cleanDate(gr.received_date);
    if (!grnNumber || !poNumber || qty===null || (gr.received_date && !receivedDate)) { invalid.goods_receipts++; continue; }
    receipts.push({grn_number:grnNumber,po_number:poNumber,received_quantity:qty,received_date:receivedDate});
  }
  for (const inv of rawInvoices) {
    if (!inv || typeof inv !== "object" || Array.isArray(inv)) { invalid.invoices++; continue; }
    const qty=finiteNonNegative(inv.quantity), price=finiteNonNegative(inv.unit_price);
    const invoiceNumber=cleanText(inv.invoice_number), poNumber=cleanText(inv.po_number), supplier=cleanText(inv.supplier), material=cleanText(inv.material), invoiceDate=cleanDate(inv.invoice_date);
    if (!invoiceNumber || !poNumber || !supplier || !material || qty===null || qty<=0 || price===null || price<0 || (inv.invoice_date && !invoiceDate)) { invalid.invoices++; continue; }
    invoices.push({invoice_number:invoiceNumber,po_number:poNumber,supplier,material,quantity:qty,unit_price:price,invoice_date:invoiceDate});
  }

  const totalRaw = rawContracts.length + rawPurchaseOrders.length + rawReceipts.length + rawInvoices.length;
  const totalValid = contracts.length + purchaseOrders.length + receipts.length + invoices.length;
  if (!totalRaw) throw new Error("The control-data file contains no records.");
  if (!totalValid) throw new Error("No valid control records were found. Check the sheet names, required fields and numeric values.");
  if (invoices.length === 0 && (purchaseOrders.length || receipts.length || contracts.length)) {
    throw new Error("No valid invoice records were found. Include an Invoices sheet because the control audit evaluates the PO → GRN → invoice chain.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM procurement_contracts WHERE clerk_user_id=$1`, [userId]);
    await client.query(`DELETE FROM purchase_orders WHERE clerk_user_id=$1`, [userId]);
    await client.query(`DELETE FROM goods_receipts WHERE clerk_user_id=$1`, [userId]);
    await client.query(`DELETE FROM supplier_invoices WHERE clerk_user_id=$1`, [userId]);

    for (const c of contracts) await client.query(`
      INSERT INTO procurement_contracts
      (clerk_user_id,contract_ref,supplier,material,contracted_unit_price,rebate_threshold,rebate_rate,effective_from,effective_to,source_file_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,[userId,c.contract_ref,c.supplier,c.material,c.contracted_unit_price,c.rebate_threshold,c.rebate_rate,c.effective_from,c.effective_to,c.source_file_name]);
    for (const po of purchaseOrders) await client.query(`
      INSERT INTO purchase_orders
      (clerk_user_id,po_number,supplier,material,quantity,unit_price,order_date)
      VALUES($1,$2,$3,$4,$5,$6,$7)
    `,[userId,po.po_number,po.supplier,po.material,po.quantity,po.unit_price,po.order_date]);
    for (const gr of receipts) await client.query(`
      INSERT INTO goods_receipts
      (clerk_user_id,grn_number,po_number,received_quantity,received_date)
      VALUES($1,$2,$3,$4,$5)
    `,[userId,gr.grn_number,gr.po_number,gr.received_quantity,gr.received_date]);
    for (const inv of invoices) await client.query(`
      INSERT INTO supplier_invoices
      (clerk_user_id,invoice_number,po_number,supplier,material,quantity,unit_price,invoice_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    `,[userId,inv.invoice_number,inv.po_number,inv.supplier,inv.material,inv.quantity,inv.unit_price,inv.invoice_date]);
    await client.query("COMMIT");
    return {counts:{contracts:contracts.length,purchase_orders:purchaseOrders.length,goods_receipts:receipts.length,invoices:invoices.length},invalid};
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

function buildControlAudit({contracts,purchaseOrders,receipts,invoices}) {
  const poByNumber=new Map(purchaseOrders.map(p=>[String(p.po_number),p]));
  const grByPo=new Map();
  for(const g of receipts) grByPo.set(String(g.po_number),(grByPo.get(String(g.po_number))||0)+Number(g.received_quantity||0));
  const contractBySupplierMaterial=new Map();
  for(const c of contracts) contractBySupplierMaterial.set(`${String(c.supplier).toLowerCase()}|${String(c.material).toLowerCase()}`,c);

  const matches=invoices.map(inv=>{
    const po=poByNumber.get(String(inv.po_number));
    const received=grByPo.get(String(inv.po_number))||0;
    const qtyVar=received>0 ? ((Number(inv.quantity)-received)/received)*100 : null;
    const priceVar=po?.unit_price>0 ? ((Number(inv.unit_price)-Number(po.unit_price))/Number(po.unit_price))*100 : null;
    const exposure=po ? Math.max(0,(Number(inv.quantity)*Number(inv.unit_price))-(received*Number(po.unit_price))) : 0;
    const contract=contractBySupplierMaterial.get(`${String(inv.supplier).toLowerCase()}|${String(inv.material).toLowerCase()}`);
    const contractLeakage=contract ? Math.max(0,(Number(inv.unit_price)-Number(contract.contracted_unit_price))*Number(inv.quantity)) : 0;
    const rebate=contract && Number(contract.rebate_threshold)>0 && received>=Number(contract.rebate_threshold)
      ? received*Number(contract.contracted_unit_price)*(Number(contract.rebate_rate||0)/100) : 0;
    const exceptions=[];
    if(!po) exceptions.push("PO not found");
    if(po && String(po.supplier||"").trim().toLowerCase()!==String(inv.supplier||"").trim().toLowerCase()) exceptions.push("PO supplier does not match invoice supplier");
    if(po && String(po.material||"").trim().toLowerCase()!==String(inv.material||"").trim().toLowerCase()) exceptions.push("PO material does not match invoice material");
    if(po && received<=0) exceptions.push("Goods receipt not found");
    if(po && qtyVar!==null && Math.abs(qtyVar)>2) exceptions.push("Quantity outside 2% tolerance");
    if(po && priceVar!==null && Math.abs(priceVar)>2) exceptions.push("Price outside 2% tolerance");
    if(contractLeakage>0) exceptions.push("Contract price leakage");
    if(rebate>0) exceptions.push("Rebate threshold reached");
    return {invoice_number:inv.invoice_number,po_number:inv.po_number,supplier:inv.supplier,material:inv.material,qty_variance_pct:qtyVar,price_variance_pct:priceVar,exposure,contract_leakage:contractLeakage,rebate_candidate:rebate,status:exceptions.length?"EXCEPTION":"MATCH",exceptions};
  });
  const supplierSpend=new Map();
  invoices.forEach(i=>supplierSpend.set(i.supplier,(supplierSpend.get(i.supplier)||0)+Number(i.quantity||0)*Number(i.unit_price||0)));
  const totalSpend=[...supplierSpend.values()].reduce((a,b)=>a+b,0);
  const topSupplier=[...supplierSpend.entries()].sort((a,b)=>b[1]-a[1])[0]||null;
  const supplierScorecards=[...supplierSpend.entries()].map(([supplier,spend])=>{
    const items=matches.filter(x=>String(x.supplier).toLowerCase()===String(supplier).toLowerCase());
    const exceptionCount=items.filter(x=>x.status==="EXCEPTION").length;
    const priceVars=items.map(x=>Number(x.price_variance_pct)).filter(Number.isFinite);
    const avgPriceVariance=priceVars.length?priceVars.reduce((a,b)=>a+b,0)/priceVars.length:0;
    const share=totalSpend>0?(spend/totalSpend)*100:0;
    return {supplier,spend,share_pct:share,invoices:items.length,exceptions:exceptionCount,exception_rate_pct:items.length?(exceptionCount/items.length)*100:0,avg_price_variance_pct:avgPriceVariance};
  }).sort((a,b)=>b.spend-a.spend);
  return {
    counts:{contracts:contracts.length,purchase_orders:purchaseOrders.length,goods_receipts:receipts.length,invoices:invoices.length,matches:matches.length,exceptions:matches.filter(x=>x.status==="EXCEPTION").length},
    totals:{
      invoice_spend:invoices.reduce((s,i)=>s+Number(i.quantity||0)*Number(i.unit_price||0),0),
      positive_exposure:matches.reduce((s,x)=>s+x.exposure,0),
      contract_leakage:matches.reduce((s,x)=>s+x.contract_leakage,0),
      rebate_candidate:matches.reduce((s,x)=>s+x.rebate_candidate,0)
    },
    supplier_concentration: topSupplier && totalSpend>0 ? {supplier:topSupplier[0],spend:topSupplier[1],share_pct:(topSupplier[1]/totalSpend)*100} : null,
    supplier_scorecards:supplierScorecards,
    matches
  };
}

app.post("/api/control-pack", async (req,res)=>{
  const userId=requireAuthenticatedUser(req,res); if(!userId)return;
  try {
    const saved = await insertControlPack(userId,req.body||{});
    res.json({success:true,message:"Procurement control pack saved.",saved});
  } catch(e) {
    console.error("Control pack save failed:",e.message);
    res.status(500).json({success:false,error:"Unable to save procurement control data."});
  }
});

app.get("/api/control-audit", async (req,res)=>{
  const userId=requireAuthenticatedUser(req,res); if(!userId)return;
  try {
    const [c,p,g,i]=await Promise.all([
      pool.query(`SELECT contract_ref,supplier,material,contracted_unit_price,rebate_threshold,rebate_rate FROM procurement_contracts WHERE clerk_user_id=$1 ORDER BY id`,[userId]),
      pool.query(`SELECT po_number,supplier,material,quantity,unit_price FROM purchase_orders WHERE clerk_user_id=$1 ORDER BY id`,[userId]),
      pool.query(`SELECT grn_number,po_number,received_quantity FROM goods_receipts WHERE clerk_user_id=$1 ORDER BY id`,[userId]),
      pool.query(`SELECT invoice_number,po_number,supplier,material,quantity,unit_price FROM supplier_invoices WHERE clerk_user_id=$1 ORDER BY id`,[userId])
    ]);
    res.json(buildControlAudit({contracts:c.rows,purchaseOrders:p.rows,receipts:g.rows,invoices:i.rows}));
  } catch(e) {
    console.error("Control audit failed:",e.message);
    res.status(500).json({error:"Unable to run procurement control audit."});
  }
});


/* =====================================================
   CONTROL ACTION WORKFLOW
   Human-approved actions only; no automatic supplier communication.
===================================================== */
app.get("/api/control-actions", async (req,res)=>{
  const userId=requireAuthenticatedUser(req,res); if(!userId)return;
  try {
    const result=await pool.query(`SELECT invoice_number,po_number,action,status,note,created_at,updated_at FROM control_actions WHERE clerk_user_id=$1 ORDER BY updated_at DESC`,[userId]);
    res.json(result.rows);
  } catch(e) {
    console.error("Control actions fetch failed:",e.message);
    res.status(500).json({error:"Unable to load control actions."});
  }
});

app.post("/api/control-actions", async (req,res)=>{
  const userId=requireAuthenticatedUser(req,res); if(!userId)return;
  const invoiceNumber=String(req.body?.invoiceNumber||"").trim().slice(0,120);
  const poNumber=String(req.body?.poNumber||"").trim().slice(0,120)||null;
  const action=String(req.body?.action||"").trim().slice(0,120);
  const status=String(req.body?.status||"OPEN").trim().toUpperCase();
  const note=String(req.body?.note||"").trim().slice(0,1000)||null;
  const allowedActions=new Set(["HOLD_FOR_REVIEW","REQUEST_CREDIT","ACCEPT_EXCEPTION","APPROVE_MATCH","ESCALATE_TO_PROCUREMENT"]);
  const allowedStatus=new Set(["OPEN","IN_REVIEW","RESOLVED"]);
  if(!invoiceNumber||!allowedActions.has(action)||!allowedStatus.has(status)) return res.status(400).json({error:"Choose a valid control action and status."});
  try {
    const result=await pool.query(`INSERT INTO control_actions (clerk_user_id,invoice_number,po_number,action,status,note) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (clerk_user_id,invoice_number) DO UPDATE SET po_number=EXCLUDED.po_number,action=EXCLUDED.action,status=EXCLUDED.status,note=EXCLUDED.note,updated_at=CURRENT_TIMESTAMP RETURNING invoice_number,po_number,action,status,note,created_at,updated_at`,[userId,invoiceNumber,poNumber,action,status,note]);
    res.json({success:true,action:result.rows[0]});
  } catch(e) {
    console.error("Control action save failed:",e.message);
    res.status(500).json({error:"Unable to save the control action."});
  }
});

app.post("/api/report-generation-access", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const quota = await requireTokenAllowance(
      userId,
      res,
      "Your token allowance is exhausted. Upgrade your plan to generate new reports."
    );
    if (!quota) return;
    return res.json({ allowed: true, tokens_remaining: quota.remaining });
  } catch (error) {
    console.error("Report generation access check failed:", error.message);
    return res.status(500).json({ error: "Unable to verify report generation access." });
  }
});

/* =====================================================
   PERSISTENT REPORT / ANALYSIS HISTORY
===================================================== */

app.get("/api/report-history", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const result = await pool.query(`
      SELECT id, source, created_at, transactions, total_spend, total_savings, opportunity_count, snapshot
      FROM report_history
      WHERE clerk_user_id=$1
      ORDER BY created_at DESC, id DESC
    `, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Report history fetch failed:", error.message);
    res.status(500).json({ error: "Unable to load saved report history." });
  }
});

app.post("/api/report-history", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  const quota = await requireTokenAllowance(
    userId,
    res,
    "Your token allowance is exhausted. Upgrade your plan to create new reports."
  );
  if (!quota) return;
  const snapshot = req.body?.snapshot;
  if (!snapshot || typeof snapshot !== "object") return res.status(400).json({ error: "Invalid report snapshot." });
  const source = String(req.body?.source || snapshot.source || "Procurement analysis").trim().slice(0, 255) || "Procurement analysis";
  const transactions = Math.max(0, Number(snapshot.transactions) || 0);
  const totalSpend = Math.max(0, Number(snapshot.totalSpend) || 0);
  const totalSavings = Math.max(0, Number(snapshot.totalSavings) || 0);
  const opportunityCount = Math.max(0, Number(snapshot.opportunityCount) || 0);
  try {
    const result = await pool.query(`
      INSERT INTO report_history (clerk_user_id, source, transactions, total_spend, total_savings, opportunity_count, snapshot)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      RETURNING id, source, created_at, transactions, total_spend, total_savings, opportunity_count, snapshot
    `, [userId, source, transactions, totalSpend, totalSavings, opportunityCount, JSON.stringify(snapshot)]);
    res.json({ success: true, report: result.rows[0] });
  } catch (error) {
    console.error("Report history save failed:", error.message);
    res.status(500).json({ error: "Unable to save report history." });
  }
});

app.delete("/api/report-history", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const reportId = Number(req.query?.id);
    const result = Number.isInteger(reportId) && reportId > 0
      ? await pool.query(`DELETE FROM report_history WHERE id=$1 AND clerk_user_id=$2`, [reportId, userId])
      : await pool.query(`DELETE FROM report_history WHERE clerk_user_id=$1`, [userId]);
    res.json({ success: true, deleted: result.rowCount || 0 });
  } catch (error) {
    console.error("Report history clear failed:", error.message);
    res.status(500).json({ error: "Unable to clear saved report history." });
  }
});

app.post("/api/account/delete", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  if (!clerkConfigured || !process.env.CLERK_SECRET_KEY) {
    return res.status(503).json({ error: "Account deletion is unavailable until Clerk is configured." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tables = [
      "transactions",
      "report_history",
      "procurement_contracts",
      "purchase_orders",
      "goods_receipts",
      "supplier_invoices",
      "control_actions",
      "opportunity_memory",
      "ai_usage",
      "reviews",
      "inquiries",
      "subscriptions",
    ];
    for (const table of tables) {
      await client.query(`DELETE FROM ${table} WHERE clerk_user_id=$1`, [userId]);
    }
    await client.query("COMMIT");

    // Clerk is the authentication-system source of truth. Its official
    // backend SDK supports deleting the authenticated user programmatically.
    await clerkClient.users.deleteUser(userId);

    res.json({ success: true, account_deleted: true });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Account deletion failed:", error.message);
    res.status(500).json({ error: "Unable to complete account deletion. No account deletion confirmation was issued." });
  } finally {
    client.release();
  }
});

app.post("/api/reset-data", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const result = await pool.query(`DELETE FROM transactions WHERE clerk_user_id=$1`, [userId]);
    await pool.query(`DELETE FROM report_history WHERE clerk_user_id=$1`, [userId]);
    await pool.query(`DELETE FROM procurement_contracts WHERE clerk_user_id=$1`, [userId]);
    await pool.query(`DELETE FROM purchase_orders WHERE clerk_user_id=$1`, [userId]);
    await pool.query(`DELETE FROM goods_receipts WHERE clerk_user_id=$1`, [userId]);
    await pool.query(`DELETE FROM supplier_invoices WHERE clerk_user_id=$1`, [userId]);
    await pool.query(`DELETE FROM control_actions WHERE clerk_user_id=$1`, [userId]);
    await pool.query(`DELETE FROM opportunity_memory WHERE clerk_user_id=$1`, [userId]);
    res.json({ success: true, deleted: result.rowCount || 0 });
  } catch (error) {
    console.error("Reset data failed:", error.message);
    res.status(500).json({ error: "Unable to reset your procurement data." });
  }
});

/* =====================================================
   OPPORTUNITY MEMORY / OUTCOME LEDGER
===================================================== */

app.get("/api/opportunity-memory", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const result = await pool.query(`SELECT transaction_id, status, decision, action, outcome_type, negotiated_saving, realized_saving, note, created_at, updated_at FROM opportunity_memory WHERE clerk_user_id=$1 ORDER BY updated_at DESC`, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Opportunity memory fetch failed:", error.message);
    res.status(500).json({ error: "Unable to load opportunity memory." });
  }
});

app.post("/api/opportunity-memory", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  const transactionId = Number(req.body?.transactionId);
  if (!Number.isInteger(transactionId) || transactionId <= 0) return res.status(400).json({ error: "Invalid transaction." });
  const allowedStatus = new Set(["detected", "investigating", "validated", "dismissed", "actioned", "outcome_recorded"]);
  const allowedDecision = new Set(["pending", "valid", "not_an_issue", "needs_context"]);
  const allowedOutcome = new Set(["negotiated", "realized", "no_saving", "monitoring"]);
  const status = String(req.body?.status || "detected").toLowerCase();
  const decision = String(req.body?.decision || "pending").toLowerCase();
  const outcomeType = String(req.body?.outcomeType || "").toLowerCase() || null;
  const action = String(req.body?.action || "").trim().slice(0, 300) || null;
  const note = String(req.body?.note || "").trim().slice(0, 1000) || null;
  const negotiatedSaving = Math.max(0, Number(req.body?.negotiatedSaving) || 0);
  const realizedSaving = Math.max(0, Number(req.body?.realizedSaving) || 0);
  if (!allowedStatus.has(status) || !allowedDecision.has(decision) || (outcomeType && !allowedOutcome.has(outcomeType))) return res.status(400).json({ error: "Invalid opportunity state." });
  try {
    const source = await pool.query(`SELECT id, material, supplier, quantity, price FROM transactions WHERE id=$1 AND clerk_user_id=$2`, [transactionId, userId]);
    if (!source.rowCount) return res.status(404).json({ error: "That procurement record is not available in this workspace." });
    const result = await pool.query(`INSERT INTO opportunity_memory (clerk_user_id, transaction_id, status, decision, action, outcome_type, negotiated_saving, realized_saving, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (clerk_user_id, transaction_id) DO UPDATE SET status=EXCLUDED.status, decision=EXCLUDED.decision, action=EXCLUDED.action, outcome_type=EXCLUDED.outcome_type, negotiated_saving=EXCLUDED.negotiated_saving, realized_saving=EXCLUDED.realized_saving, note=EXCLUDED.note, updated_at=CURRENT_TIMESTAMP RETURNING *`, [userId, transactionId, status, decision, action, outcomeType, negotiatedSaving, realizedSaving, note]);
    res.json({ success: true, memory: result.rows[0] });
  } catch (error) {
    console.error("Opportunity memory update failed:", error.message);
    res.status(500).json({ error: "Unable to save opportunity outcome." });
  }
});

app.get("/api/outcome-ledger", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const result = await pool.query(`SELECT COUNT(*)::int AS tracked, COALESCE(SUM(negotiated_saving),0)::numeric AS negotiated, COALESCE(SUM(realized_saving),0)::numeric AS realized, COUNT(*) FILTER (WHERE decision='valid')::int AS validated, COUNT(*) FILTER (WHERE decision='not_an_issue')::int AS dismissed FROM opportunity_memory WHERE clerk_user_id=$1`, [userId]);
    res.json(result.rows[0] || {});
  } catch (error) {
    console.error("Outcome ledger fetch failed:", error.message);
    res.status(500).json({ error: "Unable to load outcome ledger." });
  }
});

/* =====================================================
   GEMINI AI INSIGHT
===================================================== */

async function generateGemini(prompt) {
  if (!ai) throw new Error("Gemini API key is not configured.");
  const configured = String(process.env.GEMINI_MODEL || "").trim();
  const models = [...new Set([configured, "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"].filter(Boolean))];
  let lastError;
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({ model, contents: prompt });
      if (response?.text) return response;
      throw new Error("Gemini returned an empty response.");
    } catch (error) {
      lastError = error;
      console.error(`Gemini model ${model} failed:`, error.message);
    }
  }
  throw lastError || new Error("No Gemini model was available.");
}

function buildFallbackInsight({ material, supplier, numericPrice, numericMinPrice, numericQuantity, saving }) {
  const variance = numericMinPrice > 0 ? ((numericPrice - numericMinPrice) / numericMinPrice) * 100 : 0;
  return [
    `1. Why investigate: ${supplier} paid ${formatINRServer(numericPrice)}/unit versus a lowest observed ${formatINRServer(numericMinPrice)}/unit (${variance.toFixed(1)}% higher), indicating a transaction worth reviewing.`,
    `2. What to validate: Confirm contract or negotiated rate, material specification and quality, quantity/volume, freight, delivery terms and effective dates.`,
    `3. Recommended action: Validate the commercial and technical differences before renegotiating. The estimated opportunity is ${formatINRServer(saving)} across ${numericQuantity.toLocaleString("en-IN")} units.`
  ].join("\n");
}

function formatINRServer(value) {
  return `INR ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}


app.post("/api/insight", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const transactionId = Number(req.body?.transactionId);
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      return res.status(400).json({ error: "A valid procurement transaction is required." });
    }

    // Source of truth: the authenticated user's database record. Do not trust
    // price, quantity, supplier or benchmark values supplied by the browser.
    const source = await pool.query(`
      SELECT id, material, supplier, quantity, price, transaction_date
      FROM transactions
      WHERE id = $1 AND clerk_user_id = $2
      LIMIT 1
    `, [transactionId, userId]);
    if (!source.rowCount) return res.status(404).json({ error: "That procurement record is not available in this workspace." });

    const row = source.rows[0];
    const comparable = await pool.query(`
      SELECT price
      FROM transactions
      WHERE clerk_user_id = $1 AND material = $2 AND price > 0
      ORDER BY price ASC
    `, [userId, row.material]);
    const prices = comparable.rows.map(item => Number(item.price)).filter(Number.isFinite);
    const numericPrice = Number(row.price);
    const numericQuantity = Number(row.quantity);
    const numericMinPrice = prices.length ? Math.min(...prices) : numericPrice;
    const saving = calculatePotentialSaving(numericPrice, numericMinPrice, numericQuantity);
    const variance = calculatePriceVariance(numericPrice, numericMinPrice);

    if (!(numericPrice > 0) || !(numericQuantity > 0)) {
      return res.status(422).json({ error: "This procurement record does not contain valid positive price and quantity values." });
    }
    if (numericPrice <= numericMinPrice) {
      return res.json({
        insight: `1. Why investigate: No price exception is present for ${row.material}; this transaction is at the lowest observed price in the workspace.\n2. What to validate: Confirm the benchmark has enough comparable records and that specifications, quantity, freight and contract terms are comparable.\n3. Recommended action: No price-variance action is indicated from this dataset.`,
        fallback: true,
        usage: { tokens_used: 0 },
        notice: "ProcureIQ used the workspace transaction data directly; no external price claim was made."
      });
    }

    const prompt = `You are ProcureIQ's procurement explanation layer. Use ONLY the verified facts below. Never change or invent a number, supplier, material, quantity, benchmark, variance, or saving. A price difference is a review signal, not proof of wrongdoing. Do not make external market claims.\n\nMaterial: ${String(row.material)}\nSupplier: ${String(row.supplier)}\nPaid price: INR ${numericPrice}\nLowest observed price for this material in this workspace: INR ${numericMinPrice}\nQuantity: ${numericQuantity}\nCalculated variance: ${variance.toFixed(2)}%\nCalculated potential saving: INR ${saving.toFixed(2)}\nComparable transaction count: ${prices.length}\n\nReturn exactly three short sections, each starting with the heading below:\n1. Why investigate\n2. What to validate\n3. Recommended action\n\nUse the verified figures above when useful. Keep under 100 words.`;

    // Reserve a conservative budget before the provider request. AI only
    // explains verified evidence; financial calculations remain server-side.
    let reservation = null;
    reservation = await reserveAIQuota(userId, Math.max(384, Math.ceil((prompt.length + 900) / 3)));
    if (!reservation.ok) {
      if (reservation.reason === "workspace_cap") {
        return res.status(402).json({ error: "The free workspace capacity is currently full. Upgrade your plan to continue using AI assistance.", upgrade_required: true, free_user_cap_reached: true });
      }
      return res.status(429).json({ error: "Your account AI token allowance has been reached. Upgrade your plan to continue.", usage_limit_reached: true, upgrade_required: true });
    }

    let response;
    try {
      response = await generateGemini(prompt);
    } catch (geminiError) {
      console.warn("Gemini unavailable; using deterministic procurement insight.");
      const fallback = buildFallbackInsight({ material: row.material, supplier: row.supplier, numericPrice, numericMinPrice, numericQuantity, saving });
      await releaseAIQuota(userId, reservation.reserved).catch(() => {});
      return res.json({ insight: fallback, fallback: true, usage: { tokens_used: 0 }, notice: "AI was unavailable, so ProcureIQ returned a deterministic explanation from verified workspace evidence." });
    }

    const usageMeta = response.usageMetadata || response.usage_metadata || {};
    const inputTokens = Number(usageMeta.promptTokenCount || usageMeta.inputTokenCount || 0);
    const outputTokens = Number(usageMeta.candidatesTokenCount || usageMeta.outputTokenCount || 0);
    const fallbackTokens = Math.ceil((prompt.length + String(response.text || "").length) / 4);
    const consumedTokens = inputTokens + outputTokens || fallbackTokens;
    await finalizeAIUsage(userId, reservation.reserved, consumedTokens, "insight").catch(() => {});

    return res.json({
      insight: response.text,
      usage: { tokens_used: consumedTokens },
      source: { transaction_id: row.id, material: row.material, supplier: row.supplier, price: numericPrice, benchmark: numericMinPrice, quantity: numericQuantity, variance: Number(variance.toFixed(2)), potential_saving: Number(saving.toFixed(2)) }
    });
  } catch (error) {
    console.error("AI insight request failed:", error.message);
    // Never charge a user for an explanation that was not successfully
    // generated. If verified source data is already available, return the
    // deterministic evidence-based explanation instead of a dead-end error.
    if (typeof reservation !== "undefined" && reservation?.reserved) {
      await releaseAIQuota(userId, reservation.reserved).catch(() => {});
    }
    if (typeof row !== "undefined" && row && Number(row.price) > 0 && Number(row.quantity) > 0) {
      const fallback = buildFallbackInsight({
        material: row.material, supplier: row.supplier, numericPrice, numericMinPrice, numericQuantity, saving
      });
      return res.json({
        insight: fallback,
        fallback: true,
        usage: { tokens_used: 0 },
        notice: "AI service was unavailable, so ProcureIQ used a deterministic explanation from your verified procurement evidence. No AI tokens were charged."
      });
    }
    return res.status(500).json({ error: "AI analysis is temporarily unavailable." });
  }
});

/* =====================================================
   AI ASSISTANT
===================================================== */
app.post("/api/chat", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const question = String(req.body?.question || "").trim();
    const context = req.body?.context || {};
    if (!question || question.length > 600) return res.status(400).json({ error: "Please enter a question within 600 characters." });
    const quota = await getAIQuota(userId);
    const plan = quota.plan;
    const limit = quota.limit;
    if (quota.reached) return res.status(402).json({ error: "The 50 free workspaces are currently full. Upgrade your plan to continue using AI assistance.", upgrade_required: true, free_user_cap_reached: true });
    if (quota.used >= limit) return res.status(429).json({ error: "Your account AI allowance has been used. Upgrade your plan for a higher AI allowance.", usage_limit_reached: true, upgrade_required: true });

    const q = question.toLowerCase();
    const workspaceRows = await pool.query(`SELECT material, supplier, quantity, price, transaction_date FROM transactions WHERE clerk_user_id=$1 ORDER BY id ASC`, [userId]);
    const rows = workspaceRows.rows;
    const tx = rows.length;
    const groups = new Map();
    rows.forEach(row => {
      const material = String(row.material || "").trim();
      const price = Number(row.price) || 0;
      const quantity = Number(row.quantity) || 0;
      if (!groups.has(material)) groups.set(material, []);
      if (price > 0) groups.get(material).push({ price, quantity });
    });
    let opp = 0;
    let savings = 0;
    groups.forEach(items => {
      if (!items.length) return;
      const min = Math.min(...items.map(item => item.price));
      items.forEach(item => { if (item.price > min) { opp += 1; savings += (item.price - min) * item.quantity; } });
    });
    let answer;
    if (/price variance|variance/.test(q)) answer = "Price variance shows how much a purchase price differs from the lowest observed price for the same material. ProcureIQ uses it as a review signal, not proof of an incorrect purchase.";
    else if (/saving|savings/.test(q)) answer = `ProcureIQ estimates potential savings by applying the lowest observed price for the same material to the purchased quantity. Your current workspace has ${opp.toLocaleString("en-IN")} identified opportunit${opp === 1 ? "y" : "ies"}.`;
    else if (/how.*upload|upload.*file|upload|csv|excel|pdf/.test(q)) answer = "To upload a file: 1) Go to Analyze your spending data. 2) Click Choose CSV / Excel / PDF file and select your file. 3) Click Analyze File. ProcureIQ validates the data, then refreshes the KPIs, supplier/material analysis and opportunity queue. Supported files: CSV, XLS, XLSX and text-based PDF.";
    else if (/report|pdf report/.test(q)) answer = "Use Download PDF Report after analysis. The report includes the analysis date, source, transaction period when dates are available, KPIs, top opportunities and transaction dates.";
    else if (/token|usage|credit|limit/.test(q)) answer = `Your AI allowance is tracked per account and persists across sessions and devices. The dashboard shows your plan, tokens used and tokens remaining. This workspace currently has ${tx.toLocaleString("en-IN")} transactions.`;
    else if (/supplier|vendor/.test(q)) answer = "Compare the same material across suppliers. A higher price can be worth investigating, but verify specification, negotiated rate, quantity, freight and delivery terms first.";
    else if (/how.*procureiq|what.*procureiq|what can/.test(q)) answer = "ProcureIQ turns purchasing data into an investigation queue: it normalizes transactions, detects price differences, estimates potential savings and provides AI-assisted explanations.";
    else answer = "I can help with procurement concepts, price variance, savings opportunities, suppliers, uploads, reports and using the ProcureIQ dashboard. For a specific purchase, verify the quote, contract, specification, quantity, freight and delivery terms before taking action.";

    const prompt = `You are ProcureIQ Assistant. Improve this concise procurement answer without inventing facts. Keep under 100 words. Verified workspace facts: ${JSON.stringify({ transactions: tx, opportunities: opp, potential_savings_inr: Number(savings.toFixed(2)) })}. Question: ${question}. Base answer: ${answer}`;
    const estimatedTokens = Math.max(384, Math.ceil((prompt.length + 900) / 3));
    const reservation = await reserveAIQuota(userId, estimatedTokens);
    if (!reservation.ok) {
      if (reservation.reason === "workspace_cap") {
        return res.status(402).json({ error: "The free workspace capacity is currently full. Upgrade your plan to continue using AI assistance.", upgrade_required: true, free_user_cap_reached: true });
      }
      return res.status(429).json({ error: "Your account AI token allowance has been reached. Upgrade your plan to continue.", usage_limit_reached: true, upgrade_required: true });
    }

    // Gemini receives only server-derived facts. Browser-supplied counts are
    // never authoritative, and the reservation is reconciled after completion.
    if (ai) {
      try {
        const response = await generateGemini(prompt);
        if (response?.text) {
          const meta = response.usageMetadata || response.usage_metadata || {};
          const actual = Number(meta.promptTokenCount || 0) + Number(meta.candidatesTokenCount || 0);
          const consumed = actual || estimatedTokens;
          await finalizeAIUsage(userId, reservation.reserved, consumed, "chat").catch(() => {});
          return res.json({ answer: response.text, fallback: false, usage: { tokens_used: consumed } });
        }
      } catch (geminiError) {
        console.warn("Gemini unavailable; returning deterministic assistant answer:", geminiError.message);
      }
    }

    // A deterministic fallback does not consume provider tokens.
    await releaseAIQuota(userId, reservation.reserved).catch(() => {});
    return res.json({ answer, fallback: true, usage: { tokens_used: 0 } });
  } catch (error) {
    console.error("Chat assistant failed:", error.message);
    res.status(500).json({ error: "Unable to process your question right now." });
  }
});


/* =====================================================
   ROOT ROUTE
===================================================== */

app.get("/forgot-password", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "forgot-password.html"));
});

app.get("/sso-callback", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "sso-callback.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Real page URLs for the workspace. The frontend still behaves as a single
// authenticated application, but every destination has its own bookmarkable URL.
app.get("/workspace", (req, res) => res.redirect(302, "/workspace/overview"));

const workspacePages = ["overview", "act", "analyze", "chat", "control", "reports", "billing", "help"];
workspacePages.forEach((page) => {
  app.get(`/workspace/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "workspace", `${page}.html`));
  });
});

// Legacy routes intentionally redirect into the focused product surface instead of
// exposing retired dashboard areas. This keeps old bookmarks safe while preventing
// the product from growing back into a feature-heavy navigation model.
app.get("/workspace/guided-recovery", (req, res) => res.redirect(302, "/workspace/chat"));
app.get("/workspace/governance", (req, res) => res.redirect(302, "/workspace/control"));


/* =====================================================
   FINAL ERROR HANDLER
===================================================== */
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err?.message || "unknown error");
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: "Something went wrong while processing the request." });
});

/* =====================================================
   START SERVER
===================================================== */

async function startServer() {

  await initializeDatabase();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `🚀 ProcureIQ running on port ${PORT}`
    );
  });
}


startServer();
