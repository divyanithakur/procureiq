const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("csvFile");
const status = document.getElementById("uploadStatus");

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
      await fetch("/api/transactions", {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      });


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
        `Loaded ${data.length} transactions from PostgreSQL.`;

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
   CSV UPLOAD
===================================================== */

uploadBtn?.addEventListener(
  "click",
  handleCSVUpload
);


async function handleCSVUpload() {

  const file =
    fileInput?.files?.[0];


  /* ---------------------------------------------
     FILE VALIDATION
  --------------------------------------------- */

  if (!file) {

    if (status) {
      status.textContent =
        "Please select a CSV file.";
    }

    return;

  }


  if (
    !file.name
      .toLowerCase()
      .endsWith(".csv")
  ) {

    if (status) {
      status.textContent =
        "Please select a valid CSV file.";
    }

    return;

  }


  if (status) {
    status.textContent =
      "Reading CSV file...";
  }


  try {

    const text =
      await readCSVFile(file);


    if (!text.trim()) {

      throw new Error(
        "CSV file is empty."
      );

    }


    /* ---------------------------------------------
       PARSE CSV
    --------------------------------------------- */

    const csvData =
      parseCSV(text);


    if (!csvData.length) {

      throw new Error(
        "No transactions found in CSV."
      );

    }


    /* ---------------------------------------------
       VALIDATE REQUIRED COLUMNS
    --------------------------------------------- */

    const requiredHeaders = [
      "material",
      "supplier",
      "quantity",
      "price"
    ];


    const headers =
      Object.keys(csvData[0]);


    const missingHeaders =
      requiredHeaders.filter(
        header =>
          !headers.includes(header)
      );


    if (missingHeaders.length) {

      throw new Error(
        `Missing columns: ${missingHeaders.join(", ")}`
      );

    }


    /* ---------------------------------------------
       VALIDATE TRANSACTIONS
    --------------------------------------------- */

    const validData =
      csvData

        .map(item => {

          const material =
            String(
              item.material || ""
            ).trim();


          const supplier =
            String(
              item.supplier || ""
            ).trim();


          const quantity =
            Number(
              String(
                item.quantity || ""
              )
              .replace(/,/g, "")
              .trim()
            );


          const price =
            Number(
              String(
                item.price || ""
              )
              .replace(/,/g, "")
              .replace(/[₹$]/g, "")
              .trim()
            );


          return {
            ...item,

            material,

            supplier,

            quantity,

            price
          };

        })

        .filter(item => {

          return (

            item.material &&

            item.supplier &&

            Number.isFinite(item.quantity) &&

            Number.isFinite(item.price) &&

            item.quantity > 0 &&

            item.price >= 0

          );

        });


    if (!validData.length) {

      throw new Error(
        "No valid transactions found. Check material, supplier, quantity and price values."
      );

    }


    const invalidCount =
      csvData.length -
      validData.length;


    if (status) {

      status.textContent =
        `Validated ${validData.length} transaction(s).`;

    }


    /* ---------------------------------------------
       SAVE TO POSTGRESQL
    --------------------------------------------- */

    if (status) {

      status.textContent =
        "Checking database for duplicates...";

    }


    const response =
      await fetch(
        "/api/transactions/upload",
        {

          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Accept":
              "application/json"
          },

          body:
            JSON.stringify({
              transactions:
                validData
            })

        }
      );


    let result;


    try {

      result =
        await response.json();

    }

    catch {

      throw new Error(
        "Server returned an invalid response."
      );

    }


    if (!response.ok) {

      throw new Error(
        result.error ||
        "Upload failed."
      );

    }


    /* ---------------------------------------------
       RELOAD DATABASE
    --------------------------------------------- */

    await loadDatabaseData();


    /* ---------------------------------------------
       SUCCESS MESSAGE
    --------------------------------------------- */

    if (status) {

      status.textContent =
        `✅ ${result.inserted || 0} new transaction(s) added. ` +
        `${result.duplicates || 0} duplicate(s) skipped.` +
        (
          invalidCount > 0
            ? ` ${invalidCount} invalid row(s) ignored.`
            : ""
        );

    }


    if (fileInput) {
      fileInput.value = "";
    }

  }

  catch (error) {

    console.error(
      "CSV Upload Error:",
      error
    );


    if (status) {

      status.textContent =
        `❌ CSV Error: ${error.message}`;

    }

  }

}


/* =====================================================
   READ CSV FILE
===================================================== */

function readCSVFile(file) {

  return new Promise(
    (resolve, reject) => {

      const reader =
        new FileReader();


      reader.onload =
        event => {

          resolve(
            event.target.result
          );

        };


      reader.onerror =
        () => {

          reject(
            new Error(
              "Unable to read CSV file."
            )
          );

        };


      reader.readAsText(file);

    }
  );

}


/* =====================================================
   ROBUST CSV PARSER
===================================================== */

function parseCSV(text) {

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
       QUOTED VALUE
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
            cell !== ""
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
        cell !== ""
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
        String(header)
          .trim()
          .toLowerCase()
          .replace(/^\uFEFF/, "")
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
            values[index] ??
            "";

        }
      );


      return object;

    });

}


/* =====================================================
   ANALYZE PROCUREMENT DATA
===================================================== */

function analyzeData() {

  if (!data.length) {

    document.getElementById(
      "totalSpend"
    ).textContent = "₹0";


    document.getElementById(
      "transactions"
    ).textContent = "0";


    document.getElementById(
      "opportunities"
    ).textContent = "0";


    document.getElementById(
      "savings"
    ).textContent = "₹0";


    window.procurementOpportunities = [];


    showOpportunities({});

    showSupplierAnalysis();

    showMaterialAnalysis();

    showSupplierChart();

    showMaterialChart();

    return;

  }


  /* ---------------------------------------------
     TOTAL SPEND
  --------------------------------------------- */

  const totalSpend =
    data.reduce(
      (sum, item) => {

        const quantity =
          Number(item.quantity) || 0;

        const price =
          Number(item.price) || 0;


        return (
          sum +
          quantity * price
        );

      },
      0
    );


  /* ---------------------------------------------
     GROUP BY MATERIAL
  --------------------------------------------- */

  const groups = {};


  data.forEach(item => {

    const material =
      String(
        item.material ||
        "Unknown Material"
      ).trim();


    if (!groups[material]) {

      groups[material] = [];

    }


    groups[material].push({

      price:
        Number(item.price) || 0,

      quantity:
        Number(item.quantity) || 0,

      supplier:
        String(
          item.supplier ||
          "Unknown Supplier"
        ).trim()

    });

  });


  /* ---------------------------------------------
     OPPORTUNITIES
  --------------------------------------------- */

  let opportunities = 0;

  let savings = 0;


  Object.values(groups).forEach(
    items => {

      if (!items.length) return;


      const minPrice =
        Math.min(
          ...items.map(
            item =>
              item.price
          )
        );


      items.forEach(item => {

        if (
          item.price >
          minPrice
        ) {

          opportunities++;


          savings +=
            (
              item.price -
              minPrice
            ) *
            item.quantity;

        }

      });

    }
  );


  /* ---------------------------------------------
     UPDATE DASHBOARD
  --------------------------------------------- */

  document.getElementById(
    "totalSpend"
  ).textContent =
    formatCurrency(totalSpend);


  document.getElementById(
    "transactions"
  ).textContent =
    data.length;


  document.getElementById(
    "opportunities"
  ).textContent =
    opportunities;


  document.getElementById(
    "savings"
  ).textContent =
    formatCurrency(savings);


  /* ---------------------------------------------
     ANALYTICS
  --------------------------------------------- */

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
            item =>
              item.price
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


        if (
          variance >= 20
        ) {

          priority = "HIGH";

        }

        else if (
          variance >= 10
        ) {

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
   AI BUTTON EVENT DELEGATION
   More reliable for dynamically created buttons
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
   GEMINI AI INSIGHT
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


  if (!box) {

    console.error(
      "AI insight box not found:",
      id
    );

    return;

  }


  /* ---------------------------------------------
     VALIDATE INPUT
  --------------------------------------------- */

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


  /* ---------------------------------------------
     LOADING STATE
  --------------------------------------------- */

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

    console.log(
      "Sending AI request:",
      {
        material,
        supplier,
        price,
        minPrice,
        quantity
      }
    );


    /* ---------------------------------------------
       CALL BACKEND
    --------------------------------------------- */

    const response =
      await fetch(
        "/api/insight",
        {

          method: "POST",

          headers: {

            "Content-Type":
              "application/json",

            "Accept":
              "application/json"

          },

          body:
            JSON.stringify({

              material,

              supplier,

              price,

              minPrice,

              quantity

            })

        }
      );


    /* ---------------------------------------------
       READ RESPONSE SAFELY
    --------------------------------------------- */

    const responseText =
      await response.text();


    console.log(
      "AI server response:",
      response.status,
      responseText
    );


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


    /* ---------------------------------------------
       SERVER ERROR
    --------------------------------------------- */

    if (!response.ok) {

      throw new Error(
        result.error ||
        result.message ||
        `AI request failed with status ${response.status}.`
      );

    }


    /* ---------------------------------------------
       CHECK INSIGHT
    --------------------------------------------- */

    if (
      !result.insight ||
      typeof result.insight !== "string"
    ) {

      throw new Error(
        "AI returned an empty response."
      );

    }


    /* ---------------------------------------------
       DISPLAY AI RESPONSE
    --------------------------------------------- */

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
   RETRY AI BUTTON
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
   FORMAT GEMINI RESPONSE
===================================================== */

function formatAIResponse(text) {

  if (!text) {
    return "";
  }


  /*
   * IMPORTANT:
   * Escape HTML FIRST so Gemini cannot inject HTML.
   */

  let html =
    escapeHTML(text);


  /* ---------------------------------------------
     HEADINGS LIKE:
     **1. Why investigate**
  --------------------------------------------- */

  html =
    html.replace(
      /\*\*(\d+\.\s*[^*]+)\*\*/g,
      "<h4>$1</h4>"
    );


  /* ---------------------------------------------
     BOLD TEXT:
     **Quality & Freight**
  --------------------------------------------- */

  html =
    html.replace(
      /\*\*([^*]+)\*\*/g,
      "<strong>$1</strong>"
    );


  /* ---------------------------------------------
     BULLET:
     * something
  --------------------------------------------- */

  html =
    html.replace(
      /^\s*\*\s+/gm,
      '<span class="ai-bullet">•</span> '
    );


  /* ---------------------------------------------
     BULLET:
     - something
  --------------------------------------------- */

  html =
    html.replace(
      /^\s*-\s+/gm,
      '<span class="ai-bullet">•</span> '
    );


  /* ---------------------------------------------
     LINE BREAKS
  --------------------------------------------- */

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


  supplierFilter.innerHTML = "";

  materialFilter.innerHTML = "";


  const allSuppliers =
    document.createElement(
      "option"
    );

  allSuppliers.value =
    "ALL";

  allSuppliers.textContent =
    "All Suppliers";

  supplierFilter.appendChild(
    allSuppliers
  );


  const allMaterials =
    document.createElement(
      "option"
    );

  allMaterials.value =
    "ALL";

  allMaterials.textContent =
    "All Materials";

  materialFilter.appendChild(
    allMaterials
  );


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
   FILTER EVENT LISTENERS
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

      activeSupplier =
        "ALL";

      activeMaterial =
        "ALL";

      activePriority =
        "ALL";


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
      item.supplier ||
      "Unknown Supplier";


    const quantity =
      Number(item.quantity) || 0;


    const price =
      Number(item.price) || 0;


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
      item.material ||
      "Unknown Material";


    const quantity =
      Number(item.quantity) || 0;


    const price =
      Number(item.price) || 0;


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
      item.supplier ||
      "Unknown Supplier";


    const spend =
      (
        Number(item.quantity) || 0
      ) *
      (
        Number(item.price) || 0
      );


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
      item.material ||
      "Unknown Material";


    const spend =
      (
        Number(item.quantity) || 0
      ) *
      (
        Number(item.price) || 0
      );


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