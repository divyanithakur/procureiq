require("dotenv").config();

const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const { GoogleGenAI } = require("@google/genai");

const app = express();

/* =====================================================
   SERVER CONFIG
===================================================== */

const PORT = process.env.PORT || 3000;

/* =====================================================
   POSTGRESQL CONFIG
===================================================== */

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,

      // Needed for many hosted PostgreSQL providers
      ssl: {
        rejectUnauthorized: false
      }
    }
  : {
      user: process.env.DB_USER || "postgres",
      host: process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME || "procureiq",
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT) || 5432
    };

const pool = new Pool(poolConfig);

/* =====================================================
   GEMINI CONFIG
===================================================== */

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    })
  : null;

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(express.json({ limit: "5mb" }));

// Serve frontend files
app.use(express.static(path.join(__dirname)));

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      success: true,
      message: "ProcureIQ server is healthy",
      database: "connected",
      gemini: ai ? "configured" : "not configured"
    });
  } catch (error) {
    console.error("Health check database error:", error.message);

    res.status(500).json({
      success: false,
      message: "Server is running but database connection failed",
      error: error.message
    });
  }
});

/* =====================================================
   DATABASE CONNECTION TEST
===================================================== */

async function testDatabaseConnection() {
  try {
    await pool.query("SELECT 1");
    console.log("✅ PostgreSQL connected successfully");
  } catch (error) {
    console.error(
      "❌ PostgreSQL connection failed:",
      error.message
    );
  }
}

/* =====================================================
   GET TRANSACTIONS
===================================================== */

app.get("/api/transactions", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        material,
        supplier,
        quantity,
        price,
        created_at
      FROM transactions
      ORDER BY id ASC
    `);

    res.status(200).json(result.rows);

  } catch (error) {
    console.error(
      "❌ Fetch transactions error:",
      error
    );

    res.status(500).json({
      error: "Unable to fetch transactions",
      details: error.message
    });
  }
});

/* =====================================================
   UPLOAD TRANSACTIONS
===================================================== */

app.post("/api/transactions/upload", async (req, res) => {
  const transactions = req.body?.transactions;

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
    /* ---------------------------------------------
       GET DATABASE CLIENT
    --------------------------------------------- */

    client = await pool.connect();

    await client.query("BEGIN");

    let inserted = 0;
    let duplicates = 0;
    let invalid = 0;

    /* ---------------------------------------------
       PROCESS TRANSACTIONS
    --------------------------------------------- */

    for (const item of transactions) {
      const material = String(
        item.material ?? ""
      ).trim();

      const supplier = String(
        item.supplier ?? ""
      ).trim();

      const quantity = Number(
        String(item.quantity ?? "")
          .replace(/,/g, "")
      );

      const price = Number(
        String(item.price ?? "")
          .replace(/,/g, "")
          .replace(/[₹$]/g, "")
          .trim()
      );

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
        LIMIT 1
        `,
        [
          material,
          supplier,
          quantity,
          price
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
          price
        )
        VALUES
        ($1, $2, $3, $4)
        `,
        [
          material,
          supplier,
          quantity,
          price
        ]
      );

      inserted++;
    }

    await client.query("COMMIT");

    console.log(
      `✅ Upload complete: ${inserted} inserted, ${duplicates} duplicates`
    );

    return res.status(200).json({
      success: true,
      inserted,
      duplicates,
      invalid,
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
          "Rollback error:",
          rollbackError.message
        );
      }
    }

    console.error(
      "❌ Upload transactions error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: "Unable to save transactions.",
      details: error.message
    });

  } finally {

    if (client) {
      client.release();
    }
  }
});

/* =====================================================
   GEMINI AI INSIGHT
===================================================== */

app.post("/api/insight", async (req, res) => {

  if (!ai) {
    return res.status(500).json({
      error: "Gemini API key is not configured."
    });
  }

  try {

    const {
      material,
      supplier,
      price,
      minPrice,
      quantity
    } = req.body;

    if (
      !material ||
      !supplier ||
      price === undefined ||
      minPrice === undefined ||
      quantity === undefined
    ) {
      return res.status(400).json({
        error: "Incomplete procurement data."
      });
    }

    const saving =
      (Number(price) - Number(minPrice)) *
      Number(quantity);

    const prompt = `
You are a procurement intelligence analyst.

Material: ${material}
Supplier: ${supplier}
Paid price: ₹${price}/unit
Best observed price: ₹${minPrice}/unit
Quantity: ${quantity}
Potential saving: ₹${saving}

Give a concise procurement investigation:

1. Why investigate
2. What to validate
3. Recommended action

Consider:
- quality
- freight
- quantity
- contracts
- delivery terms

Do not assume the higher price is wrong.

Keep the response under 100 words.
`;

    const response =
      await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt
      });

    const insight =
      response?.text || "";

    if (!insight.trim()) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    return res.status(200).json({
      success: true,
      insight
    });

  } catch (error) {

    console.error(
      "❌ Gemini Error:",
      error
    );

    return res.status(500).json({
      error:
        "AI analysis is temporarily unavailable.",
      details: error.message
    });
  }
});

/* =====================================================
   FRONTEND FALLBACK
===================================================== */

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =====================================================
   START SERVER
===================================================== */

app.listen(PORT, async () => {

  console.log(
    `🚀 ProcureIQ running on port ${PORT}`
  );

  await testDatabaseConnection();

});