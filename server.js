require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = 3000;


/* =====================================================
   POSTGRESQL
===================================================== */

const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "procureiq",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432
});


/* =====================================================
   GEMINI
===================================================== */

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});


/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(express.json({ limit: "5mb" }));
app.use(express.static("."));


/* =====================================================
   DATABASE CONNECTION TEST
===================================================== */

pool.connect()
  .then(client => {

    console.log("✅ PostgreSQL connected successfully");

    client.release();

  })
  .catch(error => {

    console.error(
      "❌ PostgreSQL connection failed:",
      error.message
    );

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

  }

  catch (error) {

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
      error: "Invalid transaction data."
    });

  }


  if (transactions.length === 0) {

    return res.status(400).json({
      error: "No transactions provided."
    });

  }


  const client = await pool.connect();


  try {

    await client.query("BEGIN");


    let inserted = 0;
    let duplicates = 0;


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

        continue;

      }


      /* -----------------------------------------
         DUPLICATE CHECK

         Same material + supplier +
         quantity + price = duplicate
      ----------------------------------------- */

      const duplicateCheck =
        await client.query(
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
         INSERT NEW TRANSACTION
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


    res.json({

      success: true,

      inserted,

      duplicates,

      message:
        `${inserted} new transaction(s) added. ` +
        `${duplicates} duplicate(s) skipped.`

    });

  }


  catch (error) {

    await client.query("ROLLBACK");


    console.error(
      "❌ Upload transactions error:",
      error.message
    );


    res.status(500).json({
      error: "Unable to save transactions."
    });

  }


  finally {

    client.release();

  }

});


/* =====================================================
   GEMINI AI INSIGHT
===================================================== */

app.post("/api/insight", async (req, res) => {

  try {

    const {
      material,
      supplier,
      price,
      minPrice,
      quantity
    } = req.body;


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

      insight:
        response.text

    });

  }


  catch (error) {

    console.error(
      "❌ Gemini Error:",
      error.message
    );


    res.status(500).json({

      error:
        "AI analysis is temporarily unavailable."

    });

  }

});


/* =====================================================
   START SERVER
===================================================== */

app.listen(PORT, () => {

  console.log(
    `🚀 ProcureIQ running at http://localhost:${PORT}`
  );

});