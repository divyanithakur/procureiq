/* =====================================================
   PROCUREIQ FRONTEND
   CSV + XLSX + XLS
===================================================== */


/* =====================================================
   DOM ELEMENTS
===================================================== */

const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("csvFile");
const status = document.getElementById("uploadStatus");

const totalSpendElement = document.getElementById("totalSpend");
const transactionsElement = document.getElementById("transactions");
const opportunitiesElement = document.getElementById("opportunities");
const savingsElement = document.getElementById("savings");


/* =====================================================
   GLOBAL STATE
===================================================== */

let data = [];

let activeSupplier = "ALL";
let activeMaterial = "ALL";
let activePriority = "ALL";

window.procurementOpportunities = [];


/* =====================================================
   UTILITY FUNCTIONS
===================================================== */

function formatCurrency(value) {
  const number = Number(value) || 0;

  return `₹${number.toLocaleString("en-IN", {
    maximumFractionDigits: 2
  })}`;
}


function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function cleanNumber(value) {
  if (value === null || value === undefined) {
    return NaN;
  }

  return Number(
    String(value)
      .replace(/,/g, "")
      .replace(/[₹$€£]/g, "")
      .trim()
  );
}


function normalizeHeader(header) {
  return String(header ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[_-]+/g, " ");
}


function findColumn(row, possibleNames) {
  const keys = Object.keys(row);

  for (const name of possibleNames) {
    const normalizedTarget = normalizeHeader(name);

    const found = keys.find(
      key => normalizeHeader(key) === normalizedTarget
    );

    if (found !== undefined) {
      return row[found];
    }
  }

  return "";
}


/* =====================================================
   SHOW ERROR
===================================================== */

function showError(message) {

  console.error(message);

  if (status) {
    status.textContent = `❌ ${message}`;
  }
}


/* =====================================================
   FILE UPLOAD BUTTON
===================================================== */

if (uploadBtn) {

  uploadBtn.addEventListener("click", handleFileUpload);

}


/* =====================================================
   MAIN FILE UPLOAD FUNCTION
===================================================== */

async function handleFileUpload() {

  if (!fileInput) {
    showError("File input was not found.");
    return;
  }


  const file = fileInput.files[0];


  if (!file) {

    showError(
      "Please select a CSV or Excel file first."
    );

    return;
  }


  const extension =
    file.name
      .split(".")
      .pop()
      .toLowerCase();


  /* ---------------------------------------------
     SUPPORTED FILE TYPES
  --------------------------------------------- */

  if (!["csv", "xlsx", "xls"].includes(extension)) {

    showError(
      "Unsupported file format. Please upload CSV, XLSX or XLS."
    );

    return;
  }


  try {

    if (uploadBtn) {

      uploadBtn.disabled = true;
      uploadBtn.textContent = "Analyzing...";

    }


    if (status) {

      status.textContent =
        `Reading ${file.name}...`;

    }


    let transactions = [];


    /* =================================================
       CSV
    ================================================= */

    if (extension === "csv") {

      const text = await file.text();

      transactions = parseCSVFile(text);

    }


    /* =================================================
       XLS / XLSX
    ================================================= */

    else {

      if (typeof XLSX === "undefined") {

        throw new Error(
          "Excel library failed to load. Please refresh the page."
        );

      }


      const arrayBuffer =
        await file.arrayBuffer();


      const workbook =
        XLSX.read(arrayBuffer, {
          type: "array"
        });


      if (
        !workbook.SheetNames ||
        workbook.SheetNames.length === 0
      ) {

        throw new Error(
          "The Excel file contains no worksheets."
        );

      }


      const firstSheet =
        workbook.Sheets[
          workbook.SheetNames[0]
        ];


      const rows =
        XLSX.utils.sheet_to_json(
          firstSheet,
          {
            defval: ""
          }
        );


      if (!rows.length) {

        throw new Error(
          "The Excel worksheet is empty."
        );

      }


      transactions =
        convertExcelRows(rows);

    }


    /* =================================================
       VALIDATE DATA
    ================================================= */

    const validation =
      validateTransactions(transactions);


    if (validation.valid.length === 0) {

      throw new Error(
        "No valid transactions found. Required columns: material, supplier, quantity and price."
      );

    }


    const validTransactions =
      validation.valid;


    const invalidCount =
      validation.invalid;


    if (status) {

      status.textContent =
        `Found ${validTransactions.length} valid transaction(s). Uploading to database...`;

    }


    /* =================================================
       SEND TO BACKEND
    ================================================= */

    const response =
      await fetch(
        "/api/transactions/upload",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },

          body: JSON.stringify({
            transactions: validTransactions
          })
        }
      );


    /* =================================================
       READ SERVER RESPONSE
    ================================================= */

    const responseText =
      await response.text();


    let result;


    try {

      result =
        JSON.parse(responseText);

    }

    catch (jsonError) {

      console.error(
        "Invalid server response:",
        responseText
      );

      throw new Error(
        `Server returned an invalid response (${response.status}).`
      );

    }


    /* =================================================
       SERVER ERROR
    ================================================= */

    if (!response.ok) {

      throw new Error(
        result.error ||
        result.message ||
        `Upload failed with status ${response.status}.`
      );

    }


    /* =================================================
       SUCCESS
    ================================================= */

    const inserted =
      Number(result.inserted) || 0;

    const duplicates =
      Number(result.duplicates) || 0;


    if (status) {

      status.textContent =
        `✅ ${inserted} new transaction(s) added. ` +
        `${duplicates} duplicate(s) skipped.` +
        (
          invalidCount > 0
            ? ` ${invalidCount} invalid row(s) ignored.`
            : ""
        );

    }


    /* =================================================
       LOAD UPDATED DATABASE
    ================================================= */

    await loadDatabaseData();


    /* =================================================
       RESET FILE INPUT
    ================================================= */

    fileInput.value = "";


  }

  catch (error) {

    console.error(
      "❌ File upload error:",
      error
    );


    showError(
      error.message ||
      "Unable to process the uploaded file."
    );

  }

  finally {

    if (uploadBtn) {

      uploadBtn.disabled = false;
      uploadBtn.textContent = "Analyze File";

    }

  }

}


/* =====================================================
   CONVERT EXCEL ROWS
===================================================== */

function convertExcelRows(rows) {

  return rows.map(row => {

    return {

      material: findColumn(
        row,
        [
          "material",
          "material name",
          "material_name"
        ]
      ),

      supplier: findColumn(
        row,
        [
          "supplier",
          "supplier name",
          "supplier_name"
        ]
      ),

      quantity: findColumn(
        row,
        [
          "quantity",
          "qty"
        ]
      ),

      price: findColumn(
        row,
        [
          "price",
          "unit price",
          "unit_price"
        ]
      )

    };

  });

}


/* =====================================================
   VALIDATE TRANSACTIONS
===================================================== */

function validateTransactions(transactions) {

  const valid = [];

  let invalid = 0;


  if (!Array.isArray(transactions)) {

    return {
      valid: [],
      invalid: 0
    };

  }


  transactions.forEach(item => {

    const material =
      String(item.material || "").trim();


    const supplier =
      String(item.supplier || "").trim();


    const quantity =
      cleanNumber(item.quantity);


    const price =
      cleanNumber(item.price);


    if (

      !material ||

      !supplier ||

      !Number.isFinite(quantity) ||

      !Number.isFinite(price) ||

      quantity <= 0 ||

      price < 0

    ) {

      invalid++;

      return;

    }


    valid.push({

      material,

      supplier,

      quantity,

      price

    });

  });


  return {
    valid,
    invalid
  };

}


/* =====================================================
   CSV PARSER
===================================================== */

function parseCSVFile(text) {

  const rows = [];

  let row = [];

  let value = "";

  let insideQuotes = false;


  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    const char =
      text[i];

    const nextChar =
      text[i + 1];


    /* ---------------------------------------------
       QUOTES
    --------------------------------------------- */

    if (char === '"') {

      if (
        insideQuotes &&
        nextChar === '"'
      ) {

        value += '"';

        i++;

      }

      else {

        insideQuotes =
          !insideQuotes;

      }

      continue;

    }


    /* ---------------------------------------------
       COMMA
    --------------------------------------------- */

    if (
      char === "," &&
      !insideQuotes
    ) {

      row.push(
        value.trim()
      );

      value = "";

      continue;

    }


    /* ---------------------------------------------
       NEW LINE
    --------------------------------------------- */

    if (

      (
        char === "\n" ||
        char === "\r"
      ) &&

      !insideQuotes

    ) {

      if (
        char === "\r" &&
        nextChar === "\n"
      ) {

        i++;

      }


      row.push(
        value.trim()
      );


      value = "";


      if (
        row.some(
          cell =>
            String(cell).trim() !== ""
        )
      ) {

        rows.push(row);

      }


      row = [];

      continue;

    }


    value += char;

  }


  /* ---------------------------------------------
     LAST ROW
  --------------------------------------------- */

  if (
    value !== "" ||
    row.length
  ) {

    row.push(
      value.trim()
    );

  }


  if (
    row.some(
      cell =>
        String(cell).trim() !== ""
    )
  ) {

    rows.push(row);

  }


  if (rows.length < 2) {

    return [];

  }


  /* ---------------------------------------------
     HEADERS
  --------------------------------------------- */

  const headers =
    rows[0].map(
      header =>
        normalizeHeader(header)
          .replace(/ /g, "_")
    );


  /* ---------------------------------------------
     CREATE OBJECTS
  --------------------------------------------- */

  return rows
    .slice(1)
    .map(values => {

      const object = {};


      headers.forEach(
        (header, index) => {

          object[header] =
            values[index] ?? "";

        }
      );


      return {

        material:
          object.material ||
          object.material_name ||
          "",

        supplier:
          object.supplier ||
          object.supplier_name ||
          "",

        quantity:
          object.quantity ||
          object.qty ||
          "",

        price:
          object.price ||
          object.unit_price ||
          ""

      };

    });

}


/* =====================================================
   LOAD DATA FROM POSTGRESQL
===================================================== */

async function loadDatabaseData() {

  try {

    if (status) {

      status.textContent =
        "Loading procurement data from PostgreSQL...";

    }


    const response =
      await fetch(
        "/api/transactions",
        {
          method: "GET",

          headers: {
            "Accept": "application/json"
          }
        }
      );


    if (!response.ok) {

      throw new Error(
        `Server returned ${response.status}`
      );

    }


    const result =
      await response.json();


    data =
      Array.isArray(result)
        ? result
        : [];


    analyzeData();


    if (status) {

      status.textContent =
        `Loaded ${data.length} transaction(s) from PostgreSQL.`;

    }

  }

  catch (error) {

    console.error(
      "PostgreSQL Error:",
      error
    );


    if (status) {

      status.textContent =
        `Unable to load procurement data: ${error.message}`;

    }

  }

}


/* =====================================================
   ANALYZE DATA
===================================================== */

function analyzeData() {

  if (!data.length) {

    if (totalSpendElement)
      totalSpendElement.textContent = "₹0";

    if (transactionsElement)
      transactionsElement.textContent = "0";

    if (opportunitiesElement)
      opportunitiesElement.textContent = "0";

    if (savingsElement)
      savingsElement.textContent = "₹0";


    window.procurementOpportunities = [];


    showOpportunities({});

    showSupplierAnalysis();

    showMaterialAnalysis();

    showSupplierChart();

    showMaterialChart();

    return;

  }


  /* =================================================
     TOTAL SPEND
  ================================================= */

  const totalSpend =
    data.reduce(
      (sum, item) => {

        const quantity =
          cleanNumber(item.quantity) || 0;

        const price =
          cleanNumber(item.price) || 0;


        return sum +
          quantity * price;

      },
      0
    );


  /* =================================================
     GROUP BY MATERIAL
  ================================================= */

  const groups = {};


  data.forEach(item => {

    const material =
      String(
        item.material ||
        "Unknown Material"
      ).trim();


    const supplier =
      String(
        item.supplier ||
        "Unknown Supplier"
      ).trim();


    const price =
      cleanNumber(item.price) || 0;


    const quantity =
      cleanNumber(item.quantity) || 0;


    if (!groups[material]) {

      groups[material] = [];

    }


    groups[material].push({

      material,

      supplier,

      price,

      quantity

    });

  });


  /* =================================================
     CALCULATE OPPORTUNITIES
  ================================================= */

  let opportunityCount = 0;

  let totalSavings = 0;


  Object.values(groups).forEach(
    items => {

      if (!items.length) return;


      const minPrice =
        Math.min(
          ...items.map(
            item => item.price
          )
        );


      items.forEach(item => {

        if (
          item.price >
          minPrice
        ) {

          opportunityCount++;


          totalSavings +=
            (
              item.price -
              minPrice
            ) *
            item.quantity;

        }

      });

    }
  );


  /* =================================================
     UPDATE KPI
  ================================================= */

  if (totalSpendElement) {

    totalSpendElement.textContent =
      formatCurrency(totalSpend);

  }


  if (transactionsElement) {

    transactionsElement.textContent =
      data.length.toLocaleString("en-IN");

  }


  if (opportunitiesElement) {

    opportunitiesElement.textContent =
      opportunityCount.toLocaleString("en-IN");

  }


  if (savingsElement) {

    savingsElement.textContent =
      formatCurrency(totalSavings);

  }


  /* =================================================
     OTHER SECTIONS
  ================================================= */

  showOpportunities(groups);

  showSupplierAnalysis();

  showMaterialAnalysis();

  showSupplierChart();

  showMaterialChart();

}


/* =====================================================
   CREATE OPPORTUNITIES
===================================================== */

function showOpportunities(groups) {

  const opportunities = [];


  Object.entries(groups).forEach(
    ([material, items]) => {

      if (!items.length) return;


      const minPrice =
        Math.min(
          ...items.map(
            item => item.price
          )
        );


      items.forEach(item => {

        if (
          item.price <=
          minPrice
        ) {

          return;

        }


        const saving =
          (
            item.price -
            minPrice
          ) *
          item.quantity;


        const variance =
          minPrice > 0

            ? (
                (
                  item.price -
                  minPrice
                ) /
                minPrice
              ) * 100

            : 0;


        let priority;


        if (variance >= 20) {

          priority = "HIGH";

        }

        else if (variance >= 10) {

          priority = "MEDIUM";

        }

        else {

          priority = "LOW";

        }


        opportunities.push({

          material,

          supplier:
            item.supplier,

          price:
            item.price,

          minPrice,

          quantity:
            item.quantity,

          saving,

          variance,

          priority

        });

      });

    }
  );


  opportunities.sort(
    (a, b) =>
      b.saving -
      a.saving
  );


  window.procurementOpportunities =
    opportunities;


  populateFilters(
    opportunities
  );


  renderFilteredOpportunities();

}


/* =====================================================
   RENDER OPPORTUNITIES
===================================================== */

function renderFilteredOpportunities() {

  const list =
    document.getElementById(
      "opportunityList"
    );


  if (!list) return;


  const all =
    window.procurementOpportunities ||
    [];


  const filtered =
    all.filter(item => {

      const supplierMatch =
        activeSupplier === "ALL" ||
        item.supplier ===
          activeSupplier;


      const materialMatch =
        activeMaterial === "ALL" ||
        item.material ===
          activeMaterial;


      const priorityMatch =
        activePriority === "ALL" ||
        item.priority ===
          activePriority;


      return (
        supplierMatch &&
        materialMatch &&
        priorityMatch
      );

    });


  list.innerHTML = "";


  if (!filtered.length) {

    list.innerHTML = `

      <div class="opportunity">

        <div>

          <h3>
            ${
              all.length
                ? "No matching opportunities"
                : "No procurement opportunities found"
            }
          </h3>

          <p>
            ${
              all.length
                ? "Try changing or clearing the selected filters."
                : "All suppliers are currently purchasing at the lowest observed prices."
            }
          </p>

        </div>

      </div>

    `;

    return;

  }


  filtered.forEach(
    (item, index) => {

      const id =
        `ai-${Date.now()}-${index}`;


      list.innerHTML += `

        <div class="opportunity">

          <div>

            <h3>
              ${escapeHTML(item.material)}
              — Price Variance
            </h3>


            <span
              class="priority ${item.priority.toLowerCase()}"
            >
              ${item.priority}
            </span>


            <p>

              <strong>
                ${escapeHTML(item.supplier)}
              </strong>

              paid

              ${formatCurrency(item.price)}/unit.

              Lowest observed price is

              ${formatCurrency(item.minPrice)}/unit.

            </p>


            <p>

              Price variance:

              <strong>
                ${item.variance.toFixed(1)}%
              </strong>

              · Quantity:

              <strong>
                ${Number(
                  item.quantity
                ).toLocaleString("en-IN")}
              </strong>

            </p>


            <button
              type="button"
              class="ai-button"
              data-material="${escapeHTML(item.material)}"
              data-supplier="${escapeHTML(item.supplier)}"
              data-price="${item.price}"
              data-min-price="${item.minPrice}"
              data-quantity="${item.quantity}"
              data-target="${id}"
            >
              🤖 Get AI Insight
            </button>


            <div
              id="${id}"
              class="ai-insight"
            ></div>

          </div>


          <strong>
            ${formatCurrency(item.saving)}
          </strong>

        </div>

      `;

    }
  );

}


/* =====================================================
   AI BUTTON EVENT
===================================================== */

document.addEventListener(
  "click",
  event => {

    const button =
      event.target.closest(
        ".ai-button"
      );


    if (!button) return;


    getAIInsight(

      button.dataset.material,

      button.dataset.supplier,

      Number(
        button.dataset.price
      ),

      Number(
        button.dataset.minPrice
      ),

      Number(
        button.dataset.quantity
      ),

      button.dataset.target,

      button

    );

  }
);


/* =====================================================
   AI INSIGHT
===================================================== */

async function getAIInsight(
  material,
  supplier,
  price,
  minPrice,
  quantity,
  id,
  button
) {

  const box =
    document.getElementById(id);


  if (!box) return;


  if (
    !material ||
    !supplier ||
    !Number.isFinite(price) ||
    !Number.isFinite(minPrice) ||
    !Number.isFinite(quantity)
  ) {

    box.className =
      "ai-insight error";


    box.innerHTML = `

      <div class="ai-insight-header">
        ⚠️ Invalid procurement data
      </div>

      <p>
        Unable to analyze this opportunity because
        some procurement values are missing or invalid.
      </p>

    `;

    return;

  }


  if (button) {

    button.disabled = true;

    button.textContent =
      "🤖 Analyzing...";

  }


  box.className =
    "ai-insight loading";


  box.innerHTML = `

    <div class="ai-insight-header">
      🤖 AI Procurement Insight
    </div>

    <p class="ai-loading">
      Gemini is analyzing this procurement opportunity...
    </p>

  `;


  try {

    const response =
      await fetch(
        "/api/insight",
        {

          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },

          body: JSON.stringify({

            material,

            supplier,

            price,

            minPrice,

            quantity

          })

        }
      );


    const responseText =
      await response.text();


    let result;


    try {

      result =
        JSON.parse(
          responseText
        );

    }

    catch {

      throw new Error(
        `Server returned invalid JSON (${response.status}).`
      );

    }


    if (!response.ok) {

      throw new Error(
        result.error ||
        result.message ||
        `AI request failed with status ${response.status}.`
      );

    }


    if (
      !result.insight ||
      typeof result.insight !== "string"
    ) {

      throw new Error(
        "AI returned an empty response."
      );

    }


    box.className =
      "ai-insight";


    box.innerHTML = `

      <div class="ai-insight-header">
        🤖 AI Procurement Insight
      </div>

      <div class="ai-insight-content">
        ${formatAIResponse(result.insight)}
      </div>

    `;

  }

  catch (error) {

    console.error(
      "AI Error:",
      error
    );


    box.className =
      "ai-insight error";


    box.innerHTML = `

      <div class="ai-insight-header">
        ⚠️ AI Insight Unavailable
      </div>

      <p>
        ${escapeHTML(
          error.message ||
          "Unable to generate AI insight."
        )}
      </p>

      <button
        type="button"
        class="retry-ai"
        data-material="${escapeHTML(material)}"
        data-supplier="${escapeHTML(supplier)}"
        data-price="${price}"
        data-min-price="${minPrice}"
        data-quantity="${quantity}"
        data-target="${escapeHTML(id)}"
      >
        🔄 Try Again
      </button>

    `;

  }

  finally {

    if (button) {

      button.disabled = false;

      button.textContent =
        "🤖 Get AI Insight";

    }

  }

}


/* =====================================================
   RETRY AI
===================================================== */

document.addEventListener(
  "click",
  event => {

    const button =
      event.target.closest(
        ".retry-ai"
      );


    if (!button) return;


    getAIInsight(

      button.dataset.material,

      button.dataset.supplier,

      Number(
        button.dataset.price
      ),

      Number(
        button.dataset.minPrice
      ),

      Number(
        button.dataset.quantity
      ),

      button.dataset.target,

      null

    );

  }
);


/* =====================================================
   FORMAT AI RESPONSE
===================================================== */

function formatAIResponse(text) {

  if (!text) {
    return "";
  }


  let html =
    escapeHTML(text);


  html =
    html.replace(
      /\*\*(\d+\.\s*[^*]+)\*\*/g,
      "<h4>$1</h4>"
    );


  html =
    html.replace(
      /\*\*([^*]+)\*\*/g,
      "<strong>$1</strong>"
    );


  html =
    html.replace(
      /^\s*\*\s+/gm,
      '<span class="ai-bullet">•</span> '
    );


  html =
    html.replace(
      /^\s*-\s+/gm,
      '<span class="ai-bullet">•</span> '
    );


  html =
    html.replace(
      /\n/g,
      "<br>"
    );


  return html;

}


/* =====================================================
   FILTERS
===================================================== */

function populateFilters(opportunities) {

  const supplierFilter =
    document.getElementById(
      "supplierFilter"
    );


  const materialFilter =
    document.getElementById(
      "materialFilter"
    );


  if (
    !supplierFilter ||
    !materialFilter
  ) {

    return;

  }


  const suppliers =
    [
      ...new Set(
        opportunities.map(
          item =>
            item.supplier
        )
      )
    ].sort();


  const materials =
    [
      ...new Set(
        opportunities.map(
          item =>
            item.material
        )
      )
    ].sort();


  supplierFilter.innerHTML =
    '<option value="ALL">All Suppliers</option>';


  materialFilter.innerHTML =
    '<option value="ALL">All Materials</option>';


  suppliers.forEach(
    supplier => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        supplier;


      option.textContent =
        supplier;


      supplierFilter.appendChild(
        option
      );

    }
  );


  materials.forEach(
    material => {

      const option =
        document.createElement(
          "option"
        );


      option.value =
        material;


      option.textContent =
        material;


      materialFilter.appendChild(
        option
      );

    }
  );


  supplierFilter.value =
    suppliers.includes(
      activeSupplier
    )
      ? activeSupplier
      : "ALL";


  materialFilter.value =
    materials.includes(
      activeMaterial
    )
      ? activeMaterial
      : "ALL";

}


/* =====================================================
   APPLY FILTERS
===================================================== */

function applyFilters() {

  activeSupplier =
    document.getElementById(
      "supplierFilter"
    )?.value ||
    "ALL";


  activeMaterial =
    document.getElementById(
      "materialFilter"
    )?.value ||
    "ALL";


  activePriority =
    document.getElementById(
      "priorityFilter"
    )?.value ||
    "ALL";


  renderFilteredOpportunities();

}


/* =====================================================
   FILTER EVENTS
===================================================== */

document
  .getElementById(
    "supplierFilter"
  )
  ?.addEventListener(
    "change",
    applyFilters
  );


document
  .getElementById(
    "materialFilter"
  )
  ?.addEventListener(
    "change",
    applyFilters
  );


document
  .getElementById(
    "priorityFilter"
  )
  ?.addEventListener(
    "change",
    applyFilters
  );


/* =====================================================
   CLEAR FILTERS
===================================================== */

document
  .getElementById(
    "clearFilters"
  )
  ?.addEventListener(
    "click",
    () => {

      activeSupplier = "ALL";

      activeMaterial = "ALL";

      activePriority = "ALL";


      const supplierFilter =
        document.getElementById(
          "supplierFilter"
        );


      const materialFilter =
        document.getElementById(
          "materialFilter"
        );


      const priorityFilter =
        document.getElementById(
          "priorityFilter"
        );


      if (supplierFilter) {

        supplierFilter.value =
          "ALL";

      }


      if (materialFilter) {

        materialFilter.value =
          "ALL";

      }


      if (priorityFilter) {

        priorityFilter.value =
          "ALL";

      }


      renderFilteredOpportunities();

    }
  );


/* =====================================================
   SUPPLIER ANALYSIS
===================================================== */

function showSupplierAnalysis() {

  const container =
    document.getElementById(
      "supplierAnalysis"
    );


  if (!container) return;


  container.innerHTML = "";


  if (!data.length) {

    container.innerHTML = `

      <p class="empty-message">
        No supplier data available.
      </p>

    `;

    return;

  }


  const suppliers = {};


  data.forEach(item => {

    const supplier =
      String(
        item.supplier ||
        "Unknown Supplier"
      ).trim();


    const quantity =
      cleanNumber(
        item.quantity
      ) || 0;


    const price =
      cleanNumber(
        item.price
      ) || 0;


    const spend =
      quantity * price;


    if (!suppliers[supplier]) {

      suppliers[supplier] = {

        spend: 0,

        transactions: 0

      };

    }


    suppliers[supplier].spend +=
      spend;


    suppliers[supplier].transactions++;

  });


  const supplierList =
    Object.entries(suppliers)
      .sort(
        (a, b) =>
          b[1].spend -
          a[1].spend
      );


  const totalSpend =
    supplierList.reduce(
      (sum, [, supplier]) =>
        sum + supplier.spend,
      0
    );


  supplierList.forEach(
    ([supplier, info]) => {

      const percentage =
        totalSpend > 0
          ? (
              info.spend /
              totalSpend
            ) * 100
          : 0;


      container.innerHTML += `

        <div class="analysis-row">

          <div class="analysis-header">

            <span class="analysis-name">
              ${escapeHTML(supplier)}
            </span>

            <span class="analysis-value">
              ${formatCurrency(info.spend)}
            </span>

          </div>


          <div class="progress">

            <div
              class="progress-bar"
              style="width:${percentage.toFixed(1)}%"
            ></div>

          </div>


          <div class="analysis-meta">

            <span>
              ${info.transactions}
              transactions
            </span>

            <span>
              ${percentage.toFixed(1)}%
              of spend
            </span>

          </div>

        </div>

      `;

    }
  );

}


/* =====================================================
   MATERIAL ANALYSIS
===================================================== */

function showMaterialAnalysis() {

  const container =
    document.getElementById(
      "materialAnalysis"
    );


  if (!container) return;


  container.innerHTML = "";


  if (!data.length) {

    container.innerHTML = `

      <p class="empty-message">
        No material data available.
      </p>

    `;

    return;

  }


  const materials = {};


  data.forEach(item => {

    const material =
      String(
        item.material ||
        "Unknown Material"
      ).trim();


    const quantity =
      cleanNumber(
        item.quantity
      ) || 0;


    const price =
      cleanNumber(
        item.price
      ) || 0;


    const spend =
      quantity * price;


    if (!materials[material]) {

      materials[material] = {

        spend: 0,

        quantity: 0,

        transactions: 0

      };

    }


    materials[material].spend +=
      spend;


    materials[material].quantity +=
      quantity;


    materials[material].transactions++;

  });


  const materialList =
    Object.entries(materials)
      .sort(
        (a, b) =>
          b[1].spend -
          a[1].spend
      );


  const totalSpend =
    materialList.reduce(
      (sum, [, material]) =>
        sum + material.spend,
      0
    );


  materialList.forEach(
    ([material, info]) => {

      const percentage =
        totalSpend > 0
          ? (
              info.spend /
              totalSpend
            ) * 100
          : 0;


      container.innerHTML += `

        <div class="analysis-row">

          <div class="analysis-header">

            <span class="analysis-name">
              ${escapeHTML(material)}
            </span>

            <span class="analysis-value">
              ${formatCurrency(info.spend)}
            </span>

          </div>


          <div class="progress">

            <div
              class="progress-bar"
              style="width:${percentage.toFixed(1)}%"
            ></div>

          </div>


          <div class="analysis-meta">

            <span>
              ${info.quantity.toLocaleString("en-IN")}
              units
            </span>

            <span>
              ${percentage.toFixed(1)}%
              of spend
            </span>

          </div>

        </div>

      `;

    }
  );

}


/* =====================================================
   SUPPLIER CHART
===================================================== */

function showSupplierChart() {

  const container =
    document.getElementById(
      "supplierChart"
    );


  if (!container) return;


  container.innerHTML = "";


  if (!data.length) {

    container.innerHTML = `

      <p class="empty-message">
        No supplier data available.
      </p>

    `;

    return;

  }


  const suppliers = {};


  data.forEach(item => {

    const supplier =
      String(
        item.supplier ||
        "Unknown Supplier"
      ).trim();


    const quantity =
      cleanNumber(
        item.quantity
      ) || 0;


    const price =
      cleanNumber(
        item.price
      ) || 0;


    const spend =
      quantity * price;


    if (!suppliers[supplier]) {

      suppliers[supplier] = 0;

    }


    suppliers[supplier] +=
      spend;

  });


  const list =
    Object.entries(suppliers)
      .sort(
        (a, b) =>
          b[1] -
          a[1]
      );


  const totalSpend =
    list.reduce(
      (sum, [, value]) =>
        sum + value,
      0
    );


  list.forEach(
    ([supplier, spend]) => {

      const percentage =
        totalSpend > 0
          ? (
              spend /
              totalSpend
            ) * 100
          : 0;


      container.innerHTML += `

        <div class="chart-row">

          <div class="chart-label">

            <span>
              ${escapeHTML(supplier)}
            </span>

            <span>
              ${formatCurrency(spend)}
            </span>

          </div>


          <div class="chart-track">

            <div
              class="chart-fill"
              style="width:${percentage.toFixed(1)}%"
            ></div>

          </div>


          <span class="chart-percentage">

            ${percentage.toFixed(1)}%
            of total spend

          </span>

        </div>

      `;

    }
  );

}


/* =====================================================
   MATERIAL CHART
===================================================== */

function showMaterialChart() {

  const container =
    document.getElementById(
      "materialChart"
    );


  if (!container) return;


  container.innerHTML = "";


  if (!data.length) {

    container.innerHTML = `

      <p class="empty-message">
        No material data available.
      </p>

    `;

    return;

  }


  const materials = {};


  data.forEach(item => {

    const material =
      String(
        item.material ||
        "Unknown Material"
      ).trim();


    const quantity =
      cleanNumber(
        item.quantity
      ) || 0;


    const price =
      cleanNumber(
        item.price
      ) || 0;


    const spend =
      quantity * price;


    if (!materials[material]) {

      materials[material] = 0;

    }


    materials[material] +=
      spend;

  });


  const list =
    Object.entries(materials)
      .sort(
        (a, b) =>
          b[1] -
          a[1]
      );


  const totalSpend =
    list.reduce(
      (sum, [, value]) =>
        sum + value,
      0
    );


  list.forEach(
    ([material, spend]) => {

      const percentage =
        totalSpend > 0
          ? (
              spend /
              totalSpend
            ) * 100
          : 0;


      container.innerHTML += `

        <div class="chart-row">

          <div class="chart-label">

            <span>
              ${escapeHTML(material)}
            </span>

            <span>
              ${formatCurrency(spend)}
            </span>

          </div>


          <div class="chart-track">

            <div
              class="chart-fill"
              style="width:${percentage.toFixed(1)}%"
            ></div>

          </div>


          <span class="chart-percentage">

            ${percentage.toFixed(1)}%
            of total spend

          </span>

        </div>

      `;

    }
  );

}


/* =====================================================
   START APPLICATION
===================================================== */

loadDatabaseData();