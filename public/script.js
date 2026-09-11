/* =====================================================
   PROCUREIQ FRONTEND
   CSV + XLSX + XLS + PDF
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

// Keep workspace navigation icons on one consistent, restrained visual system.
function normalizeWorkspaceIcons() {
    const icons = {
        "⌂": "home", "↗": "target", "◉": "chart", "◈": "shield", "▤": "file", "₹": "card", "?": "help"
    };
    document.querySelectorAll(".sidebar-icon").forEach((icon) => {
        const label = icon.textContent.trim();
        if (!icons[label]) return;
        icon.dataset.icon = icons[label];
        icon.textContent = "";
        icon.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><use href="#procureiq-icon-${icons[label]}"></use></svg>`;
    });
    if (document.getElementById("procureiq-icon-sprite")) return;
    const sprite = document.createElement("svg");
    sprite.id = "procureiq-icon-sprite";
    sprite.setAttribute("aria-hidden", "true");
    sprite.style.display = "none";
    sprite.innerHTML = `<symbol id="procureiq-icon-home" viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></symbol><symbol id="procureiq-icon-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M22 12h-3"/></symbol><symbol id="procureiq-icon-chart" viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 16v-5M12 16V7M16 16v-9"/></symbol><symbol id="procureiq-icon-shield" viewBox="0 0 24 24"><path d="M12 3 20 6v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></symbol><symbol id="procureiq-icon-file" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></symbol><symbol id="procureiq-icon-card" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></symbol><symbol id="procureiq-icon-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.1 1.9c-1 .8-1.6 1.2-1.6 2.6M12 17h.01"/></symbol>`;
    document.body.appendChild(sprite);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", normalizeWorkspaceIcons, { once: true });
else normalizeWorkspaceIcons();


/* =====================================================
   GLOBAL STATE
===================================================== */

let data = [];
let activeSupplier = "ALL";
let activeMaterial = "ALL";
let activePriority = "ALL";
let selectedFile = null;
let visibleOpportunityCount = 5;

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
    if (value === null || value === undefined || value === "") {
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
        .replace(/[-_]+/g, " ");
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


function showError(message) {
    console.error("ProcureIQ Error:", message);

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
    if (!fileInput) return showError("File input was not found.");
    const file = selectedFile || fileInput.files?.[0];
    if (!file) return showError("Please select a CSV, Excel or PDF file first.");

    const extension = file.name.split(".").pop().toLowerCase();
    if (!["csv", "xlsx", "xls", "pdf"].includes(extension)) {
        return showError("Unsupported file format. Please upload CSV, XLSX, XLS or PDF.");
    }

    try {
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<span class="button-spinner"></span> Analyzing...';
        status.textContent = `Reading ${file.name}...`;
        let transactions = [];
        let extractionNote = "";

        if (extension === "csv") {
            transactions = parseCSVFile(await file.text());
        } else if (extension === "pdf") {
            status.textContent = `Extracting transaction tables from ${file.name}...`;
            const extracted = await parsePDFFile(file);
            transactions = extracted.transactions;
            extractionNote = extracted.note;
        } else {
            if (typeof XLSX === "undefined") throw new Error("Excel library failed to load.");
            const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
            if (!workbook.SheetNames?.length) throw new Error("The Excel file contains no worksheets.");
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
            if (!rows.length) throw new Error("The Excel worksheet is empty.");
            transactions = convertExcelRows(rows);
        }

        const validation = validateTransactions(transactions);
        if (!validation.valid.length) {
            throw new Error(extractionNote || "No valid transactions found. Required fields: material, supplier, quantity and price.");
        }

        status.textContent = `Validated ${validation.valid.length} transaction(s). Checking data quality...`;
        await new Promise(resolve => requestAnimationFrame(resolve));

        const response = await procureiqApiFetch("/api/transactions/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ transactions: validation.valid })
        });

        const responseText = await response.text();
        let result = {};
        try { result = responseText ? JSON.parse(responseText) : {}; }
        catch { throw new Error(`Server returned invalid JSON (${response.status}).`); }
        if (!response.ok) throw new Error(result.error || result.message || `Upload failed with status ${response.status}.`);

        const inserted = Number(result.inserted) || 0;
        const duplicates = Number(result.duplicates) || 0;
        status.textContent = `✓ ${inserted} new transaction(s) added · ${duplicates} duplicate(s) skipped` +
            (validation.invalid ? ` · ${validation.invalid} invalid row(s) ignored` : "") +
            (extractionNote ? ` · ${extractionNote}` : "");

        await loadDatabaseData();
        fileInput.value = "";
        selectedFile = null;
    } catch (error) {
        console.error("File upload error:", error);
        showError(error.message || "Unable to process the uploaded file.");
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = 'Analyze File <span>→</span>';
    }
}

/* =====================================================
   PDF EXTRACTION
   Text-based PDFs are parsed locally in the browser. No PDF
   content is sent to the AI just to calculate financial values.
===================================================== */
async function parsePDFFile(file) {
    if (!window.pdfjsLib) {
        throw new Error(
            "PDF engine failed to load. Refresh the page and try again."
        );
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const pdf = await window.pdfjsLib.getDocument({
        data: await file.arrayBuffer()
    }).promise;

    const lines = [];

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        status.textContent =
            `Extracting PDF page ${pageNo} of ${pdf.numPages}...`;

        const page = await pdf.getPage(pageNo);
        const content = await page.getTextContent();

        const buckets = new Map();

        for (const item of content.items) {
            const text = String(item.str || "").trim();

            if (!text) continue;

            const y = Number(item.transform?.[5] || 0);
            const key = Math.round(y / 3) * 3;

            if (!buckets.has(key)) {
                buckets.set(key, []);
            }

            buckets.get(key).push(item);
        }

        [...buckets.entries()]
            .sort((a, b) => b[0] - a[0])
            .forEach(([, items]) => {

                items.sort(
                    (a, b) =>
                        Number(a.transform?.[4] || 0) -
                        Number(b.transform?.[4] || 0)
                );

                let text = "";
                let previousRight = null;

                for (const item of items) {
                    const value = String(item.str || "").trim();

                    if (!value) continue;

                    const x = Number(item.transform?.[4] || 0);
                    const width = Math.max(
                        0,
                        Number(item.width || 0)
                    );

                    if (previousRight !== null) {
                        const gap = x - previousRight;

                        if (gap > 18) {
                            text += "    ";
                        } else {
                            text += " ";
                        }
                    }

                    text += value;

                    previousRight = x + width;
                }

                text = text.trim();

                if (text) {
                    lines.push(text);
                }
            });
    }

    return extractTransactionsFromPDFLines(lines);
}


function extractTransactionsFromPDFLines(lines) {

    const cleanText = value =>
        String(value || "")
            .replace(/[|]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();

    const hasMaterial =
        /\b(material|item|product|part|sku)\b/i;

    const hasSupplier =
        /\b(supplier|vendor|seller|party)\b/i;

    const hasQuantity =
        /\b(quantity|qty|units|count)\b/i;

    const hasPrice =
        /\b(price|rate|unit[ -]?price|unit[ -]?cost|cost)\b/i;

    const headerIndex = lines.findIndex(line => {

        const h = cleanText(line);

        return (
            hasMaterial.test(h) &&
            hasSupplier.test(h) &&
            hasQuantity.test(h) &&
            hasPrice.test(h)
        );
    });

    const source =
        headerIndex >= 0
            ? lines.slice(headerIndex + 1)
            : lines;

    const transactions = [];
    const seen = new Set();

    const numberPattern =
        /(?:₹|Rs\.?|INR|\$|€|£)?\s*[-+]?\d+(?:,\d{3})*(?:\.\d+)?/gi;

    const ignoredLine =
        /^(total|subtotal|grand\s+total|tax|gst|invoice|date|page|amount|summary|report)\b/i;

    for (const rawLine of source) {

        const line = String(rawLine || "").trim();

        if (!line || ignoredLine.test(line)) {
            continue;
        }

        const dateMatch = line.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/);
        const numericLine = dateMatch ? line.replace(dateMatch[0], " ") : line;
        const matches = [
            ...numericLine.matchAll(numberPattern)
        ];

        if (matches.length < 2) {
            continue;
        }

        const secondLast =
            matches[matches.length - 2];

        const last =
            matches[matches.length - 1];

        const quantity = cleanNumber(
            secondLast[0].replace(
                /(?:₹|Rs\.?|INR|\$|€|£)/gi,
                ""
            )
        );

        const price = cleanNumber(
            last[0].replace(
                /(?:₹|Rs\.?|INR|\$|€|£)/gi,
                ""
            )
        );

        if (
            !Number.isFinite(quantity) ||
            !Number.isFinite(price)
        ) {
            continue;
        }

        if (quantity <= 0 || price < 0) {
            continue;
        }

        const prefix = numericLine
            .slice(0, secondLast.index)
            .replace(/[|]+/g, "    ")
            .trim();

        let cells = prefix
            .split(/\t+|\s{3,}|\s*\|\s*/)
            .map(cleanText)
            .filter(Boolean);

        /*
         * PDF fallback:
         * If PDF.js collapsed all column spacing,
         * try to identify material and supplier
         * from the text itself.
         */
        if (cells.length < 2) {

            const words =
                prefix
                    .split(/\s+/)
                    .filter(Boolean);

            if (words.length >= 2) {

                const materialCandidates = [
                    "stainless steel",
                    "aluminium",
                    "aluminum",
                    "copper",
                    "steel",
                    "brass",
                    "iron",
                    "plastic",
                    "rubber",
                    "cement",
                    "motor oil",
                    "hydraulic oil"
                ];

                const lower =
                    prefix.toLowerCase();

                const knownMaterial =
                    materialCandidates.find(material =>
                        lower.startsWith(material)
                    );

                if (knownMaterial) {

                    const material =
                        prefix
                            .slice(
                                0,
                                knownMaterial.length
                            )
                            .trim();

                    const supplier =
                        prefix
                            .slice(
                                knownMaterial.length
                            )
                            .trim();

                    if (supplier) {
                        cells = [
                            material,
                            supplier
                        ];
                    }

                } else {

                    /*
                     * Generic fallback:
                     * first word = material
                     * remaining words = supplier
                     */
                    cells = [
                        words[0],
                        words.slice(1).join(" ")
                    ];
                }
            }
        }

        if (cells.length < 2) {
            continue;
        }

        const material =
            cleanText(cells[0]);

        const supplier =
            cleanText(
                cells.slice(1).join(" ")
            );

        if (!material || !supplier) {
            continue;
        }

        const key = [
            material.toLowerCase(),
            supplier.toLowerCase(),
            quantity,
            price
        ].join("|");

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);

        transactions.push({
            material,
            supplier,
            quantity,
            price,
            transaction_date: item.transaction_date || item.date || ""
        });
    }

    if (!transactions.length) {
        throw new Error(
            "No reliable transaction table was detected in this PDF. Use a text-based PDF with columns for material, supplier, quantity and price; scanned PDFs need OCR before they can be analyzed safely."
        );
    }

    return {
        transactions,
        note:
            `${transactions.length} PDF row(s) extracted`
    };
}

function setupUploadUX() {
    const dropzone = document.getElementById("uploadDropzone");
    if (!dropzone || !fileInput) return;
    const applyFile = file => {
        if (!file) return;
        selectedFile = file;
        const ext = file.name.split(".").pop().toLowerCase();
        if (!["csv","xlsx","xls","pdf"].includes(ext)) return showError("Unsupported file format. Please upload CSV, XLSX, XLS or PDF.");
        const label = document.getElementById("fileName");
        if (label) label.textContent = file.name;
        dropzone.classList.add("has-file");
        status.textContent = `${file.name} ready to analyze.`;
    };
    fileInput.addEventListener("change", e => applyFile(e.target.files?.[0]));
    ["dragenter","dragover"].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.add("is-dragging"); }));
    ["dragleave","drop"].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.remove("is-dragging"); }));
    dropzone.addEventListener("drop", e => applyFile(e.dataTransfer.files?.[0]));
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
            ),

            transaction_date: findColumn(
                row,
                ["date", "transaction date", "purchase date", "invoice date"]
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
            price,
            transaction_date: item.transaction_date || item.date || ""
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


    for (let i = 0; i < text.length; i++) {

        const char = text[i];
        const nextChar = text[i + 1];


        /* Quotes */

        if (char === '"') {

            if (
                insideQuotes &&
                nextChar === '"'
            ) {

                value += '"';
                i++;

            } else {

                insideQuotes = !insideQuotes;
            }

            continue;
        }


        /* Comma */

        if (
            char === "," &&
            !insideQuotes
        ) {

            row.push(value.trim());

            value = "";

            continue;
        }


        /* New line */

        if (
            (char === "\n" || char === "\r") &&
            !insideQuotes
        ) {

            if (
                char === "\r" &&
                nextChar === "\n"
            ) {
                i++;
            }


            row.push(value.trim());

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


    /* Last row */

    if (
        value !== "" ||
        row.length
    ) {

        row.push(value.trim());
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


    /* Headers */

    const headers =
        rows[0].map(header =>
            normalizeHeader(header)
                .replace(/ /g, "_")
        );


    /* Objects */

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
                    "",

                transaction_date:
                    object.date || object.transaction_date || object.purchase_date || object.invoice_date || ""
            };
        });
}


/* =====================================================
   LOAD DATA FROM POSTGRESQL
===================================================== */

async function loadDatabaseData() {
    try {
        if (status) status.textContent = "Loading your procurement data…";
        const response = await procureiqApiFetch("/api/transactions", {
            method: "GET",
            headers: { Accept: "application/json" }
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) {
                throw new Error("Your sign-in session is not ready. Please wait a moment and try again.");
            }
            throw new Error(result.error || `Server returned ${response.status}`);
        }
        data = Array.isArray(result) ? result : (Array.isArray(result.transactions) ? result.transactions : []);
        analyzeData();
        if (status) {
            status.textContent = data.length
                ? `✓ Loaded ${data.length.toLocaleString("en-IN")} transaction(s) from PostgreSQL.`
                : "No saved procurement transactions yet. Upload a CSV, Excel or PDF file to begin.";
        }
        return true;
    } catch (error) {
        console.error("PostgreSQL Error:", error);
        if (status) status.textContent = `Unable to load procurement data: ${error.message}`;
        return false;
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
        window.procureIQRefreshIntelligence?.();
        window.procureIQSyncReportSummary?.();

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


                return sum + quantity * price;

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


    Object.values(groups).forEach(items => {

        if (!items.length) return;


        const minPrice =
            Math.min(
                ...items.map(
                    item => item.price
                )
            );


        items.forEach(item => {

            if (item.price > minPrice) {

                opportunityCount++;


                totalSavings +=
                    (item.price - minPrice) *
                    item.quantity;
            }
        });
    });


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
    window.procureIQSyncReportSummary?.();
    window.procureIQRefreshExecutiveView?.();
}


/* =====================================================
   CREATE OPPORTUNITIES
===================================================== */

function showOpportunities(groups) {

    const opportunities = [];
    const totalSavingsForScoring = Math.max(1, Object.values(groups).reduce((sum, items) => {
        if (!items.length) return sum;
        const min = Math.min(...items.map(item => item.price));
        return sum + items.reduce((s, item) => s + Math.max(0, (item.price - min) * item.quantity), 0);
    }, 0));


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

                if (item.price <= minPrice) {
                    return;
                }


                const saving =
                    (item.price - minPrice) *
                    item.quantity;


                const variance =
                    minPrice > 0
                        ? (
                            (item.price - minPrice) /
                            minPrice
                        ) * 100
                        : 0;


                let priority;


                if (variance >= 20) {

                    priority = "HIGH";

                } else if (variance >= 10) {

                    priority = "MEDIUM";

                } else {

                    priority = "LOW";
                }


                const comparableCount = items.filter(other => Number(other.price) > 0).length;
                const confidence = comparableCount >= 5 ? "High" : comparableCount >= 3 ? "Medium" : "Low";
                const confidencePoints = comparableCount >= 5 ? 30 : comparableCount >= 3 ? 20 : 10;
                const impactPoints = Math.min(35, Math.round((saving / Math.max(totalSavingsForScoring, 1)) * 35));
                const repetitionPoints = Math.min(20, Math.max(0, comparableCount - 1) * 5);
                const urgencyPoints = priority === "HIGH" ? 15 : priority === "MEDIUM" ? 9 : 4;
                const opportunityScore = Math.min(100, impactPoints + confidencePoints + repetitionPoints + urgencyPoints);

                opportunities.push({
                    material,
                    supplier: item.supplier,
                    price: item.price,
                    minPrice,
                    quantity: item.quantity,
                    saving,
                    variance,
                    priority,
                    score: opportunityScore,
                    confidence,
                    comparableCount,
                    comparison: items.map(other => ({ supplier: other.supplier, price: other.price, quantity: other.quantity }))
                        .sort((a, b) => a.price - b.price)
                });
            });
        }
    );


    opportunities.sort(
        (a, b) =>
            b.saving - a.saving
    );


    window.procurementOpportunities =
        opportunities;


    populateFilters(
        opportunities
    );


    renderFilteredOpportunities();
    window.procureIQRefreshIntelligence?.();
}


/* =====================================================
   RENDER OPPORTUNITIES
===================================================== */

function renderFilteredOpportunities() {
    const list = document.getElementById("opportunityList");
    const summary = document.getElementById("opportunitySummary");
    const pagination = document.getElementById("opportunityPagination");
    const moreButton = document.getElementById("showMoreOpportunities");
    if (!list) return;

    const all = window.procurementOpportunities || [];
    const filtered = all.filter(item =>
        (activeSupplier === "ALL" || item.supplier === activeSupplier) &&
        (activeMaterial === "ALL" || item.material === activeMaterial) &&
        (activePriority === "ALL" || item.priority === activePriority)
    );

    if (!filtered.length) {
        list.innerHTML = `<div class="opportunity-empty"><div><strong>${all.length ? "No matching opportunities" : "No procurement opportunities found"}</strong><span>${all.length ? "Try changing or clearing the selected filters." : "Upload purchasing data to surface potential savings."}</span></div></div>`;
        if (summary) summary.innerHTML = "";
        pagination?.classList.add("is-hidden");
        return;
    }

    const visible = filtered.slice(0, 5);
    const totalSavings = filtered.reduce((sum, item) => sum + (Number(item.saving) || 0), 0);
    const highCount = filtered.filter(item => item.priority === "HIGH").length;
    if (summary) {
        summary.innerHTML = `<span><strong>${filtered.length.toLocaleString("en-IN")}</strong> opportunities</span><span><strong>${formatCurrency(totalSavings)}</strong> potential savings</span><span><strong>${highCount}</strong> high priority</span>`;
    }

    list.innerHTML = visible.map((item, index) => {
        const id = `drawer-${Date.now()}-${index}`;
        return `
        <article class="opportunity opportunity-compact-row">
          <div class="opportunity-rank">${String(index + 1).padStart(2, "0")}</div>
          <div class="opportunity-main">
            <div class="opportunity-compact-title">
              <strong>${escapeHTML(item.material)} — ${escapeHTML(item.supplier)}</strong>
              <span class="priority ${item.priority.toLowerCase()}">${item.priority} PRIORITY</span>
            </div>
            <span class="opportunity-compact-meta">${item.variance.toFixed(1)}% above the lowest observed comparable price · ${item.confidence} confidence</span>
          </div>
          <div class="opportunity-compact-score"><span>Opportunity score</span><strong>${item.score}/100</strong><small>${item.confidence} confidence</small></div>
          <div class="opportunity-compact-saving"><span>Potential saving</span><strong>${formatCurrency(item.saving)}</strong><small>Requires validation</small></div>
          <button type="button" class="opportunity-review-btn" data-opportunity-review="${id}">Investigate <span>→</span></button>
          <div id="${id}" class="opportunity-review-data is-hidden"
            data-material="${escapeHTML(item.material)}" data-supplier="${escapeHTML(item.supplier)}" data-price="${item.price}" data-min-price="${item.minPrice}" data-quantity="${item.quantity}" data-saving="${item.saving}" data-variance="${item.variance}" data-priority="${escapeHTML(item.priority)}"></div>
        </article>`;
    }).join("");

    if (pagination && moreButton) {
        pagination.classList.toggle("is-hidden", filtered.length <= 5);
        moreButton.innerHTML = `View all opportunities <span>↓</span>`;
    }
}


document.addEventListener("click", event => {
    const reviewButton = event.target.closest("[data-opportunity-review]");
    if (!reviewButton) return;
    const source = document.getElementById(reviewButton.dataset.opportunityReview);
    if (!source) return;
    openOpportunityDrawer({
        material: source.dataset.material,
        supplier: source.dataset.supplier,
        price: Number(source.dataset.price),
        minPrice: Number(source.dataset.minPrice),
        quantity: Number(source.dataset.quantity),
        saving: Number(source.dataset.saving),
        variance: Number(source.dataset.variance),
        priority: source.dataset.priority
    });
});

function openOpportunityDrawer(item) {
    const drawer = document.getElementById("opportunityDrawer");
    if (!drawer) return;
    if (!drawer.querySelector("#drawerOpportunityTitle")) {
        drawer.innerHTML = `
          <div class="opportunity-drawer-backdrop" data-opportunity-drawer-close></div>
          <aside class="opportunity-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawerOpportunityTitle">
            <button class="opportunity-drawer-close" type="button" aria-label="Close" data-opportunity-drawer-close>×</button>
            <span class="section-kicker">INVESTIGATE OPPORTUNITY</span>
            <h2 id="drawerOpportunityTitle">Opportunity</h2>
            <p id="drawerOpportunitySupplier" class="drawer-subtitle"></p>
            <div class="drawer-priority-row"><span id="drawerOpportunityPriority" class="priority low">REVIEW</span><span>Potential savings — requires validation</span></div>
            <div class="drawer-financial"><span>Potential opportunity</span><strong id="drawerOpportunitySaving">₹0</strong></div>
            <div class="drawer-evidence-grid">
              <div><span>Current price</span><strong id="drawerPaidPrice">₹0/unit</strong></div>
              <div><span>Best observed</span><strong id="drawerBestPrice">₹0/unit</strong></div>
              <div><span>Variance</span><strong id="drawerVariance">+0%</strong></div>
              <div><span>Quantity</span><strong id="drawerQuantity">0</strong></div>
            </div>
            <div class="drawer-section"><span class="drawer-label">Possible reasons</span><p>Specification • freight • contract • quantity</p></div>
            <div class="drawer-section"><span class="drawer-label">Recommended action</span><p>Review recent POs and compare contract terms, quantity, freight and specification before approving a change.</p></div>
            <div class="drawer-section"><span class="drawer-label">What could explain the difference?</span><p id="drawerPossibleReasons">Specification, freight, contract terms, quantity or delivery conditions should be checked before action.</p></div>
          </aside>`;
    }
    drawer.dataset.material = item.material || "";
    drawer.dataset.supplier = item.supplier || "";
    drawer.dataset.price = item.price;
    drawer.dataset.minPrice = item.minPrice;
    drawer.dataset.quantity = item.quantity;
    const title = document.getElementById("drawerOpportunityTitle");
    const supplier = document.getElementById("drawerOpportunitySupplier");
    const priority = document.getElementById("drawerOpportunityPriority");
    const saving = document.getElementById("drawerOpportunitySaving");
    const paid = document.getElementById("drawerPaidPrice");
    const best = document.getElementById("drawerBestPrice");
    const variance = document.getElementById("drawerVariance");
    const quantity = document.getElementById("drawerQuantity");
    const ai = document.getElementById("drawerAIInsight");
    if (title) title.textContent = item.material || "Opportunity";
    if (supplier) supplier.textContent = `${item.supplier || "Unknown supplier"} · purchasing exception`;
    if (priority) { priority.textContent = item.priority || "REVIEW"; priority.className = `priority ${(item.priority || "low").toLowerCase()}`; }
    if (saving) saving.textContent = formatCurrency(item.saving);
    if (paid) paid.textContent = `${formatCurrency(item.price)}/unit`;
    if (best) best.textContent = `${formatCurrency(item.minPrice)}/unit`;
    if (variance) variance.textContent = `+${Number(item.variance || 0).toFixed(1)}%`;
    if (quantity) quantity.textContent = Number(item.quantity || 0).toLocaleString("en-IN");
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    aiButton?.focus();
}

window.procureIQOpenOpportunity = openOpportunityDrawer;

function closeOpportunityDrawer() {
    const drawer = document.getElementById("opportunityDrawer");
    drawer?.classList.remove("is-open");
    drawer?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

document.addEventListener("click", event => {
    if (event.target.closest("[data-opportunity-drawer-close]")) closeOpportunityDrawer();
});

document.addEventListener("keydown", event => { if (event.key === "Escape") closeOpportunityDrawer(); });



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

            Number(button.dataset.price),

            Number(button.dataset.minPrice),

            Number(button.dataset.quantity),

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


    if (!box) {
        console.error(
            "AI insight container not found:",
            id
        );
        return;
    }


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
                Some procurement values are missing or invalid.
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
            Reviewing the evidence…
        </p>
    `;


    try {

        const response =
            await procureiqApiFetch(
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


        let result = {};


        try {

            result =
                responseText
                    ? JSON.parse(responseText)
                    : {};

        } catch (error) {

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


        box.className = result.fallback ? "ai-insight ai-insight-fallback" : "ai-insight";

        box.innerHTML = `
            <div class="ai-insight-header">
                ${result.fallback ? "⚡ Procurement Verification Insight" : "🤖 AI Procurement Insight"}
            </div>
            ${result.notice ? `<p class="ai-fallback-note">${escapeHTML(result.notice)}</p>` : ""}

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

            Number(button.dataset.price),

            Number(button.dataset.minPrice),

            Number(button.dataset.quantity),

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


    /* Bold markdown */

    html =
        html.replace(
            /\*\*(.*?)\*\*/g,
            "<strong>$1</strong>"
        );


    /* Numbered headings */

    html =
        html.replace(
            /^(\d+\.\s+)(.+)$/gm,
            "<h4>$1$2</h4>"
        );


    /* Bullet points */

    html =
        html.replace(
            /^[\s]*[-*]\s+(.+)$/gm,
            '<div class="ai-bullet">• $1</div>'
        );


    /* New lines */

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
                    item => item.supplier
                )
            )
        ].sort();


    const materials =
        [
            ...new Set(
                opportunities.map(
                    item => item.material
                )
            )
        ].sort();


    supplierFilter.innerHTML =
        `<option value="ALL">All Suppliers</option>`;


    materialFilter.innerHTML =
        `<option value="ALL">All Materials</option>`;


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
        suppliers.includes(activeSupplier)
            ? activeSupplier
            : "ALL";


    materialFilter.value =
        materials.includes(activeMaterial)
            ? activeMaterial
            : "ALL";
}


/* =====================================================
   APPLY FILTERS
===================================================== */

function applyFilters() {

    visibleOpportunityCount = 5;
    activeSupplier =
        document.getElementById(
            "supplierFilter"
        )?.value || "ALL";


    activeMaterial =
        document.getElementById(
            "materialFilter"
        )?.value || "ALL";


    activePriority =
        document.getElementById(
            "priorityFilter"
        )?.value || "ALL";


    renderFilteredOpportunities();
}


/* =====================================================
   FILTER EVENTS
===================================================== */

document
    .getElementById("supplierFilter")
    ?.addEventListener(
        "change",
        applyFilters
    );


document
    .getElementById("materialFilter")
    ?.addEventListener(
        "change",
        applyFilters
    );


document
    .getElementById("priorityFilter")
    ?.addEventListener(
        "change",
        applyFilters
    );


/* =====================================================
   CLEAR FILTERS
===================================================== */

document
    .getElementById("clearFilters")
    ?.addEventListener(
        "click",
        () => {

            visibleOpportunityCount = 5;
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
                supplierFilter.value = "ALL";
            }


            if (materialFilter) {
                materialFilter.value = "ALL";
            }


            if (priorityFilter) {
                priorityFilter.value = "ALL";
            }


            renderFilteredOpportunities();
        }
    );


document.getElementById("showMoreOpportunities")?.addEventListener("click", () => {
    const modal = document.getElementById("opportunityModal");
    const modalList = document.getElementById("opportunityModalList");
    const modalCount = document.getElementById("opportunityModalCount");
    const filtered = (window.procurementOpportunities || []).filter(item =>
        (activeSupplier === "ALL" || item.supplier === activeSupplier) &&
        (activeMaterial === "ALL" || item.material === activeMaterial) &&
        (activePriority === "ALL" || item.priority === activePriority)
    );
    if (!modal || !modalList) return;
    if (modalCount) modalCount.textContent = `${filtered.length.toLocaleString("en-IN")} opportunities`;
    modalList.innerHTML = filtered.map((item, index) => {
        const id = `modal-ai-${Date.now()}-${index}`;
        return `<article class="opportunity-modal-row"><div class="opportunity-modal-main"><div class="opportunity-modal-title"><strong>${escapeHTML(item.material)}</strong><span class="priority ${item.priority.toLowerCase()}">${item.priority}</span></div><span>${escapeHTML(item.supplier)} · ${Number(item.quantity).toLocaleString("en-IN")} units · ${item.variance.toFixed(1)}% variance</span></div><strong class="opportunity-modal-saving">${formatCurrency(item.saving)}</strong><button type="button" class="more-toggle opportunity-modal-details-btn" data-modal-detail="${id}">Details <span>⌄</span></button><div id="${id}" class="opportunity-modal-detail">Paid ${formatCurrency(item.price)}/unit vs ${formatCurrency(item.minPrice)}/unit lowest observed. Verify contract, specification, quantity, freight and delivery terms before action.</div></article>`;
    }).join("");
    modal.classList.add("is-open"); modal.setAttribute("aria-hidden","false"); document.body.classList.add("modal-open");
});

document.addEventListener("click", event => {
    const close = event.target.closest("[data-opportunity-close]");
    if (close) { const modal=document.getElementById("opportunityModal"); modal?.classList.remove("is-open"); modal?.setAttribute("aria-hidden","true"); document.body.classList.remove("modal-open"); return; }
    const detailBtn = event.target.closest("[data-modal-detail]");
    if (detailBtn) { const target=document.getElementById(detailBtn.dataset.modalDetail); const open=target?.classList.toggle("is-open"); detailBtn.innerHTML=open ? 'Hide details <span>⌃</span>' : 'Details <span>⌄</span>'; }
});



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
            cleanNumber(item.quantity) || 0;


        const price =
            cleanNumber(item.price) || 0;


        const spend =
            quantity * price;


        if (!suppliers[supplier]) {

            suppliers[supplier] = {

                spend: 0,
                transactions: 0
            };
        }


        suppliers[supplier].spend += spend;

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
            cleanNumber(item.quantity) || 0;


        const price =
            cleanNumber(item.price) || 0;


        const spend =
            quantity * price;


        if (!materials[material]) {

            materials[material] = {

                spend: 0,
                quantity: 0,
                transactions: 0
            };
        }


        materials[material].spend += spend;

        materials[material].quantity += quantity;

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
   SPEND PIE CHARTS (Supplier + Material)
   A single shared renderer draws a real doughnut chart via
   Chart.js plus a readable legend list (name, amount, %).
   Long tails are grouped into "Other" so the chart and
   legend both stay easy to scan at a glance.
===================================================== */

const PIE_COLORS = ["#2F6FED", "#00B894", "#F5A623", "#E6564C", "#8E6FF7", "#17B5C9", "#F06BA8", "#6C7A93"];
const pieChartInstances = {};

function groupSpendByKey(rows, keyFn, fallbackLabel) {
    const totals = {};
    rows.forEach(item => {
        const key = String(keyFn(item) || fallbackLabel).trim() || fallbackLabel;
        const spend = (cleanNumber(item.quantity) || 0) * (cleanNumber(item.price) || 0);
        totals[key] = (totals[key] || 0) + spend;
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

function renderSpendPieChart({ canvasId, legendId, containerId, rows, keyFn, fallbackLabel, emptyMessage, maxSlices = 6 }) {
    const container = document.getElementById(containerId);
    const canvas = document.getElementById(canvasId);
    const legend = document.getElementById(legendId);
    if (!container || !legend) return;

    if (!rows.length) {
        canvas && canvas.classList.add("is-hidden");
        legend.innerHTML = `<p class="empty-message">${escapeHTML(emptyMessage)}</p>`;
        return;
    }
    canvas && canvas.classList.remove("is-hidden");

    const sorted = groupSpendByKey(rows, keyFn, fallbackLabel);
    const totalSpend = sorted.reduce((sum, [, v]) => sum + v, 0);

    let slices = sorted.slice(0, maxSlices);
    const rest = sorted.slice(maxSlices);
    if (rest.length) {
        const restTotal = rest.reduce((sum, [, v]) => sum + v, 0);
        slices = [...slices, [`Other (${rest.length})`, restTotal]];
    }

    const labels = slices.map(([label]) => label);
    const values = slices.map(([, value]) => value);
    const colors = slices.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]);

    if (canvas && window.Chart) {
        if (pieChartInstances[canvasId]) pieChartInstances[canvasId].destroy();
        pieChartInstances[canvasId] = new Chart(canvas, {
            type: "doughnut",
            data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: "#ffffff", borderWidth: 2 }] },
            options: {
                responsive: false,
                cutout: "62%",
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.parsed)}` } }
                }
            }
        });
    } else if (canvas) {
        canvas.classList.add("is-hidden");
    }

    legend.innerHTML = slices.map(([label, spend], i) => {
        const pct = totalSpend > 0 ? (spend / totalSpend) * 100 : 0;
        return `
            <div class="pie-legend-row">
                <span class="pie-legend-swatch" style="background:${colors[i]}"></span>
                <span class="pie-legend-name">${escapeHTML(label)}</span>
                <span class="pie-legend-value">${formatCurrency(spend)}</span>
                <span class="pie-legend-pct">${pct.toFixed(1)}%</span>
            </div>
        `;
    }).join("");
}

function showSupplierChart() {
    renderSpendPieChart({
        canvasId: "supplierPieCanvas",
        legendId: "supplierPieLegend",
        containerId: "supplierChart",
        rows: data,
        keyFn: item => item.supplier,
        fallbackLabel: "Unknown Supplier",
        emptyMessage: "No supplier data available."
    });
}

function showMaterialChart() {
    renderSpendPieChart({
        canvasId: "materialPieCanvas",
        legendId: "materialPieLegend",
        containerId: "materialChart",
        rows: data,
        keyFn: item => item.material,
        fallbackLabel: "Unknown Material",
        emptyMessage: "No material data available."
    });
}




window.procureIQRefreshV18Overview = function(){
  const opps = Array.isArray(window.procurementOpportunities) ? window.procurementOpportunities : [];
  const el=document.getElementById("v18HighPriority"); if(el) el.textContent=opps.filter(o=>o.priority==="HIGH").length.toLocaleString("en-IN");
  window.procureIQSyncReportSummary?.();
};
window.addEventListener("procureiq:data-updated", window.procureIQRefreshV18Overview);

/* V19 — dedicated Price Variance analytics table. Uses the same deterministic
   benchmark logic as the opportunity engine; no market price is invented. */
(function initV19PriceVariance(){
  function render(){
    const box=document.getElementById("v19PriceVariance");
    const summary=document.getElementById("v19VarianceSummary");
    if(!box) return;
    const rows=Array.isArray(window.data)?window.data:[];
    if(!rows.length){
      box.innerHTML='<tr><td colspan="6"><div class="empty-message">Upload procurement data to calculate price variance.</div></td></tr>';
      if(summary) summary.textContent='No analysis loaded';
      return;
    }
    const groups=new Map();
    rows.forEach(r=>{
      const material=String(r.material||'Unknown material').trim();
      const price=Number(r.price)||0; const qty=Number(r.quantity)||0;
      if(price<=0) return;
      const arr=groups.get(material)||[]; arr.push({material,supplier:String(r.supplier||'Unknown supplier').trim(),price,qty}); groups.set(material,arr);
    });
    const items=[];
    groups.forEach(arr=>{
      const min=Math.min(...arr.map(x=>x.price));
      arr.forEach(x=>{ if(x.price>min){ const variance=min>0?((x.price-min)/min)*100:0; items.push({...x,min,variance,saving:Math.max(0,(x.price-min)*x.qty)}); }});
    });
    items.sort((a,b)=>b.saving-a.saving);
    const visible=items.slice(0,10);
    if(!visible.length){
      box.innerHTML='<tr><td colspan="6"><div class="empty-message">No price variance exceptions were detected in the current dataset.</div></td></tr>';
      if(summary) summary.textContent=`${rows.length.toLocaleString("en-IN")} transactions analyzed · no internal price exception detected`;
      return;
    }
    box.innerHTML=visible.map(x=>{
      const cls=x.variance>=20?'variance-high':x.variance>=10?'variance-mid':'';
      return `<tr><td>${escapeHTML(x.material)}</td><td>${escapeHTML(x.supplier)}</td><td>${formatCurrency(x.price)}</td><td>${formatCurrency(x.min)}</td><td class="${cls}">+${x.variance.toFixed(1)}%</td><td class="saving">${formatCurrency(x.saving)}</td></tr>`;
    }).join('');
    const total=items.reduce((a,x)=>a+x.saving,0);
    if(summary) summary.textContent=`${items.length.toLocaleString("en-IN")} price exceptions · ${formatCurrency(total)} potential savings · internal benchmark only`;
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(render,450));
  window.addEventListener('procureiq:data-updated',render);
  setInterval(render,1800);
})();
/* =====================================================
   START APPLICATION
===================================================== */

// Clerk must be ready before protected API calls are made.
window.procureIQOnAuthStateChange = function (signedIn) {
    window.procureIQRefreshAuthUI?.();
    if (signedIn) {
        // Clear stale pre-auth warnings and refresh protected data.
        document.querySelectorAll("#uploadStatus, #dashboardInquiryStatus").forEach(el => {
            if (/sign in to continue/i.test(el.textContent || "")) el.textContent = "";
        });
        loadDatabaseData();
        window.procureIQLoadAIUsage?.();
    } else {
        window.procureIQLoadAIUsage?.();
    }
};

document.addEventListener(
    "DOMContentLoaded",
    async () => {
        console.log("✅ ProcureIQ frontend loaded successfully.");
        setupUploadUX();
        window.procureIQInitReports?.();
        const auth = await window.procureIQAuthReady;
        if (auth?.isSignedIn) {
            await loadDatabaseData();
            await window.procureIQLoadAIUsage?.();
        } else {
            window.procureIQRefreshAuthUI?.();
        }
    }
);


/* =====================================================
   REPORTS + INQUIRIES
   Local PDF generation; no report data is sent to Gemini.
===================================================== */
(function setupReportsAndForms() {
    const STORAGE_KEY = "procureiq_report_history_v2";
    const MAX_HISTORY = 8;

    function getHistory() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) { return []; }
    }

    function saveHistory(items) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); }
        catch (error) { console.warn("Could not save report history:", error); }
    }

    function buildReportSnapshot() {
        const opportunities = (window.procurementOpportunities || []).slice(0, 50).map(item => ({
            material: item.material, supplier: item.supplier, price: Number(item.price) || 0,
            minPrice: Number(item.minPrice) || 0, quantity: Number(item.quantity) || 0,
            saving: Number(item.saving) || 0, variance: Number(item.variance) || 0, priority: item.priority,
            date: item.transaction_date || item.date || ""
        }));
        const totalSpend = data.reduce((sum, row) => sum + (cleanNumber(row.quantity)||0) * (cleanNumber(row.price)||0), 0);
        const totalSavings = (window.procurementOpportunities || []).reduce((sum, row) => sum + (Number(row.saving) || 0), 0);
        const transactions = data.map(row => ({
            date: row.transaction_date || row.date || row.created_at || "",
            material: row.material || "", supplier: row.supplier || "",
            quantity: Number(row.quantity) || 0, price: Number(row.price) || 0,
            total: (Number(row.quantity) || 0) * (Number(row.price) || 0)
        }));
        const dates = transactions.map(t => new Date(t.date)).filter(d => !Number.isNaN(d.getTime()));
        return {
            source: selectedFile?.name || "PostgreSQL procurement data",
            createdAt: new Date().toISOString(),
            transactions: data.length,
            totalSpend,
            totalSavings,
            opportunityCount: (window.procurementOpportunities || []).length,
            opportunities,
            transactionLog: transactions,
            periodStart: dates.length ? new Date(Math.min(...dates.map(d=>d.getTime()))).toISOString() : "",
            periodEnd: dates.length ? new Date(Math.max(...dates.map(d=>d.getTime()))).toISOString() : ""
        };
    }

    function syncSummary(snapshot = buildReportSnapshot()) {
        const scope = document.getElementById("reportScope");
        const savings = document.getElementById("reportSavings");
        const count = document.getElementById("reportOpportunityCount");
        const button = document.getElementById("downloadReportBtn");
        if (scope) scope.textContent = data.length ? `${snapshot.transactions.toLocaleString("en-IN")} transactions` : "No analysis loaded";
        if (savings) savings.textContent = formatCurrency(snapshot.totalSavings);
        if (count) count.textContent = Number(snapshot.opportunityCount || 0).toLocaleString("en-IN");
        if (button) button.disabled = !data.length;
    }

    function renderHistory() {
        const container = document.getElementById("reportsHistory");
        if (!container) return;
        const history = getHistory();
        const clearButton = document.getElementById("clearReportsHistoryBtn");
        if (clearButton) clearButton.disabled = !history.length;
        if (!history.length) {
            container.innerHTML = '<p class="empty-message">No reports generated yet. Generate a PDF report to create history.</p>';
            return;
        }
        container.innerHTML = history.map((item, index) => `
            <div class="report-history-item">
                <div class="report-history-main">
                    <strong>${escapeHTML(item.source || "Procurement report")}</strong>
                    <span>${new Date(item.createdAt).toLocaleString("en-IN")} · ${Number(item.transactions||0).toLocaleString("en-IN")} transactions · ${formatCurrency(item.totalSavings)} potential savings</span>
                </div>
                <div class="report-history-actions">
                    <button type="button" data-report-download="${index}">Download</button>
                    <button type="button" data-report-delete="${index}">Remove</button>
                </div>
            </div>`).join("");
    }

    function drawReport(doc, snapshot) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 42;
        let y = 44;
        const navy = [7,27,58], blue = [23,105,255], muted = [102,120,146], green = [11,143,97];
        const money = value => `INR ${Number(value||0).toLocaleString("en-IN", {maximumFractionDigits: 2})}`;
        const ensureSpace = height => { if (y + height > pageHeight - 45) { doc.addPage(); y = 44; } };
        doc.setFont("helvetica", "bold"); doc.setTextColor(...navy); doc.setFontSize(22); doc.text("ProcureIQ", margin, y);
        doc.setFontSize(10); doc.setTextColor(...muted); doc.text("PROCUREMENT INTELLIGENCE REPORT", margin, y + 17);
        doc.setFont("helvetica", "normal"); doc.text(new Date(snapshot.createdAt).toLocaleString("en-IN"), pageWidth - margin, y + 4, {align:"right"});
        y += 48;
        if (snapshot.periodStart || snapshot.periodEnd) {
            const fmt = value => value ? new Date(value).toLocaleDateString("en-IN") : "—";
            doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...muted);
            doc.text(`Transaction period: ${fmt(snapshot.periodStart)} – ${fmt(snapshot.periodEnd)}`, margin, y);
            y += 18;
        }
        doc.setFillColor(247,249,252); doc.roundedRect(margin, y, pageWidth-2*margin, 78, 10, 10, "F");
        const cards = [["TOTAL SPEND", money(snapshot.totalSpend)], ["TRANSACTIONS", String(snapshot.transactions)], ["OPPORTUNITIES", String(snapshot.opportunityCount)], ["POTENTIAL SAVINGS", money(snapshot.totalSavings)]];
        const cardW=(pageWidth-2*margin-24)/4;
        cards.forEach((c,i)=>{ const x=margin+i*(cardW+8); doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(c[0],x+10,y+20); doc.setFontSize(13); doc.setTextColor(...navy); doc.text(c[1],x+10,y+43); });
        y += 100;
        doc.setFont("helvetica","bold"); doc.setFontSize(14); doc.setTextColor(...navy); doc.text("Top savings opportunities", margin, y); y += 18;
        doc.setFont("helvetica","bold"); doc.setFontSize(8); doc.setTextColor(...muted);
        doc.text("DATE",margin,y); doc.text("MATERIAL",margin+55,y); doc.text("SUPPLIER",margin+165,y); doc.text("PAID",margin+270,y); doc.text("BENCHMARK",margin+300,y); doc.text("VARIANCE",margin+370,y); doc.text("POTENTIAL SAVING",margin+435,y);
        y += 10;
        doc.setFont("helvetica","normal"); doc.setFontSize(8);
        snapshot.opportunities.slice(0,10).forEach(item=>{
            ensureSpace(22); doc.setDrawColor(228,234,242); doc.line(margin,y+7,pageWidth-margin,y+7);
            doc.setTextColor(...navy); doc.text(item.date ? new Date(item.date).toLocaleDateString("en-IN") : "—",margin,y); doc.text(doc.splitTextToSize(String(item.material),100)[0],margin+55,y); doc.text(doc.splitTextToSize(String(item.supplier),95)[0],margin+165,y);
            doc.text(money(item.price),margin+270,y); doc.text(money(item.minPrice),margin+325,y); doc.text(`${Number(item.variance||0).toFixed(1)}%`,margin+395,y); doc.setTextColor(...green); doc.text(money(item.saving),margin+455,y); doc.setTextColor(...navy); y+=20;
        });
        y += 16; ensureSpace(100);
        doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.setTextColor(...navy); doc.text("Transaction timeline", margin, y); y += 16;
        doc.setFontSize(8); doc.setTextColor(...muted); doc.text("DATE", margin, y); doc.text("MATERIAL", margin+65, y); doc.text("SUPPLIER", margin+190, y); doc.text("QTY", margin+330, y); doc.text("UNIT PRICE", margin+380, y); y += 10;
        doc.setFont("helvetica","normal");
        (snapshot.transactionLog || []).forEach((row, idx) => {
            ensureSpace(18);
            doc.setTextColor(...navy);
            const date = row.date ? new Date(row.date).toLocaleDateString("en-IN") : "—";
            doc.text(date, margin, y); doc.text(doc.splitTextToSize(String(row.material),115)[0], margin+65, y); doc.text(doc.splitTextToSize(String(row.supplier),125)[0], margin+190, y); doc.text(String(row.quantity), margin+330, y); doc.text(money(row.price), margin+380, y); y += 16;
        });
        y += 8;
        y += 12; ensureSpace(70); doc.setFont("helvetica","bold"); doc.setFontSize(12); doc.text("Verification note",margin,y); y+=15; doc.setFont("helvetica","normal"); doc.setFontSize(9); doc.setTextColor(...muted);
        const note="A price difference is a review signal, not proof of an incorrect purchase. Validate contract terms, quality/specification, quantity/volume, freight and delivery conditions before taking action.";
        doc.splitTextToSize(note,pageWidth-2*margin).forEach(line=>{doc.text(line,margin,y);y+=13;});
        doc.setFontSize(7); doc.setTextColor(130,142,160); doc.text("Generated by ProcureIQ • Calculations are based on the analyzed purchasing data.",margin,pageHeight-25);
    }

    function loadJsPDF() {
        return new Promise((resolve, reject) => {
            if (window.jspdf?.jsPDF) return resolve();
            const existing = document.querySelector('script[data-procureiq-jspdf]');
            if (existing) {
                existing.addEventListener("load", () => resolve(), { once: true });
                existing.addEventListener("error", () => reject(new Error("Unable to load the PDF engine.")), { once: true });
                return;
            }
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
            script.async = true;
            script.dataset.procureiqJspdf = "true";
            script.onload = () => window.jspdf?.jsPDF ? resolve() : reject(new Error("PDF engine loaded incorrectly."));
            script.onerror = () => reject(new Error("Unable to load the PDF engine. Check your internet connection and try again."));
            document.head.appendChild(script);
        });
    }

    async function generatePDF(snapshot, shouldSave=true) {
        await loadJsPDF();
        const doc = new window.jspdf.jsPDF({unit:"pt",format:"a4"});
        drawReport(doc,snapshot);
        const safe = String(snapshot.source||"procurement").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").slice(0,45) || "procurement";
        const stamp = new Date(snapshot.createdAt).toISOString().slice(0,10);
        doc.save(`ProcureIQ-Report-${safe}-${stamp}.pdf`);
        if (shouldSave) { const history=getHistory(); history.unshift(snapshot); saveHistory(history); renderHistory(); }
        return true;
    }

    window.procureIQSyncReportSummary = syncSummary;
    window.procureIQInitReports = () => { syncSummary(); renderHistory(); };

    document.getElementById("downloadReportBtn")?.addEventListener("click",async()=>{
        const button = document.getElementById("downloadReportBtn");
        if (!data.length) { alert("Analyze procurement data first."); return; }
        try {
            button.disabled = true;
            button.innerHTML = "Generating PDF…";
            await generatePDF(buildReportSnapshot(), true);
        } catch(error) {
            console.error(error);
            alert(error.message || "Unable to generate PDF report.");
        } finally {
            button.innerHTML = "Download PDF Report <span>↓</span>";
            syncSummary();
        }
    });
    document.getElementById("clearReportsHistoryBtn")?.addEventListener("click",()=>{
        if (!getHistory().length) return;
        if (confirm("Clear all saved report history from this browser?")) { saveHistory([]); renderHistory(); }
    });
    document.getElementById("reportsHistory")?.addEventListener("click",event=>{
        const download=event.target.closest("[data-report-download]");
        const remove=event.target.closest("[data-report-delete]");
        const index=download ? Number(download.dataset.reportDownload) : remove ? Number(remove.dataset.reportDelete) : -1;
        if (index<0) return;
        const history=getHistory(); const item=history[index]; if(!item) return;
        if(download){ generatePDF(item,false).catch(error=>alert(error.message||"Unable to generate PDF report.")); }
        if(remove){ history.splice(index,1); saveHistory(history); renderHistory(); }
    });

    function wireInquiry(formId, endpoint, statusId) {
        const form=document.getElementById(formId); const status=document.getElementById(statusId); if(!form) return;
        form.addEventListener("submit",async event=>{
            event.preventDefault(); const button=form.querySelector("button[type=submit]"); const payload=Object.fromEntries(new FormData(form).entries());
            if(status) status.textContent="Sending inquiry…"; if(button) button.disabled=true;
            try{
                const response=await (endpoint.includes("public") ? fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)}) : procureiqApiFetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)}));
                const result=await response.json().catch(()=>({})); if(!response.ok) throw new Error(result.error||"Unable to submit inquiry.");
                if(status) status.textContent="✓ Thank you. Your inquiry has been sent successfully."; form.reset();
            }catch(error){if(status) status.textContent=error.message||"Unable to submit inquiry.";}
            finally{if(button) button.disabled=false;}
        });
    }
    wireInquiry("inquiryForm","/api/public-inquiries","inquiryStatus");
    wireInquiry("dashboardInquiryForm","/api/inquiries","dashboardInquiryStatus");
})();

/* =====================================================
   RAZORPAY PLAN DETAILS + STANDARD WEB CHECKOUT
===================================================== */

(function setupRazorpayCheckout() {
    const buttons = document.querySelectorAll("[data-razorpay-plan]");
    const paymentStatus = document.getElementById("paymentStatus");
    const dashboardStatus = document.querySelector("[data-dashboard-payment-status]");
    const modal = document.getElementById("planDetailsModal");
    const planTitle = document.getElementById("planDetailsTitle");
    const planIntro = document.getElementById("planDetailsIntro");
    const planLabel = document.getElementById("planDetailsLabel");
    const planPrice = document.getElementById("planDetailsPrice");
    const planWhy = document.getElementById("planDetailsWhy");
    const planBenefits = document.getElementById("planDetailsBenefits");
    const continueButton = document.getElementById("continuePlanCheckout");
    let selectedPlan = null;

    const planDetails = {
        starter: { label: "STARTER", price: "₹999", title: "Starter — practical procurement intelligence", intro: "A focused starting point for teams that want to find price differences and savings opportunities without a complex procurement system.", why: "Why choose Starter?", benefits: ["CSV and Excel purchasing-data analysis", "Price variance and potential-savings detection", "Supplier and material analysis", "Core reports and analysis history", "Higher AI usage than the Free plan"] },
        business: { label: "BUSINESS · POPULAR", price: "₹2,999", title: "Business — deeper intelligence for growing teams", intro: "Designed for procurement and finance teams that need stronger supplier, material and investigation intelligence across more data.", why: "Why choose Business?", benefits: ["Everything in Starter", "Advanced supplier and material intelligence", "Supplier scorecards and material benchmarking", "Historical analysis and richer reporting", "Higher AI usage for regular investigation workflows"] },
        pro: { label: "PRO", price: "₹7,999", title: "Pro — advanced procurement intelligence", intro: "Built for higher-volume teams that want deeper analysis, advanced AI support and a stronger procurement decision layer.", why: "Why choose Pro?", benefits: ["Everything in Business", "Advanced AI decision support", "Price trends and deeper analytics", "Higher-volume analysis workflows", "Priority-ready foundation for API and enterprise capabilities"] }
    };

    function setPaymentStatus(message, isError = false) {
        if (paymentStatus) { paymentStatus.textContent = message; paymentStatus.style.color = isError ? "#b42318" : ""; }
        if (dashboardStatus) { dashboardStatus.textContent = message; dashboardStatus.style.color = isError ? "#b42318" : ""; }
    }

    function closePlanModal() {
        if (!modal) return;
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
        selectedPlan = null;
    }

    function openPlanModal(plan) {
        const details = planDetails[plan];
        if (!details || !modal) return;
        selectedPlan = plan;
        if (planTitle) planTitle.textContent = details.title;
        if (planIntro) planIntro.textContent = details.intro;
        if (planLabel) planLabel.textContent = details.label;
        if (planPrice) planPrice.textContent = details.price;
        if (planWhy) planWhy.textContent = details.why;
        if (planBenefits) planBenefits.innerHTML = details.benefits.map(item => `<li>${item}</li>`).join("");
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
        continueButton?.focus();
    }

    modal?.addEventListener("click", event => {
        if (event.target.closest("[data-plan-close]")) closePlanModal();
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") closePlanModal(); });

    async function startPayment(plan, clickedButton) {
        if (!window.procureiqApiFetch) {
            setPaymentStatus("Authentication is still loading. Please try again.", true);
            return;
        }
        if (!window.procureIQClerk?.isSignedIn) {
            setPaymentStatus("Please sign in first to continue to secure checkout.", true);
            window.procureIQOpenSignIn?.();
            return;
        }

        const button = clickedButton || document.querySelector(`[data-razorpay-plan="${plan}"]`);
        if (button) {
            button.disabled = true;
            button.dataset.originalText = button.innerHTML;
            button.innerHTML = "Preparing payment…";
        }

        try {
            setPaymentStatus("Creating a secure payment order…");
            const response = await procureiqApiFetch("/api/create-order", {
                method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify({ plan })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "Unable to create payment order.");
            if (!window.Razorpay) throw new Error("Razorpay Checkout failed to load. Refresh the page and try again.");

            const options = {
                key: result.key_id, amount: result.amount, currency: result.currency, name: "ProcureIQ", description: result.plan_name, order_id: result.order_id, theme: { color: "#071B3A" },
                handler: async function (payment) {
                    try {
                        setPaymentStatus("Verifying payment securely…");
                        const verifyResponse = await procureiqApiFetch("/api/verify-payment", { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(payment) });
                        const verification = await verifyResponse.json().catch(() => ({}));
                        if (!verifyResponse.ok || !verification.success) throw new Error(verification.error || "Payment verification failed.");
                        setPaymentStatus(`✓ Payment verified. ${String(verification.plan || plan).toUpperCase()} is now active for 30 days.`);
                        window.procureIQLoadAIUsage?.();
                    } catch (error) { console.error("Payment verification error:", error); setPaymentStatus(error.message || "Payment verification failed.", true); }
                },
                modal: { ondismiss: function () { setPaymentStatus("Payment window closed. No payment was confirmed."); } }
            };
            const razorpay = new window.Razorpay(options);
            razorpay.on("payment.failed", event => { console.error("Razorpay payment failed:", event?.error); setPaymentStatus(event?.error?.description || "Payment failed. Please try again.", true); });
            razorpay.open();
        } catch (error) { console.error("Razorpay checkout error:", error); setPaymentStatus(error.message || "Unable to start payment.", true); }
        finally {
            if (button) { button.disabled = false; button.innerHTML = button.dataset.originalText || "Choose plan →"; }
        }
    }

    buttons.forEach(button => {
        button.addEventListener("click", event => {
            event.preventDefault();
            openPlanModal(button.dataset.razorpayPlan);
        });
    });
    continueButton?.addEventListener("click", () => {
        const plan = selectedPlan;
        closePlanModal();
        if (plan) startPayment(plan, document.querySelector(`[data-razorpay-plan="${plan}"]`));
    });
})();

/* =====================================================
   COMPACT ANALYTICS + AI USAGE + ASSISTANT + REVIEWS
===================================================== */
(function setupProductEnhancements() {
    document.addEventListener("click", event => {
        const toggle = event.target.closest(".more-toggle");
        if (!toggle) return;
        const target = document.getElementById(toggle.dataset.target);
        if (!target) return;
        const collapsed = target.classList.toggle("is-collapsed");
        toggle.setAttribute("aria-expanded", String(!collapsed));
        const moreLabel = toggle.dataset.labelMore || "More";
        const lessLabel = toggle.dataset.labelLess || "Less";
        toggle.innerHTML = collapsed ? `${moreLabel} <span>⌄</span>` : `${lessLabel} <span>⌃</span>`;
    });

    async function loadAIUsage() {
        const text = document.getElementById("usageText");
        const remaining = document.getElementById("usageRemaining");
        const progress = document.getElementById("usageProgress");
        const plan = document.getElementById("usagePlanLabel");
        const signedIn = Boolean(window.procureIQClerk?.isSignedIn);
        if (!signedIn) {
            if (text) text.textContent = "Sign in to see your AI allowance and usage.";
            if (remaining) remaining.textContent = "Sign in required";
            if (plan) plan.textContent = "Free plan";
            if (progress) progress.style.width = "0%";
            return;
        }
        try {
            const response = await procureiqApiFetch("/api/usage", { headers: { Accept: "application/json" } });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "Unable to load usage.");
            const used = Number(result.tokens_used) || 0;
            const limit = Number(result.token_limit) || 0;
            const left = Math.max(0, limit - used);
            const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
            if (text) text.textContent = `${used.toLocaleString("en-IN")} of ${limit.toLocaleString("en-IN")} AI tokens used today`;
            if (remaining) remaining.textContent = `${left.toLocaleString("en-IN")} left`;
            if (plan) plan.textContent = `${String(result.plan || "Free").replace(/^./, x => x.toUpperCase())} plan`;
            const planName = String(result.plan || "Free").replace(/^./, x => x.toUpperCase());
            const planLabel = `${planName} plan`;
            window.procureIQUpdateAccountIdentity?.(planLabel);
            const sidebarPlan = document.getElementById("sidebarPlanLabel");
            const sidebarPlanMeta = document.getElementById("sidebarPlanMeta");
            if (sidebarPlan) sidebarPlan.textContent = planName;
            if (sidebarPlanMeta) sidebarPlanMeta.textContent = planName.toLowerCase() === "free" ? "AI tokens today" : "AI tokens remaining";
            const sidebarRemaining = document.getElementById("sidebarAiRemaining");
            if (sidebarRemaining) sidebarRemaining.textContent = left.toLocaleString("en-IN");
            const sidebarProgress = document.getElementById("sidebarAiProgress");
            if (sidebarProgress) sidebarProgress.style.width = `${limit ? Math.min(100, Math.max(0, (left / limit) * 100)) : 0}%`;
            const tokensEl = document.getElementById("settingsTokens");
            if (tokensEl) tokensEl.textContent = `${limit.toLocaleString("en-IN")} tokens/day`;
            const policy = document.getElementById("usagePolicyText");
            if (policy) policy.textContent = String(result.plan || "free").toLowerCase() === "free" ? `Free access · first ${Number(result.free_user_cap || 50)} workspaces · ${Number(result.token_limit || 200).toLocaleString("en-IN")} AI tokens/day` : "Higher AI allowance on your paid plan";

            if (progress) progress.style.width = `${pct.toFixed(1)}%`;
        } catch (error) {
            if (text) text.textContent = "Usage information is temporarily unavailable.";
            if (remaining) remaining.textContent = "—";
        }
    }
    window.procureIQLoadAIUsage = loadAIUsage;

    document.getElementById("resetDataBtn")?.addEventListener("click", async () => {
        if (!window.procureIQClerk?.isSignedIn) return alert("Please sign in first.");
        if (!confirm("Reset all saved procurement data? This removes your saved transactions and clears the current analysis.")) return;
        const button = document.getElementById("resetDataBtn");
        if (button) { button.disabled = true; button.textContent = "Resetting…"; }
        try {
            const response = await procureiqApiFetch("/api/reset-data", { method:"POST", headers:{Accept:"application/json"} });
            const result = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(result.error || "Unable to reset data.");
            data = []; selectedFile = null;
            window.procurementOpportunities = [];
            activeSupplier = "ALL"; activeMaterial = "ALL"; activePriority = "ALL"; visibleOpportunityCount = 5;
            document.getElementById("supplierFilter") && (document.getElementById("supplierFilter").value = "ALL");
            document.getElementById("materialFilter") && (document.getElementById("materialFilter").value = "ALL");
            document.getElementById("priorityFilter") && (document.getElementById("priorityFilter").value = "ALL");
            try { localStorage.removeItem("procureiq_report_history_v2"); } catch (_) {}
            window.procureIQInitReports?.();
            const file = document.getElementById("csvFile"); if (file) file.value = "";
            const name = document.getElementById("fileName"); if (name) name.textContent = "Choose CSV / Excel / PDF file";
            analyzeData(); window.procureIQSyncReportSummary?.();
            window.procureIQLoadAIUsage?.();
            const statusEl = document.getElementById("uploadStatus"); if (statusEl) statusEl.textContent = `✓ Reset complete. ${Number(result.deleted||0).toLocaleString("en-IN")} saved transaction(s) removed.`;
        } catch (error) { alert(error.message || "Unable to reset data."); }
        finally { if (button) { button.disabled = false; button.textContent = "Reset all data"; } }
    });


    const chatForm = document.getElementById("chatForm");
    const chatInput = document.getElementById("chatInput");
    const chatMessages = document.getElementById("chatMessages");
    chatForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const question = chatInput?.value.trim();
        if (!question) return;
        appendChat("user", question);
        chatInput.value = "";
        const pending = appendChat("assistant", "Thinking…");
        const summary = { transactions: data.length, opportunities: (window.procurementOpportunities || []).length };
        try {
            const response = await procureiqApiFetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ question, context: summary }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (result.upgrade_required) { window.procureIQNavigate?.("billing", true); }
                throw new Error(result.error || "Assistant is unavailable.");
            }
            pending.querySelector("span").textContent = result.answer || "I could not generate an answer.";
            loadAIUsage();
        } catch (error) {
            pending.querySelector("span").textContent = error.message || "Assistant is temporarily unavailable.";
        }
    });
    function appendChat(role, message) {
        const item = document.createElement("div");
        item.className = `chat-message ${role}`;
        const label = document.createElement("strong"); label.textContent = role === "user" ? "You" : "ProcureIQ Assistant";
        const body = document.createElement("span"); body.textContent = message;
        item.append(label, body); chatMessages?.appendChild(item); chatMessages?.scrollTo({ top: chatMessages.scrollHeight, behavior: "smooth" });
        return item;
    }

    const reviewForm = document.getElementById("reviewForm");
    const ratingInput = document.getElementById("reviewRating");
    const ratingLabel = document.getElementById("ratingLabel");
    const ratingLabels = { 1: "Poor", 2: "Needs improvement", 3: "Okay", 4: "Good", 5: "Excellent" };
    const ratingStars = [...document.querySelectorAll(".rating-star")];
    function setRating(value) {
        const rating = Number(value) || 0;
        if (ratingInput) ratingInput.value = rating ? String(rating) : "";
        if (ratingLabel) ratingLabel.textContent = rating ? `${rating}/5 — ${ratingLabels[rating]}` : "Select a rating";
        ratingStars.forEach(star => {
            const active = Number(star.dataset.rating) <= rating;
            star.classList.toggle("is-selected", active);
            star.setAttribute("aria-checked", active && Number(star.dataset.rating) === rating ? "true" : "false");
        });
    }
    ratingStars.forEach(star => star.addEventListener("click", () => setRating(star.dataset.rating)));
    reviewForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const status = document.getElementById("reviewStatus");
        const button = reviewForm.querySelector("button[type=submit]");
        const payload = Object.fromEntries(new FormData(reviewForm).entries());
        if (!payload.rating) { if (status) status.textContent = "Please select a star rating first."; return; }
        if (!window.procureIQClerk?.isSignedIn) { if (status) status.textContent = "Please sign in to submit feedback."; window.procureIQOpenSignIn?.(); return; }
        if (status) status.textContent = "Submitting feedback…";
        if (button) button.disabled = true;
        try {
            const response = await procureiqApiFetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ rating: Number(payload.rating), review: payload.review }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "Unable to submit review.");
            if (status) status.textContent = "✓ Thank you — your rating and review were submitted for approval.";
            const thankYou = document.getElementById("reviewThankYou");
            if (thankYou) {
                thankYou.classList.add("is-visible");
                thankYou.setAttribute("aria-hidden", "false");
                window.setTimeout(() => {
                    thankYou.classList.remove("is-visible");
                    thankYou.setAttribute("aria-hidden", "true");
                }, 7000);
            }
            reviewForm.reset();
            setRating(0);
        } catch (error) { if (status) status.textContent = error.message || "Unable to submit review."; }
        finally { if (button) button.disabled = false; }
    });

    async function loadPublicReviews() {
        const container = document.getElementById("publicReviews");
        try {
            const response = await fetch("/api/reviews");
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error("Unable to load reviews.");
            const reviews = Array.isArray(result.reviews) ? result.reviews : [];
            const avg = Number(result.average) || 0;
            const avgEl = document.getElementById("publicReviewAverage"); const countEl = document.getElementById("publicReviewCount");
            if (avgEl) avgEl.textContent = reviews.length ? `${avg.toFixed(1)} / 5` : "—";
            if (countEl) countEl.textContent = String(reviews.length);
            if (!container) return;
            if (!reviews.length) { container.innerHTML = '<p class="empty-message">No published reviews yet.</p>'; return; }
            container.innerHTML = reviews.slice(0, 6).map(item => `<article class="review-card"><div class="review-stars">${"★".repeat(Number(item.rating))}${"☆".repeat(5-Number(item.rating))}</div><p>${escapeHTML(item.review)}</p><strong>${escapeHTML(item.display_name || "ProcureIQ user")}</strong><span>Verified ProcureIQ user</span></article>`).join("");
        } catch (error) { /* Reviews are optional; keep the page clean if unavailable. */ }
    }
    loadPublicReviews();
})();


/* =====================================================
   V12 — PROCUREMENT INTELLIGENCE ENGINE
   Client-side financial intelligence layer built on the
   validated transaction set. It never silently approves,
   rejects or changes a purchase.
===================================================== */
(function initProcureIQV12(){
  const money = v => formatCurrency(Number(v)||0);
  const txs = () => Array.isArray(data) ? data : [];
  const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const byMaterial = () => {
    const map = new Map();
    txs().forEach(t => {
      const m = String(t.material||"Unknown").trim() || "Unknown";
      const price = num(t.price), qty = num(t.quantity);
      if(!map.has(m)) map.set(m, []);
      map.get(m).push({...t, price, quantity:qty});
    });
    return map;
  };
  const supplierSpend = () => {
    const map = new Map();
    txs().forEach(t => { const s=String(t.supplier||"Unknown").trim()||"Unknown"; map.set(s,(map.get(s)||0)+num(t.price)*num(t.quantity)); });
    return [...map.entries()].sort((a,b)=>b[1]-a[1]);
  };
  function set(id, value){ const el=document.getElementById(id); if(el) el.textContent=value; }
  function trust(){
    const rows=txs(), valid=rows.filter(t=>String(t.material||'').trim()&&String(t.supplier||'').trim()&&num(t.quantity)>0&&num(t.price)>=0);
    const suppliers=new Set(rows.map(t=>String(t.supplier||'').trim()).filter(Boolean));
    const materials=new Set(rows.map(t=>String(t.material||'').trim()).filter(Boolean));
    const dated=rows.filter(t=>t.transaction_date||t.date||t.created_at).length;
    let score=100;
    if(rows.length) score-=Math.min(30, Math.round((rows.length-valid.length)/rows.length*100));
    if(!dated && rows.length) score-=10;
    if(suppliers.size<2 && rows.length>3) score-=12;
    if(materials.size<2 && rows.length>3) score-=8;
    score=Math.max(0,Math.min(100,score));
    set('v12TrustScore',`${score}/100`); set('v12ValidRows',valid.length.toLocaleString('en-IN')); set('v12UniqueSuppliers',suppliers.size.toLocaleString('en-IN')); set('v12UniqueMaterials',materials.size.toLocaleString('en-IN')); set('v12DatedRows',rows.length?`${Math.round(dated/rows.length*100)}%`:'0%');
    const bar=document.getElementById('v12HealthBar'); if(bar) bar.style.width=`${score}%`;
    const pill=document.getElementById('v12TrustPill'); if(pill) pill.classList.toggle('v12-trust-warn',score<80);
    const notes=[];
    if(!rows.length) notes.push('No transactions loaded yet. Numbers are intentionally blank rather than guessed.');
    if(rows.length && dated/rows.length<.8) notes.push('Many rows have no transaction date, so time-based trend analysis is limited.');
    if(suppliers.size<2 && rows.length) notes.push('Supplier diversity is low; benchmarking confidence is limited.');
    if(materials.size<2 && rows.length) notes.push('Material diversity is low; price comparisons may be narrow.');
    if(valid.length===rows.length && rows.length) notes.push('Core fields are populated for the loaded transaction set.');
    const box=document.getElementById('v12TrustNotes'); if(box) box.innerHTML=notes.map(n=>`<div class="v12-trust-note">${escapeHTML(n)}</div>`).join('');
    return {score,valid,dated,suppliers,materials};
  }
  function renderFlow(opps,total){
    const box=document.getElementById('v12SpendFlow'); if(!box)return;
    if(!txs().length){box.innerHTML='<div class="v12-flow-empty">Upload data to see the spend flow.</div>';return;}
    const high=opps.filter(o=>o.priority==='HIGH').reduce((s,o)=>s+num(o.price)*num(o.quantity),0);
    const review=opps.reduce((s,o)=>s+num(o.price)*num(o.quantity),0);
    const normal=Math.max(0,total-review);
    const parts=[['Normal spend',normal,'#4a91d4'],['Needs review',review,'#e5a44a'],['High-priority exposure',high,'#c95a45']];
    box.innerHTML=parts.map(([label,value,color])=>{const pct=total?Math.min(100,value/total*100):0;return `<div class="v12-flow-row"><span class="v12-flow-label">${label}</span><div class="v12-flow-track"><span style="width:${pct.toFixed(1)}%;background:${color}"></span></div><strong>${money(value)}</strong></div>`}).join('');
  }
  function renderAttention(opps,total){
    const box=document.getElementById('v12AttentionList'); if(!box)return;
    const items=[];
    const high=opps.filter(o=>o.priority==='HIGH');
    if(high[0]) items.push(['01','Investigate the largest price exception',`${high[0].material} · ${high[0].supplier}`,money(high[0].saving)]);
    const suppliers=supplierSpend(); if(suppliers[0] && total) items.push(['02','Review supplier concentration',`${suppliers[0][0]} represents ${(suppliers[0][1]/total*100).toFixed(1)}% of spend`,`${(suppliers[0][1]/total*100).toFixed(1)}%`]);
    const blind=txs().filter(t=>!(t.transaction_date||t.date||t.created_at)).length; if(blind) items.push(['03','Improve transaction traceability',`${blind} rows have no date attached`,blind.toLocaleString('en-IN')]);
    if(opps.length) items.push(['04','Prepare the next negotiation brief',`${new Set(opps.map(o=>o.material)).size} materials have comparable prices`,money(opps.reduce((s,o)=>s+num(o.saving),0))]);
    items.push(['05','Validate evidence before acting','AI recommendations require human review','Human approval']);
    box.innerHTML=items.slice(0,5).map(([n,title,desc,val])=>`<div class="v12-attention"><span class="v12-attention-num">${n}</span><div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(desc)}</span></div><b class="v12-attention-value">${escapeHTML(val)}</b></div>`).join('');
  }
  function renderBlindSpots(opps,info){
    const box=document.getElementById('v12BlindSpots'); if(!box)return;
    const rows=txs(), checks=[
      ['Contract linkage','No contract/PO field is currently available in the normalized transaction model.','Missing'],
      ['Market benchmark','Historical internal prices are available; external market pricing is not verified.','Limited'],
      ['Competitive sourcing','Quote/competitive-bid evidence is not present in the current dataset.','Missing'],
      ['Date coverage',`${info.dated}/${rows.length||0} transactions contain a date.`,(rows.length&&info.dated/rows.length>=.8)?'Healthy':'Limited']
    ];
    box.innerHTML=checks.map(([a,b,c])=>`<div class="v12-blind"><strong>${a}</strong><span>${b}</span><em class="v12-status">${c}</em></div>`).join('');
  }
  function renderSupplierRisk(total){
    const box=document.getElementById('v12SupplierRisk'); if(!box)return;
    const list=supplierSpend().slice(0,6); if(!list.length){box.innerHTML='<div class="v12-empty">Supplier exposure will appear here.</div>';return;}
    box.innerHTML=list.map(([s,sp])=>{const pct=total?sp/total*100:0;return `<div class="v12-supplier-row"><strong>${escapeHTML(s)}</strong><div class="v12-supplier-track"><span style="width:${Math.min(100,pct)}%"></span></div><em>${pct.toFixed(1)}%</em></div>`}).join('');
  }
  function renderHealth(opps,total,info){
    const riskSpend=opps.reduce((s,o)=>s+num(o.price)*num(o.quantity),0);
    const savings=opps.reduce((s,o)=>s+num(o.saving),0);
    const highConfidence=opps.filter(o=>Array.isArray(o.comparison)&&o.comparison.length>=2).reduce((s,o)=>s+num(o.saving),0);
    const concentration=supplierSpend()[0] && total ? supplierSpend()[0][1]/total*100 : 0;
    let score=info.score;
    if(total) score=Math.max(0,Math.min(100,Math.round(score - Math.min(20,riskSpend/Math.max(total,1)*40) + (highConfidence>0?5:0))));
    set('v12HealthScore',`${score}/100`); set('v12HealthCopy', total?`${opps.length} purchasing exception${opps.length===1?'':'s'} worth investigating across ${info.suppliers.size} suppliers.`:'Upload procurement data to calculate your financial control position.');
    set('v12AtRisk',money(riskSpend)); set('v12HighConfidence',money(highConfidence)); set('v12Dependency',concentration?`${concentration.toFixed(1)}%`:'—'); set('v12DependencyCopy',concentration>35?'top supplier share — dependency signal':'top supplier share'); set('v12SpendFlowTotal',money(total)); set('v12PotentialSavings',money(savings));
    const bar=document.getElementById('v12HealthBar'); if(bar)bar.style.width=`${score}%`;
  }
  function refresh(){
    const rows=txs(), total=rows.reduce((s,t)=>s+num(t.price)*num(t.quantity),0), opps=window.procurementOpportunities||[];
    const info=trust(); renderHealth(opps,total,info); renderFlow(opps,total); renderAttention(opps,total); renderBlindSpots(opps,info); renderSupplierRisk(total);
    set('v12ApprovedSavings',money(Number(localStorage.getItem('procureiq.approvedSavings')||0))); set('v12RealizedSavings',money(Number(localStorage.getItem('procureiq.realizedSavings')||0)));
  }
  window.procureIQRefreshIntelligence=refresh;
  document.getElementById('v12RecalculateBtn')?.addEventListener('click',refresh);
  document.getElementById('v12PrebuyCheck')?.addEventListener('click',()=>{
    const material=String(document.getElementById('v12PrebuyMaterial')?.value||'').trim(); const price=num(document.getElementById('v12PrebuyPrice')?.value); const qty=num(document.getElementById('v12PrebuyQty')?.value); const box=document.getElementById('v12PrebuyResult'); if(!box)return;
    const matches=txs().filter(t=>String(t.material||'').trim().toLowerCase()===material.toLowerCase()).map(t=>num(t.price)).filter(p=>p>=0);
    if(!material||price<=0||qty<=0){box.className='v12-prebuy-result';box.innerHTML='<strong>Enter material, quoted price and quantity.</strong><p>ProcureIQ needs a quote to compare against your internal historical benchmark.</p>';box.classList.remove('is-hidden');return;}
    if(!matches.length){box.className='v12-prebuy-result';box.innerHTML='<strong>No reliable internal benchmark found.</strong><p>Do not guess. Ask for comparable quotes or supplier history before approval.</p>';box.classList.remove('is-hidden');return;}
    const best=Math.min(...matches), variance=best>0?(price-best)/best*100:0, saving=Math.max(0,(price-best)*qty); const high=variance>=10;
    box.className=`v12-prebuy-result ${high?'high':'ok'}`; box.innerHTML=`<strong>${high?'⚠ Review before approval':'✓ Within observed range'}</strong><p>Quoted at ${money(price)}/unit vs best observed ${money(best)}/unit across ${matches.length} comparable transaction${matches.length===1?'':'s'}. ${high?`Estimated avoidable cost if comparable: ${money(saving)}. Validate contract, specification, freight, volume and delivery terms before action.`:'The quote is not materially above the observed internal benchmark. Continue normal commercial checks.'}</p>`; box.classList.remove('is-hidden');
  });
  document.addEventListener('DOMContentLoaded',()=>setTimeout(refresh,300));
})();


/* V18 — supplier benchmark + material concentration widgets */
(function initV18InsightWidgets(){
  function rows(){ return Array.isArray(window.data) ? window.data : []; }
  function render(){
    const data=rows();
    const supplierBox=document.getElementById('v18SupplierBenchmark');
    const materialBox=document.getElementById('v18MaterialInsights');
    if(supplierBox){
      if(!data.length){ supplierBox.innerHTML='<div class="empty-message">Upload procurement data to generate supplier benchmarks.</div>'; }
      else {
        const map=new Map();
        data.forEach(r=>{const s=String(r.supplier||'Unknown supplier').trim(); const q=Number(r.quantity)||0,p=Number(r.price)||0; const x=map.get(s)||{spend:0,rows:0,prices:[]}; x.spend+=q*p; x.rows++; if(p>0)x.prices.push(p); map.set(s,x);});
        const list=[...map.entries()].sort((a,b)=>b[1].spend-a[1].spend).slice(0,5);
        supplierBox.innerHTML=list.map(([name,x])=>{const avg=x.prices.length?x.prices.reduce((a,b)=>a+b,0)/x.prices.length:0; return `<div class="benchmark-row"><div><strong>${escapeHTML(name)}</strong><span>${x.rows} transactions · avg ${formatCurrency(avg)}/unit</span></div><b>${formatCurrency(x.spend)}</b></div>`}).join('');
      }
    }
    if(materialBox){
      if(!data.length){ materialBox.innerHTML='<div class="empty-message">Upload procurement data to see material concentration.</div>'; }
      else {
        const map=new Map(); let total=0;
        data.forEach(r=>{const m=String(r.material||'Unknown material').trim(); const spend=(Number(r.quantity)||0)*(Number(r.price)||0); map.set(m,(map.get(m)||0)+spend); total+=spend;});
        const list=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
        materialBox.innerHTML=list.map(([name,spend])=>{const pct=total?spend/total*100:0; return `<div class="material-insight-row"><div><strong>${escapeHTML(name)}</strong><span>${pct.toFixed(1)}% of spend</span></div><b>${formatCurrency(spend)}</b><div class="insight-bar"><i style="width:${Math.min(100,pct).toFixed(1)}%"></i></div></div>`}).join('');
      }
    }
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(render,350));
  window.addEventListener('procureiq:data-updated',render);
  setInterval(render,1800);
})();

/* =====================================================
   V15 — DOCUMENT-LEVEL WORKSPACE NAVIGATION
   Every primary destination is a real HTML document.
===================================================== */
(function initProcureIQDocumentNavigation(){
  const routes={overview:'/workspace/overview',act:'/workspace/act',analyze:'/workspace/analyze',control:'/workspace/control',reports:'/workspace/reports',billing:'/workspace/billing',help:'/workspace/help'};
  const valid=new Set(Object.keys(routes));
  const current=()=>{const m=window.location.pathname.match(/^\/workspace(?:\/([^/]+))?\/?$/); const p=m?.[1]||'overview'; return valid.has(p)?p:'overview';};
  function navigate(page){ const target=routes[page]||routes.overview; window.location.assign(target); }
  window.procureIQNavigate=navigate;
  window.procureIQCurrentPage=current;
  document.addEventListener('click',(event)=>{
    const el=event.target.closest('[data-page]');
    if(!el) return;
    const page=el.dataset.page;
    if(!valid.has(page)) return;
    event.preventDefault();
    navigate(page);
  });
  document.addEventListener('DOMContentLoaded',()=>{
    const page=current();
    document.documentElement.dataset.workspacePage=page;
    document.querySelectorAll('.sidebar-link[data-page]').forEach(link=>link.classList.toggle('active',link.dataset.page===page));
    if(window.location.hash==='#usage') setTimeout(()=>document.getElementById('usageCard')?.scrollIntoView({behavior:'smooth',block:'start'}),250);
    if(window.location.hash==='#assistant') setTimeout(()=>document.getElementById('chatInput')?.focus({preventScroll:true}),250);
  });
})();

/* V13 lightweight sync: updates the four compact cards when the analysis state changes. */
setInterval(() => {
  if (typeof window.procureIQRefreshCompactSnapshot === "function") window.procureIQRefreshCompactSnapshot();
}, 1200);


/* =====================================================
   V14 — CALM INTERACTIONS / FEATURE DISCOVERY
===================================================== */
(function initProcureIQV14Interactions(){
  const promptButtons=document.querySelectorAll('[data-prompt]');
  promptButtons.forEach(btn=>btn.addEventListener('click',()=>{
    const input=document.getElementById('chatInput');
    if(input){ input.value=btn.dataset.prompt||''; input.focus(); }
    window.procureIQNavigate?.('analyze');
  }));
  const check=document.getElementById('v14PrebuyCheck');
  check?.addEventListener('click',()=>{
    const material=(document.getElementById('v14PrebuyMaterial')?.value||'').trim();
    const price=Number(document.getElementById('v14PrebuyPrice')?.value||0);
    const qty=Number(document.getElementById('v14PrebuyQuantity')?.value||0);
    const box=document.getElementById('v14PrebuyResult'); if(!box)return;
    const rows=Array.isArray(window.data)?window.data:[];
    const matches=rows.filter(t=>String(t.material||'').trim().toLowerCase()===material.toLowerCase()).map(t=>Number(t.price)||0).filter(v=>v>0);
    box.classList.remove('is-hidden');
    if(!material||price<=0||qty<=0){box.className='v14-prebuy-result';box.innerHTML='<strong>Complete the quote first.</strong><span>Enter a material, quoted price and quantity so ProcureIQ can check the internal benchmark.</span>';return;}
    if(!matches.length){box.className='v14-prebuy-result neutral';box.innerHTML='<strong>No reliable internal benchmark yet.</strong><span>ProcureIQ will not invent a market price. Add comparable purchase history or review the quote manually.</span>';return;}
    const best=Math.min(...matches), variance=((price-best)/best)*100, saving=Math.max(0,(price-best)*qty);
    const high=variance>=10; box.className=`v14-prebuy-result ${high?'danger':'safe'}`;
    box.innerHTML=`<strong>${high?'Review before approval':'Within observed range'}</strong><span>Quote: ${formatCurrency(price)}/unit · Best observed: ${formatCurrency(best)}/unit · ${matches.length} comparable purchase${matches.length===1?'':'s'}.</span>${high?`<b>Potential avoidable cost: ${formatCurrency(saving)}</b>`:'<b>No material internal price exception detected.</b>'}`;
  });
  document.getElementById('v14DataTrustDetails')?.addEventListener('click',()=>document.getElementById('v14ControlDetails')?.scrollIntoView({behavior:'smooth',block:'center'}));
  document.getElementById('v14BlindSpotDetails')?.addEventListener('click',()=>document.getElementById('v14ControlDetails')?.scrollIntoView({behavior:'smooth',block:'center'}));
  
  // Keep the existing intelligence engine's values connected to the new calm cards.
  const sync=()=>{
    const get=id=>document.getElementById(id)?.textContent||'—';
    const map=[['v12HealthScore','v14ControlScore'],['v12Dependency','v14Dependency'],['v12DependencyCopy','v14DependencyCopy'],['v12TrustScore','v14DataTrust'],['v12PotentialSavings','v14PotentialSavings'],['v12ApprovedSavings','v14ApprovedSavings'],['v12NegotiatedSavings','v14NegotiatedSavings'],['v12RealizedSavings','v14RealizedSavings']];
    map.forEach(([a,b])=>{const v=get(a),el=document.getElementById(b);if(el&&v!=='—')el.textContent=v;});
  };
  setInterval(sync,900);
  window.addEventListener('load',sync);
})();

/* V15 executive view sync */
(function(){
  function sync(){
    const get=id=>document.getElementById(id)?.textContent||'₹0';
    const map=[['totalSpend','execSpend'],['savings','execSavings'],['opportunities','execExceptions'],['transactions','execTransactions']];
    map.forEach(([a,b])=>{const el=document.getElementById(b); if(el) el.textContent=get(a);});
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(sync,500));
  window.addEventListener('procureiq:data-updated',sync);
  setInterval(sync,1500);
})();


/* =====================================================
   V16 EXECUTIVE PROCUREMENT INTELLIGENCE VIEW
   Calculations remain deterministic; AI is used only for
   concise explanation of already-computed signals.
===================================================== */
(function () {
    const moneyValue = value => formatCurrency(Number(value) || 0);

    function buildLocalSummary() {
        const rows = Array.isArray(data) ? data : [];
        const opps = Array.isArray(window.procurementOpportunities) ? window.procurementOpportunities : [];
        const savings = opps.reduce((sum, o) => sum + (Number(o.saving) || 0), 0);
        const high = opps.filter(o => o.priority === "HIGH").sort((a,b) => (b.score||0)-(a.score||0))[0];
        const suppliers = new Map();
        rows.forEach(row => {
            const supplier = String(row.supplier || "Unknown supplier").trim();
            suppliers.set(supplier, (suppliers.get(supplier) || 0) + (Number(row.quantity)||0) * (Number(row.price)||0));
        });
        const topSupplier = [...suppliers.entries()].sort((a,b)=>b[1]-a[1])[0];

        if (!rows.length) return "Upload procurement data and ProcureIQ will explain what is happening, where to look first, and why it may matter.";
        if (!opps.length) return `No price-variance opportunities were detected across ${rows.length.toLocaleString("en-IN")} transactions. Review supplier benchmarks and data coverage before concluding that there is no savings opportunity.`;
        const lead = high
            ? `Start with ${high.material} — ${high.supplier}, ${high.variance.toFixed(1)}% above the lowest observed comparable price.`
            : `Start with the highest-value price exception in the queue.`;
        const concentration = topSupplier ? ` ${topSupplier[0]} is the largest spend concentration at ${moneyValue(topSupplier[1])}.` : "";
        return `${opps.length} potential opportunities were identified with ${moneyValue(savings)} in estimated savings. ${lead}${concentration} Potential savings require validation.`;
    }

    async function refreshAISummary(useAI = false) {
        const box = document.getElementById("v16AISummary");
        if (!box) return;
        const local = buildLocalSummary();
        box.textContent = local;
        if (!useAI || !data.length || !(window.procurementOpportunities || []).length) return;

        const top = (window.procurementOpportunities || []).slice(0, 5).map(o => ({
            material: o.material, supplier: o.supplier, variance: Number(o.variance.toFixed(1)),
            potential_saving: Number((o.saving || 0).toFixed(2)), priority: o.priority,
            score: o.score, confidence: o.confidence
        }));
        try {
            box.textContent = "ProcureIQ is summarizing the highest-impact signals…";
            const response = await procureiqApiFetch("/api/chat", {
                method: "POST",
                headers: {"Content-Type":"application/json","Accept":"application/json"},
                body: JSON.stringify({
                    question: "Give a concise procurement manager summary in 2 sentences. State what matters most, where to investigate first, and the potential financial impact. Do not invent facts. Say potential savings requires validation.",
                    context: { transactions: data.length, top_opportunities: top }
                })
            });
            const result = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(result.error || "AI summary unavailable");
            box.textContent = result.answer || local;
            window.procureIQLoadAIUsage?.();
        } catch (error) {
            console.warn("Executive AI summary unavailable:", error);
            box.textContent = local;
        }
    }

    function refreshExecutiveView() {
        const opps = Array.isArray(window.procurementOpportunities) ? window.procurementOpportunities : [];
        const savings = opps.reduce((sum,o)=>sum+(Number(o.saving)||0),0);
        const hero = document.getElementById("v16PotentialSavingsHero");
        if (hero) hero.textContent = moneyValue(savings);
        const meta = document.getElementById("v16QueueMeta");
        if (meta) {
            const high = opps.filter(o=>o.priority==="HIGH").length;
            meta.innerHTML = opps.length
                ? `<span><strong>${opps.length.toLocaleString("en-IN")}</strong> opportunities</span><span><strong>${high}</strong> high priority</span><span><strong>${moneyValue(savings)}</strong> potential savings</span>`
                : `<span>No opportunities loaded yet</span>`;
        }
        const summary = document.getElementById("v16AISummary");
        if (summary && !summary.dataset.ready) {
            summary.textContent = buildLocalSummary();
        }
    }

    window.procureIQRefreshExecutiveView = refreshExecutiveView;
    window.procureIQRefreshExecutiveSummary = () => refreshAISummary(true);

    document.addEventListener("DOMContentLoaded", () => {
        refreshExecutiveView();
        setTimeout(() => refreshAISummary(false), 300);
    });
    window.addEventListener("procureiq:data-updated", () => {
        refreshExecutiveView();
        refreshAISummary(false);
    });
})();
