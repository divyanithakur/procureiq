require("dotenv").config();

const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const { GoogleGenAI } = require("@google/genai");

const app = express();

/* =====================================================
   PORT
===================================================== */

const PORT = process.env.PORT || 3000;


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

// Serve frontend files
app.use(express.static(path.join(__dirname, ".")));


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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("✅ PostgreSQL connected successfully");
    console.log("✅ Transactions table ready");

  } catch (error) {
    console.error(
      "❌ PostgreSQL initialization failed:",
      error.message
    );
  }
}


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


/* =====================================================
   GEMINI AI INSIGHT
===================================================== */

app.post("/api/insight", async (req, res) => {

  try {

    if (!ai) {
      return res.status(500).json({
        error: "Gemini API key is not configured."
      });
    }


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


    const response =
      await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt
      });


    res.json({
      insight: response.text
    });


  } catch (error) {

    console.error(
      "❌ Gemini Error:",
      error.message
    );

    res.status(500).json({
      error: "AI analysis is temporarily unavailable."
    });
  }
});


/* =====================================================
   ROOT ROUTE
===================================================== */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
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