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
const { clerkMiddleware, getAuth } = require("@clerk/express");
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
const PLAN_CATALOG = {
  free: { name: "Free", monthly: 0, maxTransactions: 1000, maxUsers: 1, aiTokens: 2000, aiRequests: 10, features: ["Overview", "Exception Resolver", "Help & Support"] },
  starter: { name: "Starter", monthly: 1499, maxTransactions: 5000, maxUsers: 1, aiTokens: 50000, aiRequests: 100, features: ["Overview", "Exception Resolver", "Reports", "PDF export"] },
  business: { name: "Business", monthly: 4999, maxTransactions: 25000, maxUsers: 5, aiTokens: 200000, aiRequests: 400, features: ["Overview", "Exception Resolver", "Contract Recovery", "Guided Buying", "Supplier Risk", "Reports", "Advanced analysis"] },
  pro: { name: "Pro", monthly: 11999, maxTransactions: 100000, maxUsers: 15, aiTokens: 500000, aiRequests: 1000, features: ["Everything in Business", "Priority support", "API-ready foundation"] },
  enterprise: { name: "Enterprise", monthly: null, maxTransactions: null, maxUsers: null, aiTokens: null, aiRequests: null, features: ["Custom limits", "Custom integrations", "Priority support"] }
};
const PLAN_PRICES = { INR: { starter: 1499, business: 4999, pro: 11999 }, USD: { starter: 18, business: 59, pro: 139 }, EUR: { starter: 16, business: 54, pro: 129 }, GBP: { starter: 14, business: 46, pro: 109 }, AED: { starter: 66, business: 217, pro: 510 }, SGD: { starter: 24, business: 79, pro: 185 } };
const COUNTRY_CURRENCY_DEFAULTS = { IN: "INR", US: "USD", GB: "GBP", AE: "AED", SG: "SGD", DE: "EUR", FR: "EUR", AU: "USD", CA: "USD" };
const SUPPORTED_CURRENCIES = Object.keys(PLAN_PRICES);
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

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    // Required for many hosted PostgreSQL providers
    ssl: {
      rejectUnauthorized: false
    }
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

app.use(express.json({ limit: "5mb" }));

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
    razorpayConfigured
  });
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
app.use(express.static(path.join(__dirname, "public")));


/* =====================================================
   DATABASE INITIALIZATION
===================================================== */

async function initializeDatabase() {
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

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transactions_clerk_user_id
      ON transactions (clerk_user_id);
    `);

    console.log("✅ PostgreSQL connected successfully");
    console.log("✅ Transactions table ready");
    await ensureInquiriesTable();
    await ensureUsageTable();
    await ensureSubscriptionsTable();
    await ensureReviewsTable();
    await ensureOpportunityMemoryTable();
    console.log("✅ Inquiries table ready");
    console.log("✅ AI usage and reviews tables ready");

  } catch (error) {
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

const RAZORPAY_PLANS = PLAN_PRICES.INR;

function requireRazorpay(res) {
  if (!razorpayConfigured) {
    res.status(503).json({ error: "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env." });
    return false;
  }
  return true;
}

app.post("/api/create-order", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId || !requireRazorpay(res)) return;
  try {
    const planKey = String(req.body?.plan || "").toLowerCase();
    const country = String(req.body?.country || "IN").toUpperCase().slice(0, 2);
    let currency = String(req.body?.currency || COUNTRY_CURRENCY_DEFAULTS[country] || "USD").toUpperCase();
    if (country === "IN") currency = "INR";
    if (!SUPPORTED_CURRENCIES.includes(currency) || !PLAN_PRICES[currency]?.[planKey]) return res.status(400).json({ error: "This plan or currency is not available for checkout." });
    const plan = getPlanDefinition(planKey, currency);
    const receipt = `procureiq_${planKey}_${Date.now()}`.slice(0, 40);
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${credentials}` },
      body: JSON.stringify({ amount: plan.amount, currency: plan.currency, receipt, notes: { product: "ProcureIQ", plan: planKey, clerk_user_id: userId, country, currency } })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status === 401 ? 401 : 500).json({ error: result?.error?.description || "Unable to create Razorpay order." });
    return res.json({ order_id: result.id, amount: result.amount, currency: result.currency, plan: planKey, plan_name: plan.name, key_id: process.env.RAZORPAY_KEY_ID });
  } catch (error) {
    console.error("Create Razorpay order failed:", error.message);
    return res.status(500).json({ error: "Unable to create payment order." });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId || !requireRazorpay(res)) return;
  const { razorpay_payment_id: paymentId, razorpay_order_id: orderId, razorpay_signature: signature } = req.body || {};
  if (!paymentId || !orderId || !signature) return res.status(400).json({ success: false, error: "Missing payment verification fields." });
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  const match = expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  if (!match) return res.status(400).json({ success: false, error: "Payment signature verification failed." });
  const razorpayAuth = {
    "Authorization": `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`
  };
  const order = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, { headers: razorpayAuth });
  const orderData = await order.json().catch(() => ({}));
  if (!order.ok || orderData?.id !== orderId) {
    return res.status(400).json({ success: false, error: "Payment order could not be verified." });
  }
  const orderOwner = String(orderData?.notes?.clerk_user_id || "");
  if (!orderOwner || orderOwner !== String(userId)) {
    return res.status(403).json({ success: false, error: "Payment order does not belong to the signed-in account." });
  }
  const planKey = String(orderData?.notes?.plan || "").toLowerCase();
  const currency = String(orderData?.notes?.currency || orderData?.currency || "INR").toUpperCase();
  const plan = getPlanDefinition(planKey, currency);
  if (!plan || Number(orderData.amount) !== Number(plan.amount) || String(orderData.currency) !== String(plan.currency)) {
    return res.status(400).json({ success:false, error:"Payment amount or plan could not be verified." });
  }
  const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: razorpayAuth });
  const paymentData = await paymentResponse.json().catch(() => ({}));
  if (!paymentResponse.ok || paymentData?.id !== paymentId || paymentData?.order_id !== orderId) {
    return res.status(400).json({ success: false, error: "Payment details could not be verified." });
  }
  if (String(paymentData.status).toLowerCase() !== "captured") {
    return res.status(400).json({ success: false, error: "Payment is not captured yet. The plan has not been activated." });
  }
  if (Number(paymentData.amount) !== Number(plan.amount) || String(paymentData.currency) !== String(plan.currency)) {
    return res.status(400).json({ success: false, error: "Captured payment amount does not match the selected plan." });
  }
  await pool.query(`INSERT INTO subscriptions (clerk_user_id, plan, razorpay_payment_id, razorpay_order_id, currency, amount, starts_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '30 days') ON CONFLICT (razorpay_payment_id) DO NOTHING`, [userId, planKey, paymentId, orderId, plan.currency, plan.amount]);
  await pool.query(`INSERT INTO ai_usage (clerk_user_id, usage_date, plan, tokens_used, insight_requests, chat_requests) VALUES ($1,CURRENT_DATE,$2,0,0,0) ON CONFLICT (clerk_user_id,usage_date) DO UPDATE SET plan=$2, updated_at=CURRENT_TIMESTAMP`, [userId, planKey]);
  console.log(`Razorpay payment verified and ${planKey} plan activated.`);
  return res.json({ success: true, payment_id: paymentId, order_id: orderId, plan: planKey, expires_in_days: 30, message: "Payment verified successfully. Your plan is active for 30 days." });
});


/* =====================================================
   AI USAGE + REVIEWS
===================================================== */
const FREE_USER_CAP = 50;
const FREE_DAILY_TOKEN_POOL = 100000;
const FREE_USER_DAILY_LIMIT = 2000;
const PLAN_TOKEN_LIMITS = {
  free: FREE_USER_DAILY_LIMIT,
  starter: 50000,
  business: 200000,
  pro: 500000
};

async function ensureUsageTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT NOT NULL,
      usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
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
      razorpay_payment_id TEXT UNIQUE NOT NULL,
      razorpay_order_id TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      amount INTEGER NOT NULL DEFAULT 0,
      starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';`);
  await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS amount INTEGER NOT NULL DEFAULT 0;`);
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
  const result = await pool.query(`SELECT plan, currency, amount, starts_at, expires_at FROM subscriptions WHERE clerk_user_id=$1 AND expires_at > CURRENT_TIMESTAMP ORDER BY expires_at DESC LIMIT 1`, [userId]);
  return result.rows[0] ? { ...result.rows[0], plan: String(result.rows[0].plan).toLowerCase() } : { plan: 'free', currency: 'INR', amount: 0, starts_at: null, expires_at: null };
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
  const activePlanResult = await pool.query(`SELECT plan FROM subscriptions WHERE clerk_user_id=$1 AND expires_at > CURRENT_TIMESTAMP ORDER BY expires_at DESC LIMIT 1`, [userId]);
  const activePlan = String(activePlanResult.rows[0]?.plan || 'free').toLowerCase();
  const result = await pool.query(`
    INSERT INTO ai_usage (clerk_user_id, usage_date, plan)
    VALUES ($1, CURRENT_DATE, $2)
    ON CONFLICT (clerk_user_id, usage_date) DO UPDATE SET plan = $2, updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `, [userId, activePlan]);
  return result.rows[0];
}

async function getFreeUserCapacity(userId) {
  const result = await pool.query(`SELECT COUNT(DISTINCT clerk_user_id)::int AS count FROM ai_usage WHERE usage_date=CURRENT_DATE AND plan='free'`);
  const activeUsers = Number(result.rows[0]?.count) || 0;
  const current = await pool.query(`SELECT 1 FROM ai_usage WHERE clerk_user_id=$1 AND usage_date=CURRENT_DATE AND plan='free' LIMIT 1`, [userId]);
  const isCurrent = current.rowCount > 0;
  return { activeUsers, cap: FREE_USER_CAP, reached: activeUsers >= FREE_USER_CAP && !isCurrent };
}

async function getAIQuota(userId) {
  const usage = await getUsageRecord(userId);
  const plan = String(usage.plan || 'free').toLowerCase();
  const limit = PLAN_TOKEN_LIMITS[plan] || PLAN_TOKEN_LIMITS.free;
  const used = Number(usage.tokens_used) || 0;
  const capacity = plan === 'free' ? await getFreeUserCapacity(userId) : { activeUsers: 0, cap: FREE_USER_CAP, reached: false };
  return { usage, plan, limit, used, remaining: Math.max(0, limit-used), ...capacity };
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
    WHERE clerk_user_id=$1 AND usage_date=CURRENT_DATE
  `, [userId, safeTokens, type]);
}

app.get("/api/usage", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const quota = await getAIQuota(userId);
    res.json({ plan: quota.plan, tokens_used: quota.used, token_limit: quota.limit, tokens_remaining: quota.remaining, insight_requests: Number(quota.usage.insight_requests)||0, chat_requests: Number(quota.usage.chat_requests)||0, free_user_cap: FREE_USER_CAP, free_users_active: quota.activeUsers, free_user_cap_reached: quota.reached, free_daily_pool: FREE_DAILY_TOKEN_POOL });
  } catch (error) {
    console.error("Usage endpoint failed:", error.message);
    res.status(500).json({ error: "Unable to load AI usage." });
  }
});

app.get("/api/entitlements", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const active = await getActivePlan(userId);
    const catalog = PLAN_CATALOG[active.plan] || PLAN_CATALOG.free;
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM transactions WHERE clerk_user_id=$1`, [userId]);
    res.json({ plan: active.plan, plan_name: catalog.name, features: catalog.features, max_transactions: catalog.maxTransactions, max_users: catalog.maxUsers, ai_tokens_daily: catalog.aiTokens, ai_requests_daily: catalog.aiRequests, stored_transactions: Number(count.rows[0]?.count)||0, currency: active.currency, amount: Number(active.amount)||0, expires_at: active.expires_at, supported_currencies: SUPPORTED_CURRENCIES, country_currency_defaults: COUNTRY_CURRENCY_DEFAULTS, prices: PLAN_PRICES });
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_inquiries_clerk_user_id ON inquiries(clerk_user_id);`);
}

// Public contact form endpoint. It intentionally stores only contact details and the inquiry message;
// it does not expose or read financial/workspace data.
app.post("/api/public-inquiries", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  const message = String(req.body?.message || "").trim();

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email and inquiry are required." });
  }
  if (name.length > 120 || email.length > 180 || message.length > 3000) {
    return res.status(400).json({ error: "Please keep the inquiry within the allowed length." });
  }

  try {
    await ensureInquiriesTable();
    const result = await pool.query(
      `INSERT INTO inquiries (clerk_user_id, name, email, message) VALUES (NULL,$1,$2,$3) RETURNING id, created_at`,
      [name, email, message]
    );
    return res.json({ success: true, inquiry_id: result.rows[0].id, created_at: result.rows[0].created_at, message: "Inquiry submitted successfully." });
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
  if (name.length > 120 || email.length > 180 || message.length > 3000) return res.status(400).json({ error: "Please keep the inquiry within the allowed length." });

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
   HEALTH CHECK
===================================================== */

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ success: true, message: "ProcureIQ API is running" });
  } catch (error) {
    console.error("Health check database failure:", error.message);
    res.status(503).json({ success: false, message: "ProcureIQ API is temporarily unavailable" });
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
        created_at
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

  let client;

  try {

    client = await pool.connect();

    await client.query("BEGIN");

    let inserted = 0;
    let duplicates = 0;
    let invalid = 0;


    /* ---------------------------------------------
       PROCESS EACH TRANSACTION
    --------------------------------------------- */

    for (const item of transactions) {

      const material =
        String(item.material || "").trim();

      const supplier =
        String(item.supplier || "").trim();

      const quantity =
        Number(item.quantity);

      const price =
        Number(item.price);
      const transactionDate = item.transaction_date || item.date || null;


      /* -----------------------------------------
         VALIDATION
      ----------------------------------------- */

      if (
        !material ||
        !supplier ||
        !Number.isFinite(quantity) ||
        !Number.isFinite(price) ||
        quantity <= 0 ||
        price < 0
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
          AND clerk_user_id = $5
        LIMIT 1
        `,
        [
          material,
          supplier,
          quantity,
          price,
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
            transaction_date
          )
        VALUES
          ($1, $2, $3, $4, $5, $6)
        `,
        [
          material,
          supplier,
          quantity,
          price,
          userId,
          transactionDate ? transactionDate : null
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



app.post("/api/reset-data", async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  try {
    const result = await pool.query(`DELETE FROM transactions WHERE clerk_user_id=$1`, [userId]);
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

    const quota = await getAIQuota(userId);
    if (quota.reached) return res.status(402).json({ error: "The 50 free workspaces are currently full. Upgrade your plan to continue using AI assistance.", upgrade_required: true, free_user_cap_reached: true });
    if (quota.used >= quota.limit) return res.status(429).json({ error: "Your AI usage limit for today has been reached.", usage_limit_reached: true });

    let response;
    try {
      response = await generateGemini(prompt);
    } catch (geminiError) {
      console.warn("Gemini unavailable; using deterministic procurement insight.");
      const fallback = buildFallbackInsight({ material: row.material, supplier: row.supplier, numericPrice, numericMinPrice, numericQuantity, saving });
      await recordAIUsage(userId, 0, "insight").catch(() => {});
      return res.json({ insight: fallback, fallback: true, usage: { tokens_used: 0 }, notice: "Gemini was unavailable, so ProcureIQ returned a deterministic insight from verified workspace data." });
    }

    const usageMeta = response.usageMetadata || response.usage_metadata || {};
    const inputTokens = Number(usageMeta.promptTokenCount || usageMeta.inputTokenCount || 0);
    const outputTokens = Number(usageMeta.candidatesTokenCount || usageMeta.outputTokenCount || 0);
    const fallbackTokens = Math.ceil((prompt.length + String(response.text || "").length) / 4);
    const consumedTokens = inputTokens + outputTokens || fallbackTokens;
    await recordAIUsage(userId, consumedTokens, "insight").catch(() => {});

    return res.json({
      insight: response.text,
      usage: { tokens_used: consumedTokens },
      source: { transaction_id: row.id, material: row.material, supplier: row.supplier, price: numericPrice, benchmark: numericMinPrice, quantity: numericQuantity, variance: Number(variance.toFixed(2)), potential_saving: Number(saving.toFixed(2)) }
    });
  } catch (error) {
    console.error("AI insight request failed:", error.message);
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
    if (quota.used >= limit) return res.status(429).json({ error: "Your free AI allowance for today has been used. Upgrade your plan for a higher AI allowance.", usage_limit_reached: true, upgrade_required: true });

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
    else if (/token|usage|credit|limit/.test(q)) answer = `Your AI allowance is tracked per day. The dashboard shows your plan, tokens used and tokens remaining. This workspace currently has ${tx.toLocaleString("en-IN")} transactions.`;
    else if (/supplier|vendor/.test(q)) answer = "Compare the same material across suppliers. A higher price can be worth investigating, but verify specification, negotiated rate, quantity, freight and delivery terms first.";
    else if (/how.*procureiq|what.*procureiq|what can/.test(q)) answer = "ProcureIQ turns purchasing data into an investigation queue: it normalizes transactions, detects price differences, estimates potential savings and provides AI-assisted explanations.";
    else answer = "I can help with procurement concepts, price variance, savings opportunities, suppliers, uploads, reports and using the ProcureIQ dashboard. For a specific purchase, verify the quote, contract, specification, quantity, freight and delivery terms before taking action.";

    const estimatedTokens = Math.max(1, Math.ceil((question.length + answer.length) / 4));
    try { await recordAIUsage(userId, estimatedTokens, "chat"); } catch (usageError) { console.warn("Chat usage recording failed:", usageError.message); }

    // Gemini is optional for chat. It receives only the server-derived facts needed
    // for the answer; browser-supplied counts are never treated as authoritative.
    if (ai) {
      try {
        const prompt = `You are ProcureIQ Assistant. Improve this concise procurement answer without inventing facts. Keep under 100 words. Verified workspace facts: ${JSON.stringify({ transactions: tx, opportunities: opp, potential_savings_inr: Number(savings.toFixed(2)) })}. Question: ${question}. Base answer: ${answer}`;
        const response = await generateGemini(prompt);
        if (response?.text) {
          const meta = response.usageMetadata || response.usage_metadata || {};
          const actual = Number(meta.promptTokenCount || 0) + Number(meta.candidatesTokenCount || 0);
          if (actual > 0) { try { await recordAIUsage(userId, actual - estimatedTokens, "chat"); } catch (_) {} }
          return res.json({ answer: response.text, fallback: false, usage: { tokens_used: actual || estimatedTokens } });
        }
      } catch (geminiError) {
        console.warn("Gemini unavailable; returning deterministic assistant answer:", geminiError.message);
      }
    }
    return res.json({ answer, fallback: true, usage: { tokens_used: estimatedTokens } });
  } catch (error) {
    console.error("Chat assistant failed:", error.message);
    res.status(500).json({ error: "Unable to process your question right now." });
  }
});

/* =====================================================
   ROOT ROUTE
===================================================== */

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