require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const { GoogleGenAI } = require("@google/genai");

const app = express();

/* =====================================================
   SERVER CONFIGURATION
===================================================== */

const PORT = Number(process.env.PORT) || 3000;


/* =====================================================
   POSTGRESQL CONFIGURATION
===================================================== */

/*
  Render:
  Prefer DATABASE_URL if available.

  Local:
  DB_USER
  DB_HOST
  DB_NAME
  DB_PASSWORD
  DB_PORT
*/

const isProduction =
  process.env.NODE_ENV === "production";


const poolConfig =
  process.env.DATABASE_URL
    ? {
        connectionString:
          process.env.DATABASE_URL,

        ssl: isProduction
          ? {
              rejectUnauthorized: false
            }
          : false
      }
    : {
        user:
          process.env.DB_USER ||
          "postgres",

        host:
          process.env.DB_HOST ||
          "localhost",

        database:
          process.env.DB_NAME ||
          "procureiq",

        password:
          process.env.DB_PASSWORD,

        port:
          Number(process.env.DB_PORT) ||
          5432,

        ssl: isProduction
          ? {
              rejectUnauthorized: false
            }
          : false
      };


const pool = new Pool(poolConfig);


/* =====================================================
   GEMINI CONFIGURATION
===================================================== */

const geminiApiKey =
  process.env.GEMINI_API_KEY;


const ai =
  geminiApiKey
    ? new GoogleGenAI({
        apiKey: geminiApiKey
      })
    : null;


/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(
  express.json({
    limit: "5mb"
  })
);


app.use(
  express.static(".")
);


/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/health", async (req, res) => {

  try {

    await pool.query("SELECT 1");

    res.status(200).json({
      success: true,
      server: "running",
      database: "connected"
    });

  }

  catch (error) {

    console.error(
      "❌ Health check database error:",
      error.message
    );

    res.status(503).json({
      success: false,
      server: "running",
      database: "unavailable"
    });

  }

});


/* =====================================================
   DATABASE CONNECTION TEST
===================================================== */

async function testDatabaseConnection() {

  try {

    const client =
      await pool.connect();

    console.log(
      "✅ PostgreSQL connected successfully"
    );

    client.release();

  }

  catch (error) {

    console.error(
      "❌ PostgreSQL connection failed:",
      error.message
    );

  }

}


/* =====================================================
   GET TRANSACTIONS
===================================================== */

app.get(
  "/api/transactions",
  async (req, res) => {

    try {

      const result =
        await pool.query(`
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


      return res.status(200).json(
        result.rows
      );

    }

    catch (error) {

      console.error(
        "❌ Fetch transactions error:",
        error.message
      );


      return res.status(500).json({
        success: false,
        error:
          "Unable to fetch transactions.",
        details:
          isProduction
            ? undefined
            : error.message
      });

    }

  }
);


/* =====================================================
   UPLOAD TRANSACTIONS
===================================================== */

app.post(
  "/api/transactions/upload",
  async (req, res) => {

    /*
      Always make sure the endpoint
      returns JSON.
    */

    try {

      const transactions =
        req.body?.transactions;


      /* ---------------------------------------------
         VALIDATE REQUEST
      --------------------------------------------- */

      if (
        !Array.isArray(
          transactions
        )
      ) {

        return res.status(400).json({
          success: false,
          error:
            "Invalid transaction data."
        });

      }


      if (
        transactions.length === 0
      ) {

        return res.status(400).json({
          success: false,
          error:
            "No transactions provided."
        });

      }


      /* ---------------------------------------------
         LIMIT REQUEST SIZE
      --------------------------------------------- */

      if (
        transactions.length > 10000
      ) {

        return res.status(400).json({
          success: false,
          error:
            "Too many transactions. Maximum 10,000 rows per upload."
        });

      }


      const client =
        await pool.connect();


      try {

        await client.query(
          "BEGIN"
        );


        let inserted = 0;

        let duplicates = 0;

        let invalid = 0;


        /* -----------------------------------------
           PROCESS TRANSACTIONS
        ----------------------------------------- */

        for (
          const item
          of transactions
        ) {

          const material =
            String(
              item?.material || ""
            ).trim();


          const supplier =
            String(
              item?.supplier || ""
            ).trim();


          const quantity =
            Number(
              String(
                item?.quantity ?? ""
              )
              .replace(/,/g, "")
            );


          const price =
            Number(
              String(
                item?.price ?? ""
              )
              .replace(/,/g, "")
              .replace(/[₹$]/g, "")
            );


          /* ---------------------------------------
             VALIDATION
          --------------------------------------- */

          if (
            !material ||
            !supplier ||
            !Number.isFinite(
              quantity
            ) ||
            !Number.isFinite(
              price
            ) ||
            quantity <= 0 ||
            price < 0
          ) {

            invalid++;

            continue;

          }


          /* ---------------------------------------
             DUPLICATE CHECK
          --------------------------------------- */

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


          if (
            duplicateCheck.rows.length
            > 0
          ) {

            duplicates++;

            continue;

          }


          /* ---------------------------------------
             INSERT
          --------------------------------------- */

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


        /* -----------------------------------------
           COMMIT
        ----------------------------------------- */

        await client.query(
          "COMMIT"
        );


        console.log(
          `✅ Upload complete: ${inserted} inserted, ${duplicates} duplicates, ${invalid} invalid`
        );


        return res.status(200).json({

          success: true,

          inserted,

          duplicates,

          invalid,

          message:
            `${inserted} new transaction(s) added. ` +
            `${duplicates} duplicate(s) skipped.` +
            `${invalid > 0
              ? ` ${invalid} invalid row(s) ignored.`
              : ""}`

        });

      }


      catch (error) {

        try {

          await client.query(
            "ROLLBACK"
          );

        }

        catch (
          rollbackError
        ) {

          console.error(
            "❌ Rollback error:",
            rollbackError.message
          );

        }


        console.error(
          "❌ Upload transactions error:",
          error.message
        );


        return res.status(500).json({

          success: false,

          error:
            "Unable to save transactions.",

          details:
            isProduction
              ? undefined
              : error.message

        });

      }


      finally {

        client.release();

      }

    }


    catch (error) {

      /*
        Catch unexpected errors outside
        the database transaction.
      */

      console.error(
        "❌ Upload endpoint error:",
        error.message
      );


      return res.status(500).json({

        success: false,

        error:
          "Unexpected server error.",

        details:
          isProduction
            ? undefined
            : error.message

      });

    }

  }
);


/* =====================================================
   GEMINI AI INSIGHT
===================================================== */

app.post(
  "/api/insight",
  async (req, res) => {

    try {

      /* ---------------------------------------------
         CHECK GEMINI CONFIGURATION
      --------------------------------------------- */

      if (!ai) {

        return res.status(500).json({

          success: false,

          error:
            "Gemini API is not configured on the server."

        });

      }


      /* ---------------------------------------------
         GET REQUEST DATA
      --------------------------------------------- */

      const {
        material,
        supplier,
        price,
        minPrice,
        quantity
      } = req.body || {};


      /* ---------------------------------------------
         VALIDATION
      --------------------------------------------- */

      if (
        !material ||
        !supplier ||
        !Number.isFinite(
          Number(price)
        ) ||
        !Number.isFinite(
          Number(minPrice)
        ) ||
        !Number.isFinite(
          Number(quantity)
        )
      ) {

        return res.status(400).json({

          success: false,

          error:
            "Invalid procurement data."

        });

      }


      /* ---------------------------------------------
         CALCULATE SAVING
      --------------------------------------------- */

      const saving =
        (
          Number(price) -
          Number(minPrice)
        ) *
        Number(quantity);


      /* ---------------------------------------------
         GEMINI PROMPT
      --------------------------------------------- */

      const prompt = `
You are a procurement intelligence analyst.

Analyze this procurement opportunity.

Material: ${material}
Supplier: ${supplier}
Paid price: ₹${Number(price).toLocaleString("en-IN")}/unit
Best observed price: ₹${Number(minPrice).toLocaleString("en-IN")}/unit
Quantity: ${Number(quantity).toLocaleString("en-IN")}
Potential saving: ₹${saving.toLocaleString("en-IN")}

Give a concise procurement investigation with:

1. Why investigate
2. What to validate
3. Recommended action

Consider:
- product quality
- freight
- quantity
- contracts
- delivery terms
- supplier relationship
- payment terms

IMPORTANT:
Do not assume that the higher price is wrong.
The price difference may have a legitimate business reason.

Keep the response under 100 words.
`;


      /* ---------------------------------------------
         CALL GEMINI
      --------------------------------------------- */

      const response =
        await ai.models.generateContent({

          model:
            "gemini-3.6-flash",

          contents:
            prompt

        });


      const insight =
        response?.text;


      if (
        !insight ||
        !String(insight).trim()
      ) {

        throw new Error(
          "Gemini returned an empty response."
        );

      }


      /* ---------------------------------------------
         RETURN RESULT
      --------------------------------------------- */

      return res.status(200).json({

        success: true,

        insight:
          String(insight).trim()

      });

    }


    catch (error) {

      console.error(
        "❌ Gemini Error:",
        error.message
      );


      return res.status(500).json({

        success: false,

        error:
          "AI analysis is temporarily unavailable."

      });

    }

  }
);


/* =====================================================
   404 API HANDLER
===================================================== */

app.use(
  "/api",
  (req, res) => {

    return res.status(404).json({

      success: false,

      error:
        "API endpoint not found."

    });

  }
);


/* =====================================================
   GENERAL ERROR HANDLER
===================================================== */

app.use(
  (error, req, res, next) => {

    console.error(
      "❌ Server error:",
      error.message
    );


    if (
      res.headersSent
    ) {

      return next(error);

    }


    return res.status(500).json({

      success: false,

      error:
        "Internal server error."

    });

  }
);


/* =====================================================
   START SERVER
===================================================== */

app.listen(
  PORT,
  "0.0.0.0",
  async () => {

    console.log(
      `🚀 ProcureIQ running on port ${PORT}`
    );

    await testDatabaseConnection();

  }
);