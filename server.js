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

const app = express();

/* =====================================================
   PORT
===================================================== */

const PORT = process.env.PORT || 3000;
const clerkConfigured = Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
const razorpayConfigured = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);


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

app.use(express.json({ limit: "10mb" }));

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
// package.json and — critically — a .env file placed in the project root,
// leaking database, Clerk, Razorpay and Gemini secrets. Never widen this path.
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


/* =====================================================
   RAZORPAY STANDARD WEB CHECKOUT
===================================================== */

const RAZORPAY_PLANS = {
  starter: { name: "ProcureIQ Starter", amount: 99900, currency: "INR" },
  business: { name: "ProcureIQ Business", amount: 299900, currency: "INR" },
  pro: { name: "ProcureIQ Pro", amount: 799900, currency: "INR" }
};

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
    const plan = RAZORPAY_PLANS[planKey];
    if (!plan) return res.status(400).json({ error: "Invalid plan selected." });
    const receipt = `procureiq_${planKey}_${Date.now()}`.slice(0, 40);
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Basic ${credentials}` },
      body: JSON.stringify({ amount: plan.amount, currency: plan.currency, receipt, notes: { product: "ProcureIQ", plan: planKey, clerk_user_id: userId } })
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
  const order = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, { headers: { "Authorization": `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}` } });
  const orderData = await order.json().catch(() => ({}));
  const orderOwner = String(orderData?.notes?.clerk_user_id || "");
  if (!orderOwner || orderOwner !== String(userId)) {
    return res.status(403).json({ success: false, error: "Payment order does not belong to the signed-in account." });
  }
  const planKey = String(orderData?.notes?.plan || "").toLowerCase();
  if (!RAZORPAY_PLANS[planKey]) return res.status(400).json({ success:false, error:"Payment verified but the selected plan could not be resolved." });
  await pool.query(`INSERT INTO subscriptions (clerk_user_id, plan, razorpay_payment_id, razorpay_order_id, starts_at, expires_at) VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '30 days') ON CONFLICT (razorpay_payment_id) DO NOTHING`, [userId, planKey, paymentId, orderId]);
  await pool.query(`INSERT INTO ai_usage (clerk_user_id, usage_date, plan, tokens_used, insight_requests, chat_requests) VALUES ($1,CURRENT_DATE,$2,0,0,0) ON CONFLICT (clerk_user_id,usage_date) DO UPDATE SET plan=$2, updated_at=CURRENT_TIMESTAMP`, [userId, planKey]);
  console.log(`Razorpay payment verified and ${planKey} plan activated for user ${userId}: ${paymentId}`);
  return res.json({ success: true, payment_id: paymentId, order_id: orderId, plan: planKey, expires_in_days: 30, message: "Payment verified successfully. Your plan is active for 30 days." });
});


/* =====================================================
   AI USAGE + REVIEWS
===================================================== */
const FREE_USER_CAP = 50;
const FREE_DAILY_TOKEN_POOL = 10000;
const FREE_USER_DAILY_LIMIT = Math.floor(FREE_DAILY_TOKEN_POOL / FREE_USER_CAP);
const PLAN_TOKEN_LIMITS = {
  free: FREE_USER_DAILY_LIMIT,
  starter: 50000,
  business: 200000,
  pro: 1000000
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
      starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_expiry ON subscriptions(clerk_user_id, expires_at DESC);`);
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

    res.json({
      success: true,
      message: "ProcureIQ API is running",
      database: "connected"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "API is running but database is unavailable",
      database: "disconnected"
    });
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
      error: "Unable to save transactions.",
      details:
        process.env.NODE_ENV === "production"
          ? undefined
          : error.message
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

    const {
      material,
      supplier,
      price,
      minPrice,
      quantity
    } = req.body;


    const numericPrice = Number(price);
    const numericMinPrice = Number(minPrice);
    const numericQuantity = Number(quantity);


    const saving =
      (numericPrice - numericMinPrice) *
      numericQuantity;


    const prompt = `
You are a procurement intelligence analyst.

Material: ${material}
Supplier: ${supplier}
Paid price: ₹${numericPrice}/unit
Best observed price: ₹${numericMinPrice}/unit
Quantity: ${numericQuantity}
Potential saving: ₹${saving}

Give a concise procurement investigation:

1. Why investigate
2. What to validate
3. Recommended action

Consider quality, freight, quantity,
contracts and delivery.

Do not assume the higher price is wrong.

Keep it under 100 words.
`;


    const quota = await getAIQuota(userId);
    const plan = quota.plan;
    const limit = quota.limit;
    if (quota.reached) return res.status(402).json({ error: "The 50 free workspaces are currently full. Upgrade your plan to continue using AI assistance.", upgrade_required: true, free_user_cap_reached: true });
    if (quota.used >= limit) {
      return res.status(429).json({ error: "Your AI usage limit for today has been reached.", usage_limit_reached: true });
    }

    let response;
    try {
      response = await generateGemini(prompt);
    } catch (geminiError) {
      console.warn("Using deterministic procurement insight fallback:", geminiError.message);
      const fallback = buildFallbackInsight({ material, supplier, numericPrice, numericMinPrice, numericQuantity, saving });
      return res.json({ insight: fallback, fallback: true, usage: { tokens_used: 0 }, notice: "Gemini was unavailable, so ProcureIQ returned a deterministic verification insight." });
    }


    const usageMeta = response.usageMetadata || response.usage_metadata || {};
    const inputTokens = Number(usageMeta.promptTokenCount || usageMeta.inputTokenCount || 0);
    const outputTokens = Number(usageMeta.candidatesTokenCount || usageMeta.outputTokenCount || 0);
    const fallbackTokens = Math.ceil((prompt.length + String(response.text || "").length) / 4);
    const consumedTokens = inputTokens + outputTokens || fallbackTokens;
    try { await recordAIUsage(userId, consumedTokens, "insight"); } catch (usageError) { console.warn("AI usage recording failed; returning insight anyway:", usageError.message); }

    res.json({
      insight: response.text,
      usage: { tokens_used: consumedTokens }
    });


  } catch (error) {

    console.error(
      "❌ Gemini Error:",
      error.message
    );

    res.status(500).json({
      error: "AI analysis is temporarily unavailable.",
      details: process.env.NODE_ENV === "production" ? undefined : error.message
    });
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
    const tx = Number(context.transactions) || 0;
    const opp = Number(context.opportunities) || 0;
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

    // Gemini is optional for chat. If it is reachable, enrich the deterministic answer; otherwise still return a useful answer.
    if (ai) {
      try {
        const prompt = `You are ProcureIQ Assistant. Improve this concise procurement answer without inventing facts. Keep under 100 words. Workspace: ${JSON.stringify(context)}. Question: ${question}. Base answer: ${answer}`;
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

const workspacePages = ["overview", "act", "analyze", "control", "reports", "billing", "help"];
workspacePages.forEach((page) => {
  app.get(`/workspace/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "workspace", `${page}.html`));
  });
});

// Legacy routes intentionally redirect into the focused product surface instead of
// exposing retired dashboard areas. This keeps old bookmarks safe while preventing
// the product from growing back into a feature-heavy navigation model.
app.get("/workspace/governance", (req, res) => res.redirect(302, "/workspace/control"));


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