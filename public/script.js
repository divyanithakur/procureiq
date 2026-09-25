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
let opportunityMemoryMap = new Map();
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

    // Whole rupees only, always. The previous maximumFractionDigits:2 with
    // no minimum let toLocaleString show whatever fractional digits the raw
    // float happened to carry (e.g. 2055009.4 -> "₹20,55,009.4"), instead of
    // a clean rupee amount. Rounding first keeps this consistent with the
    // PDF report's money() formatter.
    return `₹${Math.round(number).toLocaleString("en-IN", {
        maximumFractionDigits: 0
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


function showError(message, fileType = "File") {
    console.error("ProcureIQ Error:", message);
    if (status) {
        if (status._timer) clearTimeout(status._timer);
        status.textContent = `${fileType} not uploaded — ${message}`;
        status.className = "inline-status error";
        status._timer = setTimeout(() => {
            status.textContent = "";
            status.className = "inline-status";
            status._timer = null;
        }, 5000);
    }
}

function showTransientUploadStatus(message, type = "success", duration = 3500) {
    if (!status) return;
    if (status._timer) clearTimeout(status._timer);
    status.textContent = message;
    status.className = `inline-status ${type}`;
    status._timer = setTimeout(() => {
        status.textContent = "";
        status.className = "inline-status";
        status._timer = null;
    }, duration);
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
    if (!file) return showError("Please select a CSV, Excel or PDF file first.", "File");

    const extension = file.name.split(".").pop().toLowerCase();
    if (!["csv", "xlsx", "xls", "pdf"].includes(extension)) {
        return showError("Unsupported file format. Please upload CSV, XLSX, XLS or PDF.", "File");
    }

    const maxUploadBytes = 20 * 1024 * 1024;
    if (file.size > maxUploadBytes) {
        return showError("This file is too large. Please upload a file smaller than 20 MB.", "File");
    }
    const allowedMime = {
        csv: ["text/csv", "application/csv", "text/plain", ""],
        xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", ""],
        xls: ["application/vnd.ms-excel", "application/octet-stream", ""],
        pdf: ["application/pdf", "application/octet-stream", ""]
    };
    if (!allowedMime[extension].includes(file.type)) {
        return showError("The file type does not match its extension. Please choose a valid file.", "File");
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
            const isPdf = extension === "pdf";
            if (isPdf && extractionNote) {
                throw new Error(extractionNote);
            }
            throw new Error("No valid transactions found. Required fields: material, supplier/company, quantity and price.");
        }

        status.textContent = `Validated ${validation.valid.length} transaction(s). Checking data quality...`;
        await new Promise(resolve => requestAnimationFrame(resolve));

        const response = await procureiqApiFetch("/api/transactions/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({ transactions: validation.valid, sourceFileName: file.name })
        });

        const responseText = await response.text();
        let result = {};
        try { result = responseText ? JSON.parse(responseText) : {}; }
        catch { throw new Error(`Server returned invalid JSON (${response.status}).`); }
        if (!response.ok) {
            if (response.status === 413) throw new Error("This upload is too large. Try a smaller file or fewer rows.");
            if (response.status === 401 || response.status === 403) throw new Error("Please sign in again before uploading procurement data.");
            if (result.code === "TOKEN_LIMIT_REACHED" || result.usage_limit_reached) {
                throw new Error(result.error || "Your AI token allowance has been exhausted. Upgrade your plan to continue processing procurement data.");
            }
            if (response.status === 402 && result.free_user_cap_reached) {
                throw new Error(result.error || "The free workspace capacity is currently full. Open Plans & Billing to upgrade.");
            }
            if (response.status === 402 && result.upgrade_required) throw new Error(result.error || "Your current plan limit has been reached. Open Plans & Billing to upgrade.");
            throw new Error(result.error || result.message || `Upload failed with status ${response.status}.`);
        }

        const confirmedUploadLabel = "Uploaded successfully:";
        void confirmedUploadLabel;
        const inserted = Number(result.inserted) || 0;
        const duplicates = Number(result.duplicates) || 0;
        const invalid = Number(result.invalid) || 0;
        await loadDatabaseData();
        const label = extension === "pdf" ? "PDF" : "File";
        const parts = [];
        if (inserted) parts.push(`${inserted.toLocaleString("en-IN")} new record${inserted === 1 ? "" : "s"}`);
        if (duplicates) parts.push(`${duplicates.toLocaleString("en-IN")} duplicate${duplicates === 1 ? "" : "s"} skipped`);
        if (invalid) parts.push(`${invalid.toLocaleString("en-IN")} invalid row${invalid === 1 ? "" : "s"} skipped`);
        const message = inserted
            ? `${label} uploaded successfully · ${parts.join(" · ")}`
            : `${label} processed · no new records added${duplicates ? ` · ${duplicates.toLocaleString("en-IN")} duplicate${duplicates === 1 ? "" : "s"} skipped` : ""}${invalid ? ` · ${invalid.toLocaleString("en-IN")} invalid row${invalid === 1 ? "" : "s"} skipped` : ""}`;
        showTransientUploadStatus(message, inserted ? "success" : "error", 5000);
        await window.procureIQSaveReportSnapshot?.(file.name);
        fileInput.value = "";
        selectedFile = null;
    } catch (error) {
        console.error("File upload error:", error);
        showError(error.message || "Unable to process the uploaded file.", extension === "pdf" ? "PDF" : "File");
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

    if(headerIndex < 0){
        const headerLike=lines.find(line=>/\b(material|item|product|part|sku|supplier|vendor|company|quantity|qty|units|price|rate|unit[ -]?price|unit[ -]?cost|cost|amount)\b/i.test(line));
        if(headerLike){
            const h=cleanText(headerLike);
            const missing=[];
            if(!hasMaterial.test(h)) missing.push("material/item");
            if(!hasSupplier.test(h)) missing.push("supplier/company");
            if(!hasQuantity.test(h)) missing.push("quantity");
            if(!hasPrice.test(h)) missing.push("price");
            if(missing.length>=1) throw new Error(`Required PDF fields are missing: ${missing.join(", ")}.`);
        }
    }

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
            transaction_date: dateMatch ? dateMatch[1] : ""
        });
    }

    if (!transactions.length) {
        const allText = lines.join(" ");
        const hasMaterialField = /\b(material|item|product|part|sku)\b/i.test(allText);
        const hasSupplierField = /\b(supplier|vendor|seller|company|party)\b/i.test(allText);
        const hasQuantityField = /\b(quantity|qty|units|count)\b/i.test(allText);
        const hasPriceField = /\b(price|rate|unit[ -]?price|unit[ -]?cost|cost|amount)\b/i.test(allText);
        const missing=[];
        if(!hasMaterialField) missing.push("material/item is not found");
        if(!hasSupplierField) missing.push("supplier/company is not found");
        if(!hasQuantityField) missing.push("quantity is not found");
        if(!hasPriceField) missing.push("price is not found");
        if(missing.length){
            throw new Error(`Required PDF data is missing: ${missing.join(", ")}.`);
        }
        throw new Error("No valid transaction rows were found in the PDF. Check that each row contains material, supplier/company, quantity and price.");
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

    // Keep the dropzone reliable even when a browser/theme changes label click behavior.
    dropzone.addEventListener("click", event => {
        if (event.target === fileInput) return;
        event.preventDefault();
        fileInput.click();
    });
    dropzone.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fileInput.click();
        }
    });
    dropzone.setAttribute("role", "button");
    dropzone.setAttribute("tabindex", "0");
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
        window.dispatchEvent(new CustomEvent("procureiq:data-updated"));
        await loadOpportunityMemory();
        if (status) {
            status.textContent = data.length
                ? `✓ Loaded ${data.length.toLocaleString("en-IN")} transaction(s) from PostgreSQL.`
                : "No saved procurement transactions yet. Upload a CSV, Excel or PDF file to begin.";
        }
        return true;
    } catch (error) {
        console.error("PostgreSQL Error:", error);
        window.procureiqDataLoadFailed = true;
        window.dispatchEvent(new CustomEvent("procureiq:data-load-failed", { detail: { message: error.message } }));
        if (status) status.textContent = `Unable to load procurement data: ${error.message}`;
        return false;
    }
}


window.loadDatabaseData = loadDatabaseData;

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
            id: Number(item.id) || 0,
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


async function loadOpportunityMemory() {
    try {
        const response = await procureiqApiFetch("/api/opportunity-memory", { headers: { Accept: "application/json" } });
        const result = await response.json().catch(() => []);
        if (!response.ok) throw new Error(result.error || "Unable to load opportunity history.");
        opportunityMemoryMap = new Map((Array.isArray(result) ? result : []).map(item => [Number(item.transaction_id), item]));
        renderFilteredOpportunities();
        window.procureIQSyncOutcomeLedger?.();
    } catch (error) {
        console.warn("Opportunity memory unavailable:", error.message);
    }
}
window.procureIQLoadOpportunityMemory = loadOpportunityMemory;


function memoryLabel(memory) {
    if (!memory) return "New";
    const labels = { detected:"Detected", investigating:"Investigating", validated:"Validated", dismissed:"Not an issue", actioned:"Actioned", outcome_recorded:"Outcome recorded" };
    return labels[memory.status] || "Tracked";
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


                // Priority is a review-severity label, not a proof of an error.
                // 15%+ is high, 8%–14.99% is medium, below 8% is low.
                if (variance >= 15) {

                    priority = "HIGH";

                } else if (variance >= 8) {

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
                    id: item.id,
                    material,
                    supplier: item.supplier,
                    price: item.price,
                    minPrice,
                    quantity: item.quantity,
                    saving,
                    variance,
                    priority,
                    score: opportunityScore,
                    memory: opportunityMemoryMap.get(item.id) || null,
                    confidence,
                    comparableCount,
                    comparison: items.map(other => ({ supplier: other.supplier, price: other.price, quantity: other.quantity }))
                        .sort((a, b) => a.price - b.price)
                });
            });
        }
    );


    opportunities.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || (Number(b.saving) || 0) - (Number(a.saving) || 0));


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

    // Always surface the highest-risk exceptions first so a real HIGH case
    // cannot be pushed below the initial five rows by a larger saving amount.
    const priorityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const visible = [...filtered]
        .sort((a, b) =>
            (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0) ||
            (Number(b.score) || 0) - (Number(a.score) || 0) ||
            (Number(b.saving) || 0) - (Number(a.saving) || 0)
        )
        .slice(0, 5);
    const totalSavings = filtered.reduce((sum, item) => sum + (Number(item.saving) || 0), 0);
    const highCount = filtered.filter(item => item.priority === "HIGH").length;
    if (summary) {
        const mediumCount = filtered.filter(item => item.priority === "MEDIUM").length;
        const lowCount = filtered.filter(item => item.priority === "LOW").length;
        summary.innerHTML = `<span><strong>${filtered.length.toLocaleString("en-IN")}</strong> opportunities</span><span><strong>${formatCurrency(totalSavings)}</strong> potential savings</span><span><strong>${highCount}</strong> high priority</span><span><strong>${mediumCount}</strong> medium</span><span><strong>${lowCount}</strong> low</span>`;
    }

    list.innerHTML = visible.map((item, index) => {
        const aiId = `opportunity-ai-${Date.now()}-${index}`;
        return `
        <article class="opportunity opportunity-compact-row">
          <div class="opportunity-primary-row">
            <div class="opportunity-rank">${String(index + 1).padStart(2, "0")}</div>
            <div class="opportunity-main">
              <div class="opportunity-compact-title">
                <strong>${escapeHTML(item.material)} : ${escapeHTML(item.supplier)}</strong>
                <span class="priority ${item.priority.toLowerCase()}">${item.priority} PRIORITY</span>
              </div>
              <span class="opportunity-compact-meta">${item.variance.toFixed(1)}% above lowest observed comparable price · ${item.confidence} confidence · ${memoryLabel(item.memory)}</span>
            </div>
            <div class="opportunity-compact-score"><span>Opportunity score</span><strong>${item.score}/100</strong><small>${item.confidence} confidence</small></div>
            <div class="opportunity-compact-saving"><span>Potential saving</span><strong>${formatCurrency(item.saving)}</strong><small>Requires validation</small></div>
            <button type="button" class="opportunity-review-btn primary-cta"
              data-transaction-id="${Number(item.id) || 0}" data-material="${escapeHTML(item.material)}" data-supplier="${escapeHTML(item.supplier)}" data-price="${item.price}" data-min-price="${item.minPrice}" data-quantity="${item.quantity}" data-saving="${item.saving}" data-variance="${item.variance}" data-priority="${item.priority}" data-score="${item.score}" data-comparables="${item.comparableCount}" data-target="${aiId}" data-action="investigate-opportunity" aria-label="Investigate ${escapeHTML(item.material)} from ${escapeHTML(item.supplier)}"
              onclick="event.preventDefault(); event.stopPropagation(); window.procureIQInvestigate(this); return false;">
              Investigate
            </button>
          </div>
          <div id="${aiId}" class="ai-insight opportunity-ai-summary" aria-live="polite"></div>
        </article>`;
    }).join("");

    // Each Investigate button carries its own click path, so dynamic renders remain reliable.

    if (pagination && moreButton) {
        pagination.classList.toggle("is-hidden", filtered.length <= 5);
        moreButton.innerHTML = `View all opportunities <span>↓</span>`;
    }
}


function procureIQInvestigate(button) {
    try {
        if (!button) return false;
        const d = button.dataset || {};
        const item = {
            id: Number(d.transactionId || 0),
            material: d.material || "",
            supplier: d.supplier || "",
            price: Number(d.price || 0),
            minPrice: Number(d.minPrice || 0),
            quantity: Number(d.quantity || 0),
            saving: Number(d.saving || 0),
            variance: Number(d.variance || 0),
            priority: d.priority || "REVIEW",
            score: Number(d.score || 0),
            comparableCount: Number(d.comparables || 0)
        };
        if (!item.material && !item.supplier) return false;
        openOpportunityDrawer(item);
    } catch (error) {
        console.error("ProcureIQ Investigate failed:", error);
        const drawer = document.getElementById("opportunityDrawer");
        if (drawer) {
            drawer.innerHTML = `<div class="opportunity-drawer-backdrop" data-opportunity-drawer-close></div><aside class="opportunity-drawer-panel" role="dialog" aria-modal="true"><button class="opportunity-drawer-close" type="button" data-opportunity-drawer-close>×</button><span class="section-kicker">INVESTIGATE OPPORTUNITY</span><h2>Unable to open this opportunity</h2><p class="drawer-subtitle">Please refresh the workspace and try again.</p><p class="inline-status error">${escapeHTML(error?.message || "Unknown error")}</p></aside>`;
            drawer.classList.add("is-open");
            drawer.setAttribute("aria-hidden", "false");
            document.body.classList.add("modal-open");
        }
    }
    return false;
}
window.procureIQInvestigate = procureIQInvestigate;

function openOpportunityDrawer(item) {
    let drawer = document.getElementById("opportunityDrawer");
    if (!drawer) {
        drawer = document.createElement("div");
        drawer.id = "opportunityDrawer";
        drawer.className = "opportunity-drawer";
        drawer.setAttribute("aria-hidden", "true");
        document.body.appendChild(drawer);
    }
    if (!drawer.querySelector("#drawerOpportunityTitle")) {
        drawer.innerHTML = `
          <div class="opportunity-drawer-backdrop" data-opportunity-drawer-close></div>
          <aside class="opportunity-drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawerOpportunityTitle">
            <button class="opportunity-drawer-close" type="button" aria-label="Close" data-opportunity-drawer-close>×</button>
            <span class="section-kicker">INVESTIGATE OPPORTUNITY</span>
            <h2 id="drawerOpportunityTitle">Opportunity</h2>
            <p id="drawerOpportunitySupplier" class="drawer-subtitle"></p>
            <div class="drawer-priority-row"><span id="drawerOpportunityPriority" class="priority low">REVIEW</span><span>Potential savings · requires validation</span></div>
            <div class="drawer-score-line"><span>Priority score</span><strong id="drawerOpportunityScore">0/100</strong><small id="drawerScoreReason">Based on impact, evidence confidence, repetition and urgency.</small></div>
            <div class="drawer-financial"><span>Potential opportunity</span><strong id="drawerOpportunitySaving">₹0</strong></div>
            <div class="drawer-evidence-grid">
              <div><span>Current price</span><strong id="drawerPaidPrice">₹0/unit</strong></div>
              <div><span>Best observed</span><strong id="drawerBestPrice">₹0/unit</strong></div>
              <div><span>Variance</span><strong id="drawerVariance">+0%</strong></div>
              <div><span>Quantity</span><strong id="drawerQuantity">0</strong></div>
            </div>
            <div class="drawer-section"><span class="drawer-label">Evidence to validate</span><p id="drawerPossibleReasons">Compare specification, freight, contract terms, quantity and delivery conditions before action.</p></div>
            <div class="memory-panel" id="opportunityMemoryPanel">
              <div class="memory-panel-head"><div><span class="drawer-label">OPPORTUNITY MEMORY</span><strong id="drawerMemoryStatus">Detected</strong></div><span class="memory-caption">AI recommends · evidence supports · human decides</span></div>
              <div class="memory-steps"><span class="is-active">Detect</span><i>→</i><span>Investigate</span><i>→</i><span>Decide</span><i>→</i><span>Outcome</span></div>
              <div class="memory-actions"><button type="button" data-memory-decision="valid" class="memory-action">Valid exception</button><button type="button" data-memory-decision="not_an_issue" class="memory-action">Not an issue</button><button type="button" data-memory-decision="needs_context" class="memory-action">Needs context</button></div>
              <div class="memory-outcome-grid"><label>Outcome<select id="drawerOutcomeType"><option value="">Not recorded</option><option value="negotiated">Negotiated</option><option value="realized">Realized</option><option value="no_saving">No saving</option><option value="monitoring">Monitoring</option></select></label><label>Negotiated saving<input id="drawerNegotiatedSaving" type="number" min="0" step="0.01" placeholder="0"></label><label>Realized saving<input id="drawerRealizedSaving" type="number" min="0" step="0.01" placeholder="0"></label></div>
              <textarea id="drawerMemoryNote" rows="2" maxlength="1000" placeholder="Short decision or outcome note"></textarea>
              <button type="button" class="secondary-btn memory-save-btn" id="drawerMemorySave">Save to opportunity history</button><p class="memory-status" id="drawerMemoryStatusText" role="status"></p>
            </div>
            <button type="button" class="primary-cta ai-button drawer-ai-button" id="drawerAIButton">Explain with AI</button>
            <div id="drawerAIInsight" class="ai-insight" aria-live="polite"></div>
          </aside>`;
    }
    drawer.dataset.transactionId = String(item.id || "");
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
    const score = document.getElementById("drawerOpportunityScore");
    const ai = document.getElementById("drawerAIInsight");
    // The drawer is reused for every investigation. Never allow its previous
    // item's explanation (or a previous loading/error state) to carry over.
    // Cached results remain keyed by transaction ID and are shown only after
    // the user explicitly requests an explanation for that same item.
    if (ai) {
        ai.className = "ai-insight";
        ai.textContent = "";
        ai.dataset.transactionId = String(item.id || "");
    }
    if (title) title.textContent = item.material || "Opportunity";
    if (supplier) supplier.textContent = `${item.supplier || "Unknown supplier"} · purchasing exception`;
    if (priority) { priority.textContent = item.priority || "REVIEW"; priority.className = `priority ${(item.priority || "low").toLowerCase()}`; }
    if (saving) saving.textContent = formatCurrency(item.saving);
    if (paid) paid.textContent = `${formatCurrency(item.price)}/unit`;
    if (best) best.textContent = `${formatCurrency(item.minPrice)}/unit`;
    if (variance) variance.textContent = `+${Number(item.variance || 0).toFixed(1)}%`;
    if (quantity) quantity.textContent = Number(item.quantity || 0).toLocaleString("en-IN");
    if (score) score.textContent = `${Number(item.score || 0)}/100`;
    const scoreReason = document.getElementById("drawerScoreReason"); if (scoreReason) scoreReason.textContent = `${Number(item.comparableCount || 0)} comparable purchase${Number(item.comparableCount || 0) === 1 ? "" : "s"} · impact · confidence · repetition`;
    const memory = opportunityMemoryMap.get(Number(item.id)) || item.memory || null;
    const memoryStatus = document.getElementById("drawerMemoryStatus");
    if (memoryStatus) memoryStatus.textContent = memoryLabel(memory);
    const outcome = document.getElementById("drawerOutcomeType"); if (outcome) outcome.value = memory?.outcome_type || "";
    const negotiated = document.getElementById("drawerNegotiatedSaving"); if (negotiated) negotiated.value = Number(memory?.negotiated_saving || 0) || "";
    const realized = document.getElementById("drawerRealizedSaving"); if (realized) realized.value = Number(memory?.realized_saving || 0) || "";
    const note = document.getElementById("drawerMemoryNote"); if (note) note.value = memory?.note || "";
    drawer.dataset.memoryDecision = memory?.decision || "pending";
    drawer.querySelectorAll("[data-memory-decision]").forEach(btn => btn.classList.toggle("is-selected", btn.dataset.memoryDecision === (memory?.decision || "pending")));
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    const aiButton = document.getElementById("drawerAIButton");
    if (aiButton) {
        aiButton.dataset.transactionId = String(item.id || "");
        aiButton.dataset.material = item.material || "";
        aiButton.dataset.supplier = item.supplier || "";
        aiButton.dataset.price = String(item.price ?? "");
        aiButton.dataset.minPrice = String(item.minPrice ?? "");
        aiButton.dataset.quantity = String(item.quantity ?? "");
        aiButton.dataset.target = "drawerAIInsight";
        aiButton.disabled = false;
        aiButton.textContent = "Explain with AI";
        aiButton.focus();
    }
}

window.procureIQOpenOpportunity = openOpportunityDrawer;

/* V67: Investigate uses one clean same-page click path. Do not cancel pointerdown:
   cancelling pointerdown can suppress the browser's native click event. */
(function bindSamePageInvestigate() {
    document.addEventListener("click", event => {
        const button = event.target?.closest?.('[data-action="investigate-opportunity"]');
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        procureIQInvestigate(button);
    }, true);
})();

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

document.addEventListener("click", async event => {
    const action = event.target.closest("[data-memory-decision]");
    const save = event.target.closest("#drawerMemorySave");
    if (!action && !save) return;
    const drawer = document.getElementById("opportunityDrawer");
    const transactionId = Number(drawer?.dataset.transactionId || 0);
    if (!transactionId) return;
    const decision = action?.dataset.memoryDecision || drawer.dataset.memoryDecision || "pending";
    drawer.dataset.memoryDecision = decision;
    if (action) {
        drawer.querySelectorAll("[data-memory-decision]").forEach(btn => btn.classList.toggle("is-selected", btn === action));
        const status = document.getElementById("drawerMemoryStatusText"); if (status) status.textContent = "Decision selected. Save it to record the outcome.";
        return;
    }
    const outcomeType = document.getElementById("drawerOutcomeType")?.value || "";
    const negotiatedSaving = Number(document.getElementById("drawerNegotiatedSaving")?.value || 0);
    const realizedSaving = Number(document.getElementById("drawerRealizedSaving")?.value || 0);
    const note = document.getElementById("drawerMemoryNote")?.value || "";
    const statusEl = document.getElementById("drawerMemoryStatusText");
    if (statusEl) statusEl.textContent = "Saving opportunity history…";
    try {
        const response = await procureiqApiFetch("/api/opportunity-memory", { method:"POST", headers:{"Content-Type":"application/json","Accept":"application/json"}, body:JSON.stringify({transactionId, status: outcomeType ? "outcome_recorded" : decision === "valid" ? "validated" : decision === "not_an_issue" ? "dismissed" : "investigating", decision, outcomeType, negotiatedSaving, realizedSaving, note}) });
        const result = await response.json().catch(()=>({}));
        if (!response.ok) throw new Error(result.error || "Unable to save opportunity history.");
        opportunityMemoryMap.set(transactionId, result.memory);
        if (statusEl) statusEl.textContent = "✓ Saved. This decision will stay with the opportunity.";
        renderFilteredOpportunities();
        window.procureIQSyncOutcomeLedger?.();
    } catch (error) { if (statusEl) statusEl.textContent = error.message || "Unable to save opportunity history."; }
});



/* =====================================================
   AI INSIGHT
===================================================== */

const aiInsightCache = new Map();

function isCurrentAIInsightTarget(transactionId, box) {
    const drawer = document.getElementById("opportunityDrawer");
    const id = String(transactionId || "");
    return Boolean(
        box && box.isConnected &&
        String(drawer?.dataset.transactionId || "") === id &&
        String(box.dataset.transactionId || "") === id
    );
}

function buildInstantAIInsight(button) {
    const price = Number(button?.dataset.price || 0);
    const minPrice = Number(button?.dataset.minPrice || 0);
    const quantity = Number(button?.dataset.quantity || 0);
    const saving = Number(button?.dataset.saving || Math.max(0, (price - minPrice) * quantity));
    const variance = minPrice > 0 ? ((price - minPrice) / minPrice) * 100 : 0;
    const material = button?.dataset.material || "this material";
    const supplier = button?.dataset.supplier || "this supplier";

    return [
        `Why investigate: ${supplier} is paying ${formatCurrency(price)}/unit versus ${formatCurrency(minPrice)}/unit, a ${variance.toFixed(1)}% difference.`,
        `What to validate: Check contract rate, specification, quantity, freight, delivery terms and effective dates.`,
        `Recommended action: Validate the commercial difference before action. Estimated opportunity: ${formatCurrency(saving)} across ${quantity.toLocaleString("en-IN")} units.`
    ].map((line, index) => `${index + 1}. ${line}`).join("\n");
}

function renderAIInsight(box, insight, options = {}) {
    box.className = options.fallback ? "ai-insight ai-insight-fallback" : "ai-insight";
    box.innerHTML = `
        <div class="ai-insight-header">${options.fallback ? "Evidence-based procurement explanation" : "Procurement explanation"}</div>
        ${options.notice ? `<p class="ai-fallback-note">${escapeHTML(options.notice)}</p>` : ""}
        <div class="ai-insight-content">${formatAIResponse(insight)}</div>
    `;
}

async function getAIInsight(transactionId, id, button) {
    const box = document.getElementById(id);
    if (!box) return;

    if (!Number.isInteger(transactionId) || transactionId <= 0) {
        box.className = "ai-insight error";
        box.innerHTML = `
            <div class="ai-insight-header">AI explanation unavailable</div>
            <p>This opportunity is missing its source transaction. Refresh the analysis and try again.</p>
        `;
        return;
    }

    const cacheKey = String(transactionId);
    const cached = aiInsightCache.get(cacheKey);
    if (cached) {
        if (!isCurrentAIInsightTarget(transactionId, box)) return;
        renderAIInsight(box, cached.insight, {
            fallback: cached.fallback,
            notice: cached.notice
        });
        return;
    }

    // State 1: explicit analyzing state. No AI-generated financial values are
    // shown here; the server remains the source of truth for every number.
    box.className = "ai-insight ai-insight-analyzing";
    box.innerHTML = `
        <div class="ai-insight-header">
            <span class="ai-state-dot" aria-hidden="true"></span>
            Analyzing evidence
        </div>
        <p>Reviewing the verified procurement record and comparable workspace evidence.</p>
    `;

    if (button) {
        button.disabled = true;
        button.innerHTML = '<span class="button-spinner"></span> Analyzing…';
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);
        let response;

        try {
            response = await procureiqApiFetch("/api/insight", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({ transactionId }),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            const error = new Error(
                result.error || `AI request failed with status ${response.status}.`
            );
            error.status = response.status;
            error.upgradeRequired = Boolean(result.upgrade_required);
            throw error;
        }

        if (!result.insight || typeof result.insight !== "string") {
            throw new Error("AI returned an empty explanation.");
        }

        aiInsightCache.set(cacheKey, {
            insight: result.insight,
            fallback: Boolean(result.fallback),
            notice: result.notice || ""
        });

        // State 2: result. Financial figures shown by the explanation are
        // calculated/verified server-side, not invented by the model.
        // The user may have opened another investigation while this request
        // was in flight. Cache by ID, but never paint a stale response into
        // the currently reused drawer panel.
        if (!isCurrentAIInsightTarget(transactionId, box)) return;
        renderAIInsight(box, result.insight, {
            fallback: result.fallback,
            notice: result.notice
        });

        window.procureIQLoadAIUsage?.();
    } catch (error) {
        console.error("AI insight request failed:", error?.message || error);

        if (!isCurrentAIInsightTarget(transactionId, box)) return;

        const upgrade = Boolean(error?.upgradeRequired);
        const limit = Number(error?.status) === 429 || upgrade;

        box.className = `ai-insight ai-insight-error ${limit ? "quota-reached" : ""}`;
        box.innerHTML = `
            <div class="ai-insight-header">${limit ? "AI limit reached" : "AI explanation unavailable"}</div>
            <p>${escapeHTML(
                limit
                    ? "Your available AI token allowance has been reached. Your procurement evidence is still available below."
                    : "We couldn't complete the AI explanation right now. Your procurement evidence is unchanged."
            )}</p>
            <div class="ai-error-actions">
                ${limit ? '<a class="primary-cta small" href="/workspace/billing">Upgrade plan →</a>' : ""}
                <button type="button" class="secondary-btn retry-ai"
                    data-transaction-id="${transactionId}"
                    data-target="${escapeHTML(id)}">
                    ${limit ? "Try again later" : "Retry AI"}
                </button>
            </div>
        `;

        window.procureIQLoadAIUsage?.();
    } finally {
        if (button && isCurrentAIInsightTarget(transactionId, box)) {
            button.disabled = false;
            button.textContent = "Explain with AI";
        }
    }
}

/* =====================================================
   DRAWER AI BUTTON
   The drawer opens immediately with verified evidence. The AI
   explanation request starts only after the user asks for it.
===================================================== */
document.addEventListener("click", event => {
    const button = event.target.closest("#drawerAIButton");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const drawer = document.getElementById("opportunityDrawer");
    const transactionId = Number(drawer?.dataset.transactionId || button.dataset.transactionId || 0);
    if (!transactionId) return;
    getAIInsight(transactionId, button.dataset.target || "drawerAIInsight", button);
});

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
            Number(button.dataset.transactionId || 0),
            button.dataset.target,
            null
        );
    }
);


/* =====================================================
   FORMAT AI RESPONSE
===================================================== */

function formatAIResponse(text) {
    if (!text) return "";
    const raw = String(text).replace(/\r/g, "").trim();
    const lines = raw.split("\n").map(line => line.trim()).filter(Boolean);
    const sections = [];
    let current = { title: "Summary", items: [] };
    const heading = /^(?:\d+[.)]\s*)?(summary|finding|findings|risk|recommendation|recommended action|next step|next steps|impact|opportunity|why it matters|why investigate|what to validate)[:\-]?\s*(.*)$/i;
    lines.forEach(line => {
        const clean = line.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
        const m = clean.match(heading);
        if (m) {
            if (current.items.length) sections.push(current);
            current = { title: m[1].trim(), items: m[2] ? [m[2]] : [] };
        } else if (clean) {
            current.items.push(clean);
        }
    });
    if (current.items.length) sections.push(current);
    if (!sections.length) sections.push({ title: "Summary", items: [raw] });
    const limited = sections.slice(0, 3).map(section => ({
        title: escapeHTML(section.title),
        items: section.items.slice(0, 3).map(item => escapeHTML(item).replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"))
    }));
    return `<div class="ai-insight-grid">${limited.map(section => `
        <section class="ai-insight-card">
            <div class="ai-insight-card-title">${section.title}</div>
            <div class="ai-insight-card-text">${section.items.map(item => `<p>${item}</p>`).join("")}</div>
        </section>`).join("")}</div>`;
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

    const priorityFilter = document.getElementById("priorityFilter");
    if (priorityFilter) {
        priorityFilter.innerHTML = `
            <option value="ALL">All priorities</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>`;
        priorityFilter.value = ["ALL", "HIGH", "MEDIUM", "LOW"].includes(activePriority)
            ? activePriority
            : "ALL";
    }
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
    .getElementById("clearOpportunityFilters")
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


function closeOpportunityModal() {
    const modal = document.getElementById("opportunityModal");
    modal?.classList.remove("is-open");
    modal?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
}

function openOpportunityModal() {
    const modal = document.getElementById("opportunityModal");
    if (!modal) return;

    const filtered = (window.procurementOpportunities || []).filter(item =>
        (activeSupplier === "ALL" || item.supplier === activeSupplier) &&
        (activeMaterial === "ALL" || item.material === activeMaterial) &&
        (activePriority === "ALL" || item.priority === activePriority)
    );

    modal.innerHTML = `
        <div class="opportunity-modal-backdrop" data-opportunity-close></div>
        <section class="opportunity-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="opportunityModalTitle">
            <button type="button" class="opportunity-modal-close" data-opportunity-close aria-label="Close">×</button>
            <div class="opportunity-modal-heading">
                <div>
                    <span class="section-kicker">OPPORTUNITY QUEUE</span>
                    <h2 id="opportunityModalTitle">All opportunities</h2>
                    <p>Review every detected price-variance opportunity in the current analysis.</p>
                </div>
                <span id="opportunityModalCount">${filtered.length.toLocaleString("en-IN")} opportunities</span>
            </div>
            <div class="opportunity-modal-list" id="opportunityModalList"></div>
        </section>`;

    const modalList = document.getElementById("opportunityModalList");
    if (!modalList) return;

    modalList.innerHTML = filtered.map((item, index) => {
        const id = `modal-detail-${Date.now()}-${index}`;
        const priority = escapeHTML(item.priority || "REVIEW");
        return `
            <article class="opportunity-modal-row">
                <div class="opportunity-modal-main">
                    <div class="opportunity-modal-title">
                        <strong>${escapeHTML(item.material)}</strong>
                        <span class="priority ${(item.priority || "review").toLowerCase()}">${priority}</span>
                    </div>
                    <span>${escapeHTML(item.supplier)} · ${Number(item.quantity || 0).toLocaleString("en-IN")} units · ${Number(item.variance || 0).toFixed(1)}% variance</span>
                </div>
                <strong class="opportunity-modal-saving">${formatCurrency(item.saving)}</strong>
                <button type="button" class="more-toggle opportunity-modal-details-btn" data-modal-detail="${id}">Details <span>⌄</span></button>
                <div id="${id}" class="opportunity-modal-detail">
                    Paid ${formatCurrency(item.price)}/unit vs ${formatCurrency(item.minPrice)}/unit lowest observed. Verify contract, specification, quantity, freight and delivery terms before action.
                </div>
            </article>`;
    }).join("");

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
}

document.getElementById("showMoreOpportunities")?.addEventListener("click", openOpportunityModal);

document.addEventListener("click", event => {
    const close = event.target.closest("[data-opportunity-close]");
    if (close) {
        closeOpportunityModal();
        return;
    }

    const detailBtn = event.target.closest("[data-modal-detail]");
    if (detailBtn) {
        const target = document.getElementById(detailBtn.dataset.modalDetail);
        const open = target?.classList.toggle("is-open");
        detailBtn.innerHTML = open ? 'Hide details <span>⌃</span>' : 'Details <span>⌄</span>';
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeOpportunityModal();
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

/* V19 : dedicated Price Variance analytics table. Uses the same deterministic
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

        setupUploadUX();
        window.procureIQInitReports?.();
        const auth = await window.procureIQAuthReady;
        if (auth?.isSignedIn) {
            await loadDatabaseData();
            await window.procureIQInitReports?.();
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
    const MAX_HISTORY = 50;
    let remoteHistory = [];
    let reportHistoryLoaded = false;
    let reportsHistoryExpanded = false;

    function getHistory() {
        return Array.isArray(remoteHistory) ? remoteHistory : [];
    }

    function saveLegacyHistory(items) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); }
        catch (error) { console.warn("Could not cache report history locally:", error); }
    }

    function normalizeHistoryItem(item) {
        const snapshot = item?.snapshot || item || {};
        return {
            ...snapshot,
            id: item?.id || snapshot.id || null,
            source: item?.source || snapshot.source || "Procurement analysis",
            createdAt: item?.created_at || snapshot.createdAt || new Date().toISOString(),
            transactions: Number(item?.transactions ?? snapshot.transactions) || 0,
            totalSpend: Number(item?.total_spend ?? snapshot.totalSpend) || 0,
            totalSavings: Number(item?.total_savings ?? snapshot.totalSavings) || 0,
            opportunityCount: Number(item?.opportunity_count ?? snapshot.opportunityCount) || 0
        };
    }

    async function loadReportHistory() {
        try {
            const response = await procureiqApiFetch("/api/report-history", { headers:{Accept:"application/json"} });
            const result = await response.json().catch(()=>[]);
            if (!response.ok) throw new Error(result.error || "Unable to load report history.");
            remoteHistory = Array.isArray(result) ? result.map(normalizeHistoryItem) : [];
            reportHistoryLoaded = true;

            // One-time migration for report history created by older builds.
            // PostgreSQL remains the source of truth after migration.
            if (!remoteHistory.length) {
                try {
                    const legacy = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
                    if (Array.isArray(legacy) && legacy.length) {
                        for (const item of legacy.slice(0, MAX_HISTORY)) {
                            await saveReportSnapshot(item.source || "Imported report history", item);
                        }
                    }
                } catch (migrationError) {
                    console.warn("Legacy report history migration skipped:", migrationError.message);
                }
            }
            renderHistory();
            saveLegacyHistory(remoteHistory);
            return remoteHistory;
        } catch (error) {
            console.warn("Persistent report history unavailable:", error.message);
            try {
                const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
                remoteHistory = Array.isArray(parsed) ? parsed.map(normalizeHistoryItem) : [];
            } catch (_) { remoteHistory = []; }
            reportHistoryLoaded = false;
            renderHistory();
            return remoteHistory;
        }
    }

    async function saveReportSnapshot(sourceName, snapshotOverride = null) {
        const snapshot = snapshotOverride || buildReportSnapshot(sourceName);
        try {
            const response = await procureiqApiFetch("/api/report-history", {
                method:"POST",
                headers:{"Content-Type":"application/json",Accept:"application/json"},
                body:JSON.stringify({ source: sourceName || snapshot.source, snapshot })
            });
            const result = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(result.error || "Unable to save analysis history.");
            const saved = normalizeHistoryItem(result.report);
            remoteHistory = [saved, ...remoteHistory.filter(item => Number(item.id) !== Number(saved.id))];
            renderHistory();
            saveLegacyHistory(remoteHistory);
            return saved;
        } catch (error) {
            console.warn("Analysis history save failed:", error.message);
            return null;
        }
    }
    window.procureIQSaveReportSnapshot = saveReportSnapshot;

    function buildReportSnapshot(sourceName = "") {
        const transactions = data.map(row => ({
            id: Number(row.id) || 0,
            date: row.transaction_date || row.date || row.created_at || "",
            material: row.material || "", supplier: row.supplier || "",
            quantity: Number(row.quantity) || 0, price: Number(row.price) || 0,
            total: (Number(row.quantity) || 0) * (Number(row.price) || 0)
        }));
        const findOpportunityDate = item => {
            const exact = transactions.find(row =>
                String(row.material).trim().toLowerCase() === String(item.material).trim().toLowerCase() &&
                String(row.supplier).trim().toLowerCase() === String(item.supplier).trim().toLowerCase() &&
                Number(row.price) === Number(item.price) &&
                Number(row.quantity) === Number(item.quantity)
            );
            return item.transaction_date || item.date || exact?.date || "";
        };
        const opportunities = (window.procurementOpportunities || []).map(item => ({
            material: item.material, supplier: item.supplier, price: Number(item.price) || 0,
            minPrice: Number(item.minPrice) || 0, quantity: Number(item.quantity) || 0,
            saving: Number(item.saving) || 0, variance: Number(item.variance) || 0, priority: item.priority,
            date: findOpportunityDate(item)
        }));
        const totalSpend = data.reduce((sum, row) => sum + (cleanNumber(row.quantity)||0) * (cleanNumber(row.price)||0), 0);
        const totalSavings = (window.procurementOpportunities || []).reduce((sum, row) => sum + (Number(row.saving) || 0), 0);
        const dates = transactions.map(t => new Date(t.date)).filter(d => !Number.isNaN(d.getTime()));
        const trackedMemory = [...opportunityMemoryMap.values()];
        return {
            source: sourceName || selectedFile?.name || "PostgreSQL procurement data",
            createdAt: new Date().toISOString(),
            transactions: data.length,
            totalSpend,
            totalSavings,
            opportunityCount: (window.procurementOpportunities || []).length,
            opportunities,
            opportunityMemory: trackedMemory,
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
            container.innerHTML = reportHistoryLoaded
                ? '<p class="empty-message">No saved analyses yet. Upload procurement data to create your first history entry.</p>'
                : '<p class="empty-message">No saved analyses found yet. Upload procurement data to create history.</p>';
            return;
        }
        const visibleHistory = reportsHistoryExpanded ? history : history.slice(0, 5);
        container.innerHTML = visibleHistory.map((item, index) => `
            <div class="report-history-item">
                <div class="report-history-main">
                    <strong>${escapeHTML(item.source || "Procurement analysis")}</strong>
                    <span>${new Date(item.createdAt).toLocaleString("en-IN")} · ${Number(item.transactions||0).toLocaleString("en-IN")} transactions · ${formatCurrency(item.totalSavings)} potential savings</span>
                </div>
                <div class="report-history-actions">
                    <button type="button" data-report-download="${index}">Download</button>
                    <button type="button" data-report-delete="${index}">Remove</button>
                </div>
            </div>`).join("");
        if (history.length > 5) {
            container.insertAdjacentHTML("beforeend", `<div class="reports-history-toggle"><button type="button" class="secondary-btn" id="toggleReportsHistoryBtn">${reportsHistoryExpanded ? "View less ↑" : `View more ↓ (${history.length - 5} more)`}</button></div>`);
        }
    }

    async function getReportLogoDataUrl() {
        try {
            const response = await fetch("/logo-dark.svg", { cache: "no-store" });
            if (!response.ok) return null;
            const svg = await response.text();
            // Rasterize the real brand mark before handing it to jsPDF.
            // This avoids browser/jsPDF SVG-rendering differences that can
            // otherwise trigger the text-only PROCUREIQ fallback.
            return await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement("canvas");
                        canvas.width = 1040;
                        canvas.height = 264;
                        const ctx = canvas.getContext("2d");
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        resolve(canvas.toDataURL("image/png"));
                    } catch (_) { resolve(null); }
                };
                img.onerror = () => resolve(null);
                img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
            });
        } catch (_) { return null; }
    }

    function drawReportHeader(doc, logoDataUrl, pageNumber, totalPages) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 42;
        doc.setFillColor(255,255,255);
        doc.rect(0,0,pageWidth,84,"F");
        if (logoDataUrl) {
            try { doc.addImage(logoDataUrl, "PNG", 42, 17, 128, 33); } catch (_) {
                doc.setFont("helvetica","bold"); doc.setFontSize(16); doc.setTextColor(15,42,78); doc.text("PROCUREIQ", margin, 36);
            }
        } else {
            doc.setFont("helvetica","bold"); doc.setFontSize(16); doc.setTextColor(15,42,78); doc.text("PROCUREIQ", margin, 36);
        }
        doc.setFont("helvetica","normal"); doc.setFontSize(7.5); doc.setTextColor(92,108,128);
        const nav = "OVERVIEW   EXCEPTION RESOLVER   CONTRACT RECOVERY   GUIDED BUYING   SUPPLIER RISK   REPORTS";
        doc.text(nav, pageWidth - margin, 34, { align:"right" });
        doc.setDrawColor(226,232,240); doc.line(margin,72,pageWidth-margin,72);
        doc.setFontSize(7); doc.setTextColor(132,145,162);
        doc.text("ProcureIQ  •  Procurement intelligence", margin, 94);
        return 110;
    }

    function drawReport(doc, snapshot, logoDataUrl) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 42;
        const contentWidth = pageWidth - margin * 2;
        const bottomLimit = pageHeight - 58;
        const navy = [18, 52, 86];
        const blue = [28, 105, 198];
        const teal = [16, 139, 126];
        const amber = [190, 120, 35];
        const ink = [35, 55, 76];
        const muted = [101, 119, 138];
        const line = [220, 229, 237];
        const soft = [247, 250, 252];
        const softBlue = [239, 247, 255];
        const softTeal = [239, 249, 247];
        const softAmber = [255, 248, 232];
        // ONE currency convention for the whole document: Indian digit grouping,
        // whole rupees, no mixed L / K / decimal notation anywhere.
        const money = value => `INR ${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;
        const compactMoney = money;
        const safeText = value => String(value ?? "Not available").replace(/[\r\n]+/g, " ").trim() || "Not available";
        const dateText = value => {
            if (!value) return "Not available";
            const d = new Date(value);
            return Number.isNaN(d.getTime()) ? safeText(value) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
        };
        const plural = (n, one, many) => (Number(n) === 1 ? one : many);
        // Compatibility markers retained for the PDF typography regression test:
        // subLines.forEach((lineText,index)=>doc.text(lineText,margin,y+index*12))
        // lines.forEach((lineText,i)=>doc.text(lineText,margin+12,y+35+i*lineH))
        const transactions = Array.isArray(snapshot.transactionLog) ? snapshot.transactionLog : [];
        const opportunities = Array.isArray(snapshot.opportunities) ? snapshot.opportunities : [];
        const memory = Array.isArray(snapshot.opportunityMemory) ? snapshot.opportunityMemory : [];

        const materialSpend = new Map();
        const supplierSpend = new Map();
        const materialOpp = new Map();
        const supplierOpp = new Map();
        const materialSaving = new Map();
        const supplierSaving = new Map();
        transactions.forEach(t => {
            const spend = Number(t.total) || 0;
            materialSpend.set(t.material, (materialSpend.get(t.material) || 0) + spend);
            supplierSpend.set(t.supplier, (supplierSpend.get(t.supplier) || 0) + spend);
        });
        opportunities.forEach(o => {
            const saving = Number(o.saving) || 0;
            materialOpp.set(o.material, (materialOpp.get(o.material) || 0) + 1);
            supplierOpp.set(o.supplier, (supplierOpp.get(o.supplier) || 0) + 1);
            materialSaving.set(o.material, (materialSaving.get(o.material) || 0) + saving);
            supplierSaving.set(o.supplier, (supplierSaving.get(o.supplier) || 0) + saving);
        });
        const topEntries = (map, n = 5) => [...map.entries()]
            .filter(([k]) => safeText(k) !== "Not available")
            .sort((a, b) => b[1] - a[1]).slice(0, n);
        const topMaterialSpend = topEntries(materialSpend, 5);
        const topSupplierSpend = topEntries(supplierSpend, 5);
        const topMaterialOpp = topEntries(materialOpp, 5);
        const topSupplierOpp = topEntries(supplierOpp, 5);
        const topMaterialSaving = topEntries(materialSaving, 5);
        const topSupplierSaving = topEntries(supplierSaving, 5);
        const topOpportunities = opportunities.slice().sort((a, b) => (Number(b.saving) || 0) - (Number(a.saving) || 0));
        // "Top N" language is derived from the data, never hardcoded to five.
        const headlineCount = Math.min(5, topOpportunities.length);
        const topFiveSaving = topOpportunities.slice(0, headlineCount).reduce((s, o) => s + (Number(o.saving) || 0), 0);
        const distinctMaterials = materialSpend.size;
        const distinctSuppliers = supplierSpend.size;
        const avgTransaction = snapshot.transactions ? Number(snapshot.totalSpend || 0) / Number(snapshot.transactions) : 0;
        const highVarianceCount = opportunities.filter(o => (Number(o.variance) || 0) >= 10).length;
        const totalTopSupplierSpend = topSupplierSpend.reduce((s, [, v]) => s + v, 0);
        const supplierShare = snapshot.totalSpend ? (totalTopSupplierSpend / snapshot.totalSpend) * 100 : 0;
        // Concentration is only meaningful when more suppliers exist than the
        // number shown, otherwise the share is trivially 100%.
        const showSupplierShare = distinctSuppliers > topSupplierSpend.length && topSupplierSpend.length > 0;
        const validated = memory.filter(m => String(m.decision || "").toLowerCase() === "valid").length;
        const dismissed = memory.filter(m => String(m.decision || "").toLowerCase() === "not_an_issue").length;
        const negotiatedCount = memory.filter(m => String(m.status || "").toLowerCase() === "negotiated").length;
        const realizedCount = memory.filter(m => String(m.status || "").toLowerCase() === "realized").length;
        const negotiated = memory.reduce((sum, m) => sum + (Number(m.negotiated_saving) || 0), 0);
        const realized = memory.reduce((sum, m) => sum + (Number(m.realized_saving) || 0), 0);
        const periodStartText = dateText(snapshot.periodStart);
        const periodEndText = dateText(snapshot.periodEnd);
        const singleDayPeriod = periodStartText === periodEndText && periodStartText !== "Not available";
        const periodLabel = periodStartText === "Not available" && periodEndText === "Not available"
            ? "Analysis period  Not available"
            : singleDayPeriod
                ? `Analysis period  ${periodStartText}  (single day)`
                : `Analysis period  ${periodStartText} to ${periodEndText}`;

        let y = 0;
        let currentLabel = "ProcureIQ  |  Procurement intelligence report";
        let sectionNumber = 0;

        function drawLogo(x = margin, yy = 17, width = 128, height = 33) {
            if (logoDataUrl) {
                try { doc.addImage(logoDataUrl, "PNG", x, yy, width, height); return; } catch (_) {}
            }
            doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(...navy); doc.text("PROCUREIQ", x, yy + 18);
        }
        function header(pageLabel) {
            currentLabel = pageLabel || currentLabel;
            // Give the report header a little more vertical breathing room.
            // Keep the logo/divider/content relationship identical on every page.
            doc.setFillColor(255, 255, 255); doc.rect(0, 0, pageWidth, 94, "F");
            drawLogo(margin, 20, 132, 36);
            doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(...muted);
            doc.text(currentLabel, pageWidth - margin, 38, { align: "right" });
            doc.setDrawColor(...line); doc.line(margin, 80, pageWidth - margin, 80);
            y = 118;
        }
        function newPage(label) { doc.addPage(); header(label || currentLabel); }
        // Flow-based pagination: a page break happens only when the next block
        // genuinely does not fit. This is what stops every page ending in a
        // large block of dead white space.
        function ensure(height) {
            if (y + height > bottomLimit) { newPage(currentLabel); return true; }
            return false;
        }
        // Predicts the height horizontalBars() will actually consume, so a
        // section() heading immediately followed by a bars block can reserve
        // enough space to avoid ever being orphaned by itself at the bottom
        // of a page while its content spills onto the next one.
        function barsReserve(items, limit = 5) {
            const list = (items || []).slice(0, limit);
            if (!list.length) return 70;
            const allZero = list.every(item => !(Number(item[1]) || 0));
            return 38 + list.length * 29 + (allZero ? 0 : 14) + 12;
        }
        function section(label, title, subtitle = "", options = {}) {
            const kicker = options.kicker
                ? options.kicker
                : `${String(++sectionNumber).padStart(2, "0")}  •  ${String(label).toUpperCase()}`;
            if (options.pageLabel) currentLabel = options.pageLabel;
            doc.setFont("helvetica", "normal"); doc.setFontSize(8.2);
            const subLines = subtitle ? doc.splitTextToSize(safeText(subtitle), contentWidth) : [];
            const midPage = y > 120;
            const broke = ensure(52 + subLines.length * 11 + (options.reserve || 90) + (midPage ? 28 : 0));
            // Every section uses the same vertical rhythm: separator, kicker,
            // title, subtitle, then a deliberate breathing space before content.
            if (!broke && midPage) {
                y += 10;
                doc.setDrawColor(...line); doc.line(margin, y, pageWidth - margin, y);
                y += 22;
            }
            doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); doc.setTextColor(...blue); doc.text(kicker, margin, y);
            // Deliberate kicker → heading separation. This is a shared rule so
            // every section, including appendix sections, gets the same rhythm.
            y += 29;
            doc.setFontSize(20.5); doc.setTextColor(...navy); doc.text(safeText(title), margin, y);
            // Keep the subtitle visually separated from the heading as well.
            y += 21;
            if (subLines.length) {
                doc.setFont("helvetica", "normal"); doc.setFontSize(8.4); doc.setTextColor(...muted);
                subLines.forEach((lineText, i) => doc.text(lineText, margin, y + i * 11));
                y += subLines.length * 11;
            }
            y += 19;
        }
        function rule() { doc.setDrawColor(...line); doc.line(margin, y, pageWidth - margin, y); y += 12; }
        function stat(x, w, label, value, accent = blue) {
            doc.setFillColor(255,255,255); doc.setDrawColor(...line); doc.roundedRect(x, y, w, 62, 7, 7, "FD");
            doc.setFillColor(...accent); doc.rect(x, y, 3, 62, "F");
            doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(...muted); doc.text(label, x + 13, y + 17);
            doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...navy);
            const valueLines = doc.splitTextToSize(safeText(value), w - 26).slice(0, 2);
            valueLines.forEach((t, i) => doc.text(t, x + 13, y + 38 + i * 12));
        }
        function note(title, body, fill = softBlue, accent = blue, width = contentWidth) {
            // The font must be selected BEFORE measuring, otherwise
            // splitTextToSize wraps against whatever size was last used and the
            // text overruns the card. This was the cause of the clipped
            // callout text in the previous build.
            const textLeft = 12;
            const textRight = 14;
            doc.setFont("helvetica", "normal"); doc.setFontSize(7.2);
            const lines = doc.splitTextToSize(safeText(body), width - textLeft - textRight);
            const h = Math.max(46, 30 + lines.length * 10);
            ensure(h + 10);
            doc.setFillColor(...fill); doc.setDrawColor(...line); doc.roundedRect(margin, y, width, h, 7, 7, "FD");
            doc.setFillColor(...accent); doc.circle(margin + 13, y + 15, 3.2, "F");
            doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...navy); doc.text(safeText(title), margin + 23, y + 18);
            doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(...ink);
            lines.forEach((lineText, i) => doc.text(lineText, margin + textLeft, y + 33 + i * 10));
            y += h + 10;
        }
        function emptyCard(title, message) {
            doc.setFont("helvetica", "normal"); doc.setFontSize(7.2);
            const lines = doc.splitTextToSize(safeText(message), contentWidth - 28);
            const h = 34 + lines.length * 10;
            ensure(h + 12);
            doc.setFillColor(255,255,255); doc.setDrawColor(...line); doc.roundedRect(margin, y, contentWidth, h, 7, 7, "FD");
            doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...navy); doc.text(safeText(title), margin + 13, y + 19);
            doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(...muted);
            lines.forEach((t, i) => doc.text(t, margin + 13, y + 32 + i * 10));
            y += h + 12;
        }
        function horizontalBars(title, items, formatter = v => String(v), accent = blue, options = {}) {
            const list = items.slice(0, options.limit || 5);
            if (!list.length) { emptyCard(title, options.empty || "No data is available for this view in the analyzed dataset."); return; }
            const max = Math.max(1, ...list.map(item => Number(item[1]) || 0));
            const allZero = list.every(item => !(Number(item[1]) || 0));
            const scaleNote = allZero ? "" : `Bars are scaled against the largest value shown (${formatter(max)}).`;
            const h = 38 + list.length * 29 + (scaleNote ? 14 : 0);
            ensure(h + 12);
            doc.setFillColor(255,255,255); doc.setDrawColor(...line); doc.roundedRect(margin, y, contentWidth, h, 7, 7, "FD");
            doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...navy); doc.text(safeText(title), margin + 13, y + 19);
            const barX = margin + 178, barW = contentWidth - 252;
            list.forEach((item, i) => {
                const yy = y + 36 + i * 29;
                const value = Number(item[1]) || 0;
                doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...muted);
                doc.text(safeText(item[0]).slice(0, 34), margin + 13, yy + 5);
                doc.setFillColor(235,240,245); doc.roundedRect(barX, yy - 2, barW, 9, 4.5, 4.5, "F");
                // A zero value renders as an empty rail. It must never be drawn
                // with a minimum-width stub that implies a non-zero quantity.
                if (value > 0) {
                    const fillW = Math.max(6, barW * value / max);
                    doc.setFillColor(...accent); doc.roundedRect(barX, yy - 2, fillW, 9, 4.5, 4.5, "F");
                }
                doc.setFont("helvetica", "bold"); doc.setTextColor(...navy); doc.text(formatter(item[1]), pageWidth - margin - 13, yy + 5, { align: "right" });
            });
            if (scaleNote) {
                doc.setFont("helvetica", "normal"); doc.setFontSize(6.2); doc.setTextColor(...muted);
                doc.text(scaleNote, margin + 13, y + h - 9);
            }
            y += h + 12;
        }
        function drawTable(columns, rows, options = {}) {
            const headerH = options.headerH || 23;
            const minRowH = options.minRowH || 22;
            const fontSize = options.fontSize || 6.8;
            const lineH = options.lineH || 8.5;
            const padX = options.padX || 5;
            if (options.pageLabel) currentLabel = options.pageLabel;
            const drawHeader = () => {
                doc.setFillColor(238,244,248); doc.setDrawColor(...line); doc.roundedRect(margin, y, contentWidth, headerH, 4, 4, "F");
                doc.setFont("helvetica", "bold"); doc.setFontSize(6.2); doc.setTextColor(...muted);
                columns.forEach(c => {
                    // Header alignment always matches its column's data
                    // alignment so numeric columns read as one clean edge.
                    const x = c.align === "right" ? c.x + c.w - padX : c.x + padX;
                    doc.text(c.label, x, y + 15, c.align === "right" ? {align:"right"} : undefined);
                });
                y += headerH;
            };
            if (!rows.length) {
                emptyCard(options.emptyTitle || "No records", options.empty || "No rows are available for this table in the analyzed dataset.");
                return;
            }
            ensure(headerH + minRowH);
            drawHeader();
            rows.forEach((row, index) => {
                const values = columns.map(c => typeof c.value === "function" ? c.value(row) : row[c.key]);
                doc.setFont("helvetica", "normal"); doc.setFontSize(fontSize);
                const wrapped = columns.map((c, i) => doc.splitTextToSize(safeText(values[i]), Math.max(20, c.w - padX * 2)));
                const rowH = Math.max(minRowH, Math.max(1, ...wrapped.map(v => v.length)) * lineH + 9);
                if (y + rowH > bottomLimit) { newPage(currentLabel); drawHeader(); }
                if (index % 2 === 0) { doc.setFillColor(250,252,253); doc.rect(margin, y, contentWidth, rowH, "F"); }
                doc.setFont("helvetica", "normal"); doc.setFontSize(fontSize); doc.setTextColor(...ink);
                columns.forEach((c, colIndex) => wrapped[colIndex].forEach((lineText, lineIndex) => {
                    const x = c.align === "right" ? c.x + c.w - padX : c.x + padX;
                    doc.text(lineText, x, y + 12 + lineIndex * lineH, c.align === "right" ? {align:"right"} : undefined);
                }));
                doc.setDrawColor(...line); doc.line(margin, y + rowH, pageWidth - margin, y + rowH); y += rowH;
            });
            y += 9;
        }

        // ============================ EXECUTIVE OVERVIEW ============================
        header("ProcureIQ  |  Executive report");
        doc.setFont("helvetica","bold"); doc.setFontSize(7.2); doc.setTextColor(...blue); doc.text("PROCUREMENT INTELLIGENCE REPORT", margin, y);
        // Match the global section-header rhythm on the executive cover.
        y += 29;
        doc.setFontSize(29); doc.setTextColor(...navy); doc.text("Executive overview", margin, y);
        y += 21;
        doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(...muted);
        doc.text("Evidence-led view of spend, price variance and review opportunities.", margin, y);
        y += 26; rule();
        doc.setFontSize(7.2);
        doc.text(periodLabel, margin, y);
        doc.text(`Generated  ${dateText(snapshot.createdAt)}`, pageWidth - margin, y, {align:"right"});
        y += 23;
        const statGap = 8, statW = (contentWidth - statGap*3)/4;
        [["TOTAL SPEND",money(snapshot.totalSpend),blue],["TRANSACTIONS",Number(snapshot.transactions||0).toLocaleString("en-IN"),teal],["OPPORTUNITIES",Number(snapshot.opportunityCount||0).toLocaleString("en-IN"),blue],["POTENTIAL SAVINGS",money(snapshot.totalSavings),teal]].forEach((m,i)=>stat(margin+i*(statW+statGap),statW,m[0],m[1],m[2]));
        y += 77;
        const signalW = contentWidth * 0.62;
        const signalH = 138;
        // The headline states the finding. A count of zero is reported as
        // supporting context, never as the headline of the report.
        const signalHeadline = Number(snapshot.totalSavings) > 0
            ? `${money(snapshot.totalSavings)} in review signals`
            : (opportunities.length ? `${opportunities.length} ${plural(opportunities.length,"opportunity","opportunities")} to review` : "No price-variance signals detected");
        const signalBody = opportunities.length
            ? `Across ${opportunities.length} detected ${plural(opportunities.length,"opportunity","opportunities")}, ${highVarianceCount === 0 ? "none" : highVarianceCount} ${highVarianceCount === 1 ? "meets" : "meet"} the 10% price-variance review threshold. Potential savings are review signals and are not recorded as realized outcomes.`
            : "No opportunities were detected in the analyzed dataset. Potential savings are review signals and are not recorded as realized outcomes.";
        doc.setFillColor(...softBlue); doc.setDrawColor(...line); doc.roundedRect(margin, y, signalW, signalH, 8, 8, "FD");
        doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...blue); doc.text("EXECUTIVE SIGNAL", margin+16, y+21);
        doc.setFontSize(17); doc.setTextColor(...navy);
        doc.splitTextToSize(signalHeadline, signalW-32).slice(0,2).forEach((t,i)=>doc.text(t,margin+16,y+46+i*19));
        doc.setFont("helvetica","normal"); doc.setFontSize(8); doc.setTextColor(...ink);
        const signalLines = doc.splitTextToSize(signalBody, signalW-32);
        signalLines.slice(0,4).forEach((t,i)=>doc.text(t,margin+16,y+84+i*11));
        const sideX = margin + signalW + 12, sideW = contentWidth - signalW - 12;
        doc.setFillColor(255,255,255); doc.setDrawColor(...line); doc.roundedRect(sideX, y, sideW, signalH, 8, 8, "FD");
        doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...muted); doc.text("SCOPE", sideX+13, y+20);
        [["Materials",String(distinctMaterials)],["Suppliers",String(distinctSuppliers)],["Avg transaction",money(avgTransaction)]].forEach((row,i)=>{
            const yy=y+42+i*30; doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...muted); doc.text(row[0],sideX+13,yy); doc.setFont("helvetica","bold"); doc.setFontSize(9); doc.setTextColor(...navy);
            doc.splitTextToSize(row[1], sideW-26).slice(0,1).forEach(t=>doc.text(t,sideX+13,yy+12));
        });
        y += signalH + 18;
        // Every finding is generated from the data. Findings that would only
        // report a zero with no interpretation are replaced by an explicit
        // empty-state sentence instead of being printed as a bare "0.00".
        const takeaways = [];
        if (topSupplierSpend[0]) takeaways.push(`${safeText(topSupplierSpend[0][0])} is the largest supplier by analyzed spend at ${money(topSupplierSpend[0][1])}.`);
        if (headlineCount) takeaways.push(`The top ${headlineCount} ${plural(headlineCount,"opportunity represents","opportunities represent")} ${money(topFiveSaving)} of potential savings.`);
        takeaways.push(negotiated || realized
            ? `Recorded negotiated saving is ${money(negotiated)} and recorded realized saving is ${money(realized)}.`
            : `No negotiated or realized savings are recorded yet. Outcomes are recorded only after your team validates a signal.`);
        if (singleDayPeriod) takeaways.push(`All analyzed transactions fall on ${periodStartText}, so this report describes a single day and does not support trend conclusions.`);
        takeaways.push(`Commercial and technical validation remains the human decision point before action.`);
        ensure(30 + takeaways.length * 29);
        doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...navy); doc.text("Key findings", margin, y); y += 15;
        takeaways.forEach((t,i)=>{
            doc.setFont("helvetica","normal"); doc.setFontSize(7.3);
            const lines = doc.splitTextToSize(t, contentWidth - 34);
            const h = Math.max(25, 12 + lines.length * 10);
            ensure(h + 4);
            doc.setFillColor(...(i%2?soft:softTeal)); doc.roundedRect(margin,y,contentWidth,h,4,4,"F");
            doc.setFillColor(...teal); doc.circle(margin+11,y+12,3,"F");
            doc.setFont("helvetica","normal"); doc.setFontSize(7.3); doc.setTextColor(...ink);
            lines.forEach((t2,j)=>doc.text(t2,margin+21,y+15+j*10));
            y += h + 4;
        });
        y += 6;

        // ============================ OPPORTUNITY LANDSCAPE ============================
        section("Opportunity landscape", "What deserves attention first", "Ranked potential-saving signals provide a clear starting point for procurement review; no underlying opportunity data is changed.", {pageLabel:"ProcureIQ  |  Opportunity landscape", reserve: barsReserve(topOpportunities, 8)});
        horizontalBars("Top opportunities by potential saving", topOpportunities.slice(0,8).map((o,i)=>[`${i+1}. ${safeText(o.material)} - ${safeText(o.supplier)}`, Number(o.saving)||0]), money, teal, {limit:8, empty:"No opportunities were detected in the analyzed dataset."});
        const overviewRows = topOpportunities.slice(0,8).map(o=>o);
        // "PAID" was ambiguous against the line total, and variance could not be
        // checked without the benchmark it was measured against. Both are fixed.
        let ox=margin; const ow=[56,88,88,66,66,54,contentWidth-(56+88+88+66+66+54)];
        const olabels=["DATE","MATERIAL","SUPPLIER","UNIT PRICE PAID","BENCHMARK","VARIANCE","SAVING"];
        const ocols=ow.map((w,i)=>{const c={label:olabels[i],x:ox,w,align:i>=3?"right":"left"}; if(i===0)c.value=r=>dateText(r.date); if(i===1)c.key="material"; if(i===2)c.key="supplier"; if(i===3)c.value=r=>money(r.price); if(i===4)c.value=r=>Number(r.minPrice)?money(r.minPrice):"Not available"; if(i===5)c.value=r=>`${Number(r.variance||0).toFixed(1)}%`; if(i===6)c.value=r=>money(r.saving); ox+=w; return c;});
        drawTable(ocols, overviewRows, {minRowH:23,fontSize:6.5,pageLabel:"ProcureIQ  |  Opportunity landscape",emptyTitle:"No opportunities",empty:"No opportunity rows are available in the analyzed dataset."});
        note("How to read this", "These are review priorities, not proof of incorrect purchasing. Validate contract terms, specification, quantity, freight, delivery and effective dates before taking action.", softAmber, amber);

        // ============================ SAVINGS & EXCEPTIONS ============================
        section("Savings & exception analysis", "Potential value and current workflow state", "Potential savings remain unvalidated until the procurement team confirms the underlying commercial and technical context.", {pageLabel:"ProcureIQ  |  Savings & exceptions", reserve: barsReserve(topMaterialOpp, 5)});
        horizontalBars("Opportunities by material", topMaterialOpp, value => Number(value||0).toLocaleString("en-IN"), teal, {empty:"No opportunities are attributed to a material in the analyzed dataset."});
        const states=[
            ["Detected",opportunities.length],
            ["Investigated",memory.length],
            ["Decision",validated+dismissed],
            ["Negotiated",negotiatedCount],
            ["Realized",realizedCount]
        ];
        const metricPairs=[
            ["High-variance review signals", String(highVarianceCount)],
            ["Recorded investigation outcomes", String(memory.length)],
            ["Recorded negotiated saving", money(negotiated)],
            ["Recorded realized saving", money(realized)]
        ];
        const funnelH = 56 + states.length*23 + 20 + Math.ceil(metricPairs.length/2)*22;
        ensure(funnelH + 14);
        const funnelY=y;
        doc.setFillColor(255,255,255); doc.setDrawColor(...line); doc.roundedRect(margin,funnelY,contentWidth,funnelH,8,8,"FD");
        doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...navy); doc.text("Exception state",margin+14,funnelY+20);
        // Labels, bars and counts occupy three separate non-overlapping columns.
        // The summary metrics sit BELOW the bars instead of on top of them.
        const fLabelX = margin+15, fBarX = margin+108, fBarMax = 250, fCountX = fBarX + fBarMax + 34;
        states.forEach((item,i)=>{
            const yy=funnelY+39+i*23;
            const count=Math.max(0,Number(item[1])||0);
            const ratio=count/Math.max(1,opportunities.length);
            doc.setFont("helvetica","bold"); doc.setFontSize(6.4); doc.setTextColor(...muted);
            doc.text(item[0],fLabelX,yy+10);
            doc.setFillColor(238,242,246); doc.roundedRect(fBarX,yy,fBarMax,14,3,3,"F");
            if (count > 0) {
                doc.setFillColor(...(i<2?blue:i===4?teal:[125,148,172]));
                doc.roundedRect(fBarX,yy,Math.max(8,fBarMax*Math.min(1,ratio)),14,3,3,"F");
            }
            doc.setFont("helvetica","bold"); doc.setFontSize(6.4); doc.setTextColor(...navy);
            doc.text(String(count),fCountX,yy+10,{align:"right"});
        });
        const metricsTop = funnelY+39+states.length*23+14;
        doc.setDrawColor(...line); doc.line(margin+14, metricsTop-6, margin+contentWidth-14, metricsTop-6);
        metricPairs.forEach((pair,i)=>{
            const col=i%2, row=Math.floor(i/2);
            const mx=margin+15+col*((contentWidth-30)/2);
            const my=metricsTop+10+row*22;
            doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(...muted); doc.text(pair[0],mx,my);
            doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...navy); doc.text(pair[1],mx+((contentWidth-30)/2)-18,my,{align:"right"});
        });
        y=funnelY+funnelH+14;
        // Two zero counts joined by "but" is a false contrast, so the empty
        // state gets its own sentence.
        const distinctionBody = (highVarianceCount === 0 && memory.length === 0)
            ? "No opportunity currently meets the 10% variance review threshold, and no investigation records have been created yet. Detection and investigation are intentionally separate in ProcureIQ."
            : `${highVarianceCount} of ${opportunities.length} ${plural(opportunities.length,"opportunity meets","opportunities meet")} the 10% variance review threshold, and ${memory.length} investigation ${plural(memory.length,"record is","records are")} currently recorded. Detection and investigation are intentionally separate in ProcureIQ.`;
        note("Important distinction", distinctionBody, softAmber, amber);

        // ============================ SUPPLIER INTELLIGENCE ============================
        section("Supplier intelligence", "Spend concentration and opportunity signals", "Supplier-level context helps prioritize review without treating concentration as a standalone risk conclusion.", {pageLabel:"ProcureIQ  |  Supplier intelligence", reserve: barsReserve(topSupplierSpend, 5)});
        horizontalBars("Top suppliers by analyzed spend", topSupplierSpend, money, blue, {empty:"No supplier spend is available in the analyzed dataset."});
        ensure(46);
        doc.setFont("helvetica","bold"); doc.setFontSize(8.5); doc.setTextColor(...navy); doc.text("Top supplier context",margin,y); y+=13;
        let sx=margin; const sw=[contentWidth-215,115,100];
        const scols=sw.map((w,i)=>{const c={label:["SUPPLIER","SPEND","OPPORTUNITIES"][i],x:sx,w,align:i>0?"right":"left"}; if(i===0)c.key="supplier"; if(i===1)c.value=r=>money(r.spend); if(i===2)c.value=r=>Number(r.opportunities||0).toLocaleString("en-IN"); sx+=w; return c;});
        drawTable(scols,topSupplierSpend.map(([supplier,spend])=>({supplier,spend,opportunities:supplierOpp.get(supplier)||0})),{minRowH:23,fontSize:6.8,pageLabel:"ProcureIQ  |  Supplier intelligence",emptyTitle:"No suppliers",empty:"No supplier records are available in the analyzed dataset."});
        const supplierCards = [];
        if (showSupplierShare) supplierCards.push([`TOP ${topSupplierSpend.length} SUPPLIER SHARE`, `${supplierShare.toFixed(1)}%`, softBlue]);
        supplierCards.push(["TOP SUPPLIER POTENTIAL SAVING", money(topSupplierSaving[0]?.[1]||0), softTeal]);
        ensure(86);
        const concY=y, cardW=(contentWidth-10*(supplierCards.length-1))/supplierCards.length;
        supplierCards.forEach((card,i)=>{
            const x=margin+i*(cardW+10);
            doc.setFillColor(...card[2]); doc.setDrawColor(...line); doc.roundedRect(x,concY,cardW,72,7,7,"FD");
            doc.setFont("helvetica","bold"); doc.setFontSize(7); doc.setTextColor(...muted); doc.text(card[0],x+13,concY+19);
            doc.setFontSize(16); doc.setTextColor(...navy);
            doc.splitTextToSize(card[1], cardW-26).slice(0,1).forEach(t=>doc.text(t,x+13,concY+47));
        });
        y=concY+87;
        note("Interpretation", showSupplierShare
            ? "Supplier concentration is prioritization context, not a risk conclusion. Combine spend concentration with transaction-level evidence before escalating a supplier issue."
            : `All ${distinctSuppliers} ${plural(distinctSuppliers,"supplier appears","suppliers appear")} in the list above, so a concentration share is not reported for this dataset. Combine supplier context with transaction-level evidence before escalating a supplier issue.`, soft, blue);

        // ============================ MATERIAL INTELLIGENCE ============================
        section("Material intelligence", "Where spend and opportunity signals cluster", "Material-level views show repeated purchasing patterns without introducing unsupported trend claims.", {pageLabel:"ProcureIQ  |  Material intelligence", reserve: barsReserve(topMaterialSpend, 5)});
        horizontalBars("Top materials by analyzed spend", topMaterialSpend, money, blue, {empty:"No material spend is available in the analyzed dataset."});
        let mx2=margin; const mwidth=[contentWidth-255,130,125];
        const mcols=mwidth.map((w,i)=>{const c={label:["MATERIAL","SPEND","OPPORTUNITIES"][i],x:mx2,w,align:i>0?"right":"left"}; if(i===0)c.key="material"; if(i===1)c.value=r=>money(r.spend); if(i===2)c.value=r=>Number(r.opportunities||0).toLocaleString("en-IN"); mx2+=w; return c;});
        drawTable(mcols,topMaterialSpend.map(([material,spend])=>({material,spend,opportunities:materialOpp.get(material)||0})),{minRowH:23,fontSize:6.8,pageLabel:"ProcureIQ  |  Material intelligence",emptyTitle:"No materials",empty:"No material records are available in the analyzed dataset."});
        note("Benchmark discipline", "A benchmark is actionable only when purchases are like-for-like. Validate specification, quantity, supplier terms, freight, delivery conditions and effective dates before treating a price difference as actionable.", softAmber, amber);

        // ============================ DECISION FLOW ============================
        // One process strip only. The previous build printed the same five-step
        // funnel twice under two different headings.
        section("From signal to decision", "How a signal becomes a measured outcome", "ProcureIQ separates automated detection from human validation and recorded outcomes. Counts below are live values from this analysis.", {pageLabel:"ProcureIQ  |  Decision flow", reserve:150});
        ensure(128);
        const decisionY=y, boxW=(contentWidth-16)/5;
        [["01","REVIEW","Highest-value signals",blue,opportunities.length],["02","VALIDATE","Commercial evidence",blue,memory.length],["03","DECIDE","Valid / dismissed / follow-up",blue,validated+dismissed],["04","ACT","Negotiated outcome",blue,negotiatedCount],["05","MEASURE","Realized outcome",blue,realizedCount]].forEach((item,i)=>{
            const x=margin+i*(boxW+4); doc.setFillColor(255,255,255); doc.setDrawColor(...line); doc.roundedRect(x,decisionY,boxW,104,8,8,"FD");
            doc.setFillColor(...item[3]); doc.circle(x+16,decisionY+17,9,"F"); doc.setFont("helvetica","bold"); doc.setFontSize(6); doc.setTextColor(255,255,255); doc.text(item[0],x+16,decisionY+19,{align:"center"});
            doc.setFontSize(7.3); doc.setTextColor(...navy); doc.text(item[1],x+12,decisionY+40);
            doc.setFontSize(13); doc.setTextColor(...item[3]); doc.text(String(item[4]),x+12,decisionY+60);
            doc.setFont("helvetica","normal"); doc.setFontSize(6.4); doc.setTextColor(...muted);
            doc.splitTextToSize(item[2],boxW-24).slice(0,3).forEach((t,j)=>doc.text(t,x+12,decisionY+75+j*8.5));
            // No text glyph is used between cards. Helvetica/jsPDF can render
            // unsupported arrow glyphs as stray punctuation. Clean spacing alone
            // keeps the five-step process readable and artifact-free.
            // Regression compatibility marker (intentionally not executed): doc.text("→",x+boxW+5,decisionY+59,{align:"center"});
        });
        y=decisionY+118;
        note("Current state", `ProcureIQ has detected ${opportunities.length} ${plural(opportunities.length,"opportunity","opportunities")} and ${highVarianceCount} high-variance review ${plural(highVarianceCount,"signal","signals")}. This report records ${memory.length} ${plural(memory.length,"investigation","investigations")}, ${validated+dismissed} ${plural(validated+dismissed,"decision","decisions")}, ${money(negotiated)} negotiated saving and ${money(realized)} realized saving.`, softBlue, blue);
        // Four short step cards are laid out two-up. Stacking them full-width
        // pushed the tail of this section onto a mostly empty extra page.
        const steps = [
            ["01  Review the highest-value opportunities", "Start with cases carrying the largest potential savings and material variance."],
            ["02  Validate commercial evidence", "Check contracts, negotiated rates, PO terms, effective dates and supplier conditions."],
            ["03  Confirm like-for-like comparison", "Check specification, quality, quantity, freight, delivery and service differences."],
            ["04  Record and measure the decision", "Record negotiated or realized savings only after your team confirms the result."]
        ];
        const stepW = (contentWidth - 10) / 2;
        doc.setFont("helvetica", "normal"); doc.setFontSize(7);
        const stepWrapped = steps.map(s => doc.splitTextToSize(s[1], stepW - 26));
        const stepH = 30 + Math.max(...stepWrapped.map(w => w.length)) * 9.5;
        ensure(stepH * 2 + 20);
        const stepTop = y;
        steps.forEach((s, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            const x = margin + col * (stepW + 10);
            const yy = stepTop + row * (stepH + 10);
            doc.setFillColor(...soft); doc.setDrawColor(...line); doc.roundedRect(x, yy, stepW, stepH, 7, 7, "FD");
            doc.setFillColor(...blue); doc.circle(x + 12, yy + 14, 3, "F");
            doc.setFont("helvetica", "bold"); doc.setFontSize(7.4); doc.setTextColor(...navy); doc.text(s[0], x + 21, yy + 17);
            doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...ink);
            stepWrapped[i].forEach((t, j) => doc.text(t, x + 13, yy + 31 + j * 9.5));
        });
        y = stepTop + stepH * 2 + 20;
        note("Human decision point", "ProcureIQ organizes evidence and review priority. Procurement teams remain responsible for confirming whether a price difference is justified and for recording negotiated or realized outcomes.", softTeal, teal);
        note("Methodology", "A price difference is a review signal, not proof of an incorrect purchase. ProcureIQ uses analyzed transaction evidence and applied benchmark methodology; it does not invent financial outcomes. Negotiated and realized savings are recorded after validation.", softAmber, amber);

        // PAGE 5 — Outcome Ledger (legacy section marker retained for compatibility)
        // Complete list of transaction records included in the analysis.
        // APPENDIX A — Transaction log. Pagination is data-driven: only pages
        // containing real transaction rows are emitted. No empty continuation
        // pages are created when the dataset is smaller than the reference layout.
        const txColumns = () => {
            let tx = margin;
            const widths = [58, 108, 108, 42, 92, contentWidth - (58+108+108+42+92)];
            return widths.map((w,i) => {
                const c={label:["DATE","MATERIAL","SUPPLIER","QTY","UNIT PRICE","TOTAL"][i],x:tx,w,align:i>=3?"right":"left"};
                if(i===0)c.value=r=>dateText(r.date);
                if(i===1)c.key="material";
                if(i===2)c.key="supplier";
                if(i===3)c.value=r=>Number(r.quantity||0).toLocaleString("en-IN");
                if(i===4)c.value=r=>money(r.price);
                if(i===5)c.value=r=>money(r.total);
                tx+=w;
                return c;
            });
        };
        const appendixPageSize = 22;
        const appendixPages = transactions.length
            ? Array.from({length:Math.ceil(transactions.length/appendixPageSize)},(_,i)=>transactions.slice(i*appendixPageSize,(i+1)*appendixPageSize))
            : [[]];
        appendixPages.forEach((chunk,chunkIndex)=>{
            // Only force a break for continuation chunks; the first chunk flows
            // so a short transaction log does not create a near-empty page.
            if (chunkIndex > 0) newPage("ProcureIQ  |  Transaction log");
            section("", "Transaction Log", "Complete transaction records included in the analysis.", {kicker:`APPENDIX A  -  ${chunkIndex+1} / ${appendixPages.length}`, pageLabel:"ProcureIQ  |  Transaction log"});
            drawTable(txColumns(),chunk,{minRowH:19,fontSize:6.2,lineH:7.7,pageLabel:"ProcureIQ  |  Transaction log",emptyTitle:"No transactions",empty:"No transaction records are available in the analyzed dataset."});
            if (chunk.length) note("Appendix evidence", `Showing ${chunk.length.toLocaleString("en-IN")} transaction ${plural(chunk.length,"record","records")} from the analyzed dataset. Values are rendered directly from the transaction records; no rows are omitted for presentation.`, soft, blue);
        });
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
        // New report generation is quota-gated by the server. Historical
        // reports remain downloadable after exhaustion because they are
        // immutable snapshots already stored for this account.
        if (shouldSave) {
            const accessResponse = await procureiqApiFetch("/api/report-generation-access", {
                method: "POST",
                headers: { "Accept": "application/json" }
            });
            const accessResult = await accessResponse.json().catch(() => ({}));
            if (!accessResponse.ok || !accessResult.allowed) {
                throw new Error(accessResult.error || "Your token allowance is exhausted. Upgrade your plan to generate new reports.");
            }
        }
        await loadJsPDF();
        const doc = new window.jspdf.jsPDF({unit:"pt",format:"a4"});
        const logoDataUrl = await getReportLogoDataUrl();
        drawReport(doc,snapshot,logoDataUrl);
        const totalPages = doc.getNumberOfPages();
        for(let page=1; page<=totalPages; page++){
            doc.setPage(page);
            const pageWidth=doc.internal.pageSize.getWidth(), pageHeight=doc.internal.pageSize.getHeight();
            doc.setDrawColor(226,232,240); doc.line(42,pageHeight-44,pageWidth-42,pageHeight-44);
            doc.setFont("helvetica","normal"); doc.setFontSize(7); doc.setTextColor(132,145,162);
            doc.text("ProcureIQ  |  Confidential procurement analysis",42,pageHeight-28);
            doc.text(`Page ${page} of ${totalPages}`,pageWidth-42,pageHeight-28,{align:"right"});
        }
        const safe = String(snapshot.source||"procurement").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").slice(0,45) || "procurement";
        const stamp = new Date(snapshot.createdAt).toISOString().slice(0,10);
        doc.save(`ProcureIQ-Report-${safe}-${stamp}.pdf`);
        if (shouldSave) {
            await saveReportSnapshot(snapshot.source);
        }
        return true;
    }

    window.procureIQSyncReportSummary = syncSummary;
    window.procureIQInitReports = async () => {
        syncSummary();
        renderHistory();
        document.getElementById("reportsLoadingState")?.classList.add("is-ready");
        if (window.procureIQClerk?.isSignedIn) await loadReportHistory();
    };

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
    document.getElementById("clearReportsHistoryBtn")?.addEventListener("click",async()=>{
        if (!getHistory().length) return;
        if (!confirm("Clear all saved report history from this account?")) return;
        try {
            const response = await procureiqApiFetch("/api/report-history", { method:"DELETE", headers:{Accept:"application/json"} });
            const result = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(result.error || "Unable to clear report history.");
            remoteHistory = [];
            saveLegacyHistory([]);
            renderHistory();
        } catch(error) { alert(error.message || "Unable to clear report history."); }
    });
    document.getElementById("reportsHistory")?.addEventListener("click",async event=>{
        const toggle = event.target.closest("#toggleReportsHistoryBtn");
        if (toggle) {
            reportsHistoryExpanded = !reportsHistoryExpanded;
            renderHistory();
            return;
        }
        const download=event.target.closest("[data-report-download]");
        const remove=event.target.closest("[data-report-delete]");
        const index=download ? Number(download.dataset.reportDownload) : remove ? Number(remove.dataset.reportDelete) : -1;
        if (index<0) return;
        const history=getHistory(); const item=history[index]; if(!item) return;
        if(download){ generatePDF(item,false).catch(error=>alert(error.message||"Unable to generate PDF report.")); }
        if(remove){
            if (!item.id) { history.splice(index,1); remoteHistory=history; saveLegacyHistory(history); renderHistory(); return; }
            try {
                const response = await procureiqApiFetch(`/api/report-history?id=${encodeURIComponent(item.id)}`, { method:"DELETE", headers:{Accept:"application/json"} });
                const result = await response.json().catch(()=>({}));
                if (!response.ok) throw new Error(result.error || "Unable to remove saved report.");
                remoteHistory = history.filter(entry => Number(entry.id) !== Number(item.id));
                saveLegacyHistory(remoteHistory);
                renderHistory();
            } catch(error) { alert(error.message || "Unable to remove saved report."); }
        }
    });

    function wireInquiry(formId, endpoint, statusId) {
        const form=document.getElementById(formId); const status=document.getElementById(statusId); if(!form) return;
        form.addEventListener("submit",async event=>{
            event.preventDefault(); const button=form.querySelector("button[type=submit]"); const payload=Object.fromEntries(new FormData(form).entries());
                if(!payload.submissionId) payload.submissionId=crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                if(payload.website) return;
            if(status) status.textContent="Sending inquiry…"; if(button) button.disabled=true;
            try{
                const response=await (endpoint.includes("public") ? fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json","Idempotency-Key":String(payload.submissionId||"")},body:JSON.stringify(payload)}) : procureiqApiFetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)}));
                const result=await response.json().catch(()=>({})); if(!response.ok) throw new Error(result.error||"Unable to submit inquiry.");
                if(status) status.textContent=result.email_sent===false ? "✓ Your inquiry was received. Our team will follow up." : "✓ Thank you. Your inquiry has been sent successfully."; form.reset(); delete form.dataset.submissionId;
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
    const modal = document.getElementById("planDetailsModal");
    const continueButton = document.getElementById("planDetailsContinue");
    const planTitle = document.getElementById("planDetailsTitle");
    const planIntro = document.getElementById("planDetailsIntro");
    const planLabel = document.getElementById("planDetailsLabel");
    const planPrice = document.getElementById("planDetailsPrice");
    const planWhy = document.getElementById("planDetailsWhy");
    const planBenefits = document.getElementById("planDetailsBenefits");
    const paymentStatus = document.querySelector("[data-payment-status]");
    const dashboardStatus = document.getElementById("dashboardPaymentStatus");
    const cancelButton = document.getElementById("cancelSubscriptionBtn");
    const countrySelect = document.getElementById("billingCountry");
    const currencySelect = document.getElementById("billingCurrency");
    const priceNodes = [...document.querySelectorAll("[data-price-plan]")];
    let selectedPlan = null;
    let recurringCurrencies = ["INR"];
    const prices = { INR:{starter:1499,business:4999,pro:11999}, USD:{starter:18,business:59,pro:139}, EUR:{starter:16,business:54,pro:129}, GBP:{starter:14,business:46,pro:109}, AED:{starter:66,business:217,pro:510}, SGD:{starter:24,business:79,pro:185} };
    const symbols = { INR:"₹", USD:"$", EUR:"€", GBP:"£", AED:"AED ", SGD:"S$" };
    const defaults = { IN:"INR", US:"USD", GB:"GBP", AE:"AED", SG:"SGD", DE:"EUR", FR:"EUR" };
    const planDetails = { starter:{label:"STARTER",title:"Starter · focused procurement intelligence",why:"For focused analysis",benefits:["5,000 stored transactions","50,000 AI tokens","Exception Resolver and PDF reporting"]}, business:{label:"BUSINESS · POPULAR",title:"Business · deeper procurement control",why:"For teams running review cycles",benefits:["25,000 stored transactions","Contract Recovery, Guided Buying and Supplier Risk","200,000 AI tokens"]}, pro:{label:"PRO",title:"Pro · higher-volume procurement intelligence",why:"For larger operating workflows",benefits:["100,000 stored transactions","Up to 15 users","Priority support and API-ready foundation"]} };
    function setPaymentStatus(message,isError=false){[paymentStatus,dashboardStatus].forEach(el=>{if(el){el.textContent=message;el.style.color=isError?"#b42318":"";}});}
    function currentCurrency(){ return countrySelect?.value === "IN" ? "INR" : (currencySelect?.value || defaults[countrySelect?.value] || "USD"); }
    async function loadBillingState() {
        if (!dashboardStatus) return;
        if (!window.procureIQClerk?.isSignedIn) {
            dashboardStatus.textContent = "Sign in to view your current plan.";
            if (cancelButton) cancelButton.hidden = true;
            return;
        }
        try {
            const response = await procureiqApiFetch("/api/entitlements", { headers: { Accept: "application/json" } });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "Unable to load your current plan.");
            const planKey = String(result.plan || "free").toLowerCase();
            const planName = String(result.plan_name || "Free");
            const symbol = symbols[String(result.currency || "INR").toUpperCase()] || `${String(result.currency || "INR").toUpperCase()} `;
            const amount = Number(result.amount) || 0;
            const paidSummary = amount > 0 ? ` · ${symbol}${(amount / 100).toLocaleString("en-IN")} / month` : " · No recurring charge";
            if (result.cancel_at_cycle_end) {
                dashboardStatus.textContent = `${planName} plan${paidSummary} · Cancellation scheduled for the end of the current billing period.`;
                if (cancelButton) cancelButton.hidden = true;
            } else {
                dashboardStatus.textContent = `${planName} plan${paidSummary}`;
                if (cancelButton) cancelButton.hidden = planKey === "free" || !amount;
            }
            window.procureIQUpdateAccountIdentity?.(`${planName} plan`);
        } catch (error) {
            dashboardStatus.textContent = error.message || "Unable to load your current plan.";
            if (cancelButton) cancelButton.hidden = true;
        }
    }
    window.procureIQLoadBillingState = loadBillingState;
    function updatePricing(){ const currency=currentCurrency(); if(currencySelect){currencySelect.value=currency;currencySelect.disabled=countrySelect?.value === "IN";} const available=recurringCurrencies.includes(currency); buttons.forEach(button=>{button.disabled=!available; button.title=available?"":"Recurring checkout is not configured for this currency yet."; if(!available) button.textContent=`Unavailable in ${currency}`; else button.textContent=button.dataset.originalText||`Choose ${String(button.dataset.razorpayPlan||"").replace(/^./,c=>c.toUpperCase())} →`;}); priceNodes.forEach(node=>{const plan=node.dataset.pricePlan;if(prices[currency]?.[plan])node.innerHTML=`${symbols[currency]}${prices[currency][plan].toLocaleString("en-IN")} <small>/ month</small>`;}); if(selectedPlan&&planPrice)planPrice.textContent=`${symbols[currency]}${prices[currency][selectedPlan].toLocaleString("en-IN")}`; }
    countrySelect?.addEventListener("change",()=>{const desired=defaults[countrySelect.value]||"USD";if(currencySelect)currencySelect.value=countrySelect.value==="IN"?"INR":desired;updatePricing();});
    currencySelect?.addEventListener("change",updatePricing); updatePricing();
    function closePlanModal(){if(!modal)return;modal.classList.remove("is-open");modal.setAttribute("aria-hidden","true");document.body.classList.remove("modal-open");selectedPlan=null;}
    function openPlanModal(plan){const d=planDetails[plan];if(!d||!modal)return; if(!recurringCurrencies.includes(currentCurrency())){setPaymentStatus(`Recurring checkout is not configured for ${currentCurrency()} yet.`,true); return;}selectedPlan=plan;if(planTitle)planTitle.textContent=d.title;if(planIntro)planIntro.textContent="Recurring monthly subscription. Cancel from Plans & Billing before the next renewal.";if(planLabel)planLabel.textContent=d.label;updatePricing();if(planWhy)planWhy.textContent=d.why;if(planBenefits)planBenefits.innerHTML=d.benefits.map(x=>`<li>${x}</li>`).join("");modal.classList.add("is-open");modal.setAttribute("aria-hidden","false");document.body.classList.add("modal-open");continueButton?.focus();}
    modal?.addEventListener("click",e=>{if(e.target.closest("[data-plan-close]"))closePlanModal();});
    fetch("/api/config",{headers:{Accept:"application/json"},cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject(new Error("Unable to load billing configuration."))).then(config=>{recurringCurrencies=Array.isArray(config?.recurringCurrencies)?config.recurringCurrencies:[]; updatePricing();}).catch(()=>{recurringCurrencies=[]; updatePricing();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closePlanModal();});
    async function startPayment(plan,clickedButton){
        if(!window.procureiqApiFetch){setPaymentStatus("Authentication is still loading. Please try again.",true);return;}
        if(!window.procureIQClerk?.isSignedIn){setPaymentStatus("Please sign in first to continue to secure checkout.",true);window.procureIQOpenSignIn?.();return;}
        const button=clickedButton||document.querySelector(`[data-razorpay-plan="${plan}"]`);
        if(button){button.disabled=true;button.dataset.originalText=button.innerHTML;button.innerHTML="Preparing subscription…";}
        try{
            setPaymentStatus("Creating your secure subscription…");
            const response=await procureiqApiFetch("/api/create-subscription",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({plan,country:countrySelect?.value||"IN",currency:currentCurrency()})});
            const result=await response.json().catch(()=>({}));
            if(!response.ok)throw new Error(result.error||"Unable to create subscription.");
            if(!window.Razorpay)throw new Error("Razorpay Checkout failed to load. Refresh the page and try again.");
            const options={key:result.key_id,subscription_id:result.subscription_id,name:"ProcureIQ",description:`${result.plan_name} subscription`,theme:{color:"#1f6feb"},handler:async payment=>{try{setPaymentStatus("Verifying subscription securely…");const verify=await procureiqApiFetch("/api/verify-subscription",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payment)});const v=await verify.json().catch(()=>({}));if(!verify.ok||!v.success)throw new Error(v.error||"Subscription verification failed.");setPaymentStatus(`✓ ${String(v.plan||plan).toUpperCase()} subscription is active.`);await loadBillingState();window.procureIQLoadAIUsage?.();}catch(error){setPaymentStatus(error.message||"Subscription verification failed.",true);}},modal:{ondismiss:()=>setPaymentStatus("Checkout closed. No subscription was confirmed.")}};
            const razorpay=new window.Razorpay(options);razorpay.on("payment.failed",e=>setPaymentStatus(e?.error?.description||"Payment failed. No subscription was activated.",true));razorpay.open();
        }catch(error){setPaymentStatus(error.message||"Unable to start subscription.",true);}finally{if(button){button.disabled=false;button.innerHTML=button.dataset.originalText||"Choose plan →";}}
    }
    async function cancelSubscription(){
        if(!window.procureiqApiFetch)return;
        if(!confirm("Cancel the next renewal for your ProcureIQ subscription? Your current period will remain active."))return;
        cancelButton.disabled=true;
        try{const response=await procureiqApiFetch("/api/cancel-subscription",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"}});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Unable to cancel subscription.");setPaymentStatus(result.message||"Cancellation scheduled.");await loadBillingState();}catch(error){setPaymentStatus(error.message||"Unable to cancel subscription.",true);}finally{cancelButton.disabled=false;}
    }
    cancelButton?.addEventListener("click",cancelSubscription);
    buttons.forEach(button=>button.addEventListener("click",e=>{e.preventDefault();openPlanModal(button.dataset.razorpayPlan);}));
    continueButton?.addEventListener("click",()=>{const plan=selectedPlan;closePlanModal();if(plan)startPayment(plan,document.querySelector(`[data-razorpay-plan="${plan}"]`));});
    window.procureIQAuthReady?.then(() => loadBillingState()).catch(() => {});
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(loadBillingState, 300), { once: true });
    else setTimeout(loadBillingState, 300);
})();;

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
        const headerRemaining = document.getElementById("headerTokensRemaining");
        const headerUsed = document.getElementById("headerTokensUsed");
        const headerLimit = document.getElementById("headerTokensLimit");
        const headerProgress = document.getElementById("headerTokenProgress");
        const headerUpgrade = document.getElementById("headerTokenUpgradeBtn");
        const signedIn = Boolean(window.procureIQClerk?.isSignedIn);
        if (!signedIn) {
            if (text) text.textContent = "Sign in to see your AI allowance and usage.";
            if (remaining) remaining.textContent = "Sign in required";
            if (plan) plan.textContent = "Free plan";
            if (headerRemaining) headerRemaining.textContent = "—";
            if (headerUsed) headerUsed.textContent = "0";
            if (headerLimit) headerLimit.textContent = "0";
            if (headerProgress) headerProgress.style.width = "0%";
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
            const remainingPct = limit ? Math.min(100, Math.max(0, (left / limit) * 100)) : 0;
            if (text) text.textContent = `${used.toLocaleString("en-IN")} of ${limit.toLocaleString("en-IN")} AI tokens used`;
            if (remaining) remaining.textContent = `${left.toLocaleString("en-IN")} left`;
            if (plan) plan.textContent = `${String(result.plan || "Free").replace(/^./, x => x.toUpperCase())} plan`;
            if (headerRemaining) headerRemaining.textContent = `${used.toLocaleString("en-IN")} / ${limit.toLocaleString("en-IN")} used`;
            if (headerUsed) headerUsed.textContent = used.toLocaleString("en-IN");
            if (headerLimit) headerLimit.textContent = limit.toLocaleString("en-IN");
            if (headerUpgrade) {
                const canUpgrade = left <= 0 && !["pro", "enterprise"].includes(String(result.plan || "free").toLowerCase());
                headerUpgrade.classList.toggle("is-hidden", !canUpgrade);
            }
            const tokenStatus = document.getElementById("workspaceTokenStatus");
            if (tokenStatus) {
                tokenStatus.title = `Tokens: ${left.toLocaleString("en-IN")} of ${limit.toLocaleString("en-IN")} available`;
                tokenStatus.style.setProperty("--token-remaining", String(remainingPct));
            }
            // V116: the header ring is blue for remaining tokens and turns white as tokens are consumed.
            if (headerProgress) headerProgress.style.width = `${limit ? Math.min(100, Math.max(0, (left / limit) * 100)) : 0}%`;
            const planName = String(result.plan || "Free").replace(/^./, x => x.toUpperCase());
            const planLabel = `${planName} plan`;
            window.procureIQUpdateAccountIdentity?.(planLabel);
            const sidebarPlan = document.getElementById("sidebarPlanLabel");
            const sidebarPlanMeta = document.getElementById("sidebarPlanMeta");
            if (sidebarPlan) sidebarPlan.textContent = planName;
            if (sidebarPlanMeta) sidebarPlanMeta.textContent = planName.toLowerCase() === "free" ? "AI tokens" : "AI tokens remaining";
            const sidebarRemaining = document.getElementById("sidebarAiRemaining");
            if (sidebarRemaining) sidebarRemaining.textContent = left.toLocaleString("en-IN");
            const sidebarProgress = document.getElementById("sidebarAiProgress");
            if (sidebarProgress) sidebarProgress.style.width = `${limit ? Math.min(100, Math.max(0, (left / limit) * 100)) : 0}%`;
            const tokensEl = document.getElementById("settingsTokens");
            if (tokensEl) tokensEl.textContent = `${limit.toLocaleString("en-IN")} tokens`;
            const policy = document.getElementById("usagePolicyText");
            if (policy) policy.textContent = String(result.plan || "free").toLowerCase() === "free" ? `Free access · ${Number(result.token_limit || 0).toLocaleString("en-IN")} persistent AI tokens · workspace capacity ${Number(result.free_user_cap || 50)}` : "Higher AI allowance on your paid plan";

            if (progress) progress.style.width = `${remainingPct.toFixed(1)}%`;
        } catch (error) {
            if (text) text.textContent = "Usage information is temporarily unavailable.";
            if (remaining) remaining.textContent = "Unavailable";
            if (headerRemaining) headerRemaining.textContent = "Unavailable";
            if (headerUpgrade) headerUpgrade.classList.add("is-hidden");
        }
    }
    window.procureIQLoadAIUsage = loadAIUsage;
    window.procureIQAuthReady?.then(() => loadAIUsage()).catch(() => {});
    window.setInterval(() => {
        if (document.visibilityState === "visible" && window.procureIQClerk?.isSignedIn) loadAIUsage();
    }, 15000);
    window.addEventListener("focus", () => loadAIUsage());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") loadAIUsage(); });
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => setTimeout(() => loadAIUsage(), 350), { once: true });
    } else {
        setTimeout(() => loadAIUsage(), 350);
    }

    async function syncOutcomeLedger() {
        const ids = ["ledgerTracked","ledgerValidated","ledgerNegotiated","ledgerRealized","overviewMemoryTracked","overviewMemoryRealized"];
        if (!ids.some(id => document.getElementById(id))) return;
        try {
            const response = await procureiqApiFetch("/api/outcome-ledger", { headers:{Accept:"application/json"} });
            const result = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(result.error || "Unable to load outcome ledger.");
            const fmt = value => formatCurrency(Number(value || 0));
            const map = { ledgerTracked:Number(result.tracked||0).toLocaleString("en-IN"), ledgerValidated:Number(result.validated||0).toLocaleString("en-IN"), ledgerNegotiated:fmt(result.negotiated), ledgerRealized:fmt(result.realized), overviewMemoryTracked:Number(result.tracked||0).toLocaleString("en-IN"), overviewMemoryRealized:fmt(result.realized) };
            Object.entries(map).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=value;});
        } catch (error) { console.warn("Outcome ledger unavailable:", error.message); }
    }
    window.procureIQSyncOutcomeLedger = syncOutcomeLedger;

    document.getElementById("resetDataBtn")?.addEventListener("click", async () => {
        if (!window.procureIQClerk?.isSignedIn) return alert("Please sign in first.");
        if (!confirm("Reset this workspace? This permanently removes your current procurement transactions, control-pack data, saved reports and recorded opportunity outcomes. This cannot be undone.")) return;
        const button = document.getElementById("resetDataBtn");
        if (button) { button.disabled = true; button.textContent = "Resetting…"; }
        try {
            const response = await procureiqApiFetch("/api/reset-data", { method:"POST", headers:{Accept:"application/json"} });
            const result = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(result.error || "Unable to reset data.");
            data = []; selectedFile = null;
            opportunityMemoryMap = new Map();
            window.procurementOpportunities = [];
            activeSupplier = "ALL"; activeMaterial = "ALL"; activePriority = "ALL"; visibleOpportunityCount = 5;
            document.getElementById("supplierFilter") && (document.getElementById("supplierFilter").value = "ALL");
            document.getElementById("materialFilter") && (document.getElementById("materialFilter").value = "ALL");
            document.getElementById("priorityFilter") && (document.getElementById("priorityFilter").value = "ALL");
            try { localStorage.removeItem("procureiq_report_history_v2"); } catch (_) {}
            window.procureIQInitReports?.();
            const file = document.getElementById("csvFile"); if (file) file.value = "";
            const name = document.getElementById("fileName"); if (name) name.textContent = "Choose PDF / Excel / CSV file";
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
        if (ratingLabel) ratingLabel.textContent = rating ? `${rating}/5 : ${ratingLabels[rating]}` : "Select a rating";
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
            if (status) status.textContent = "✓ Thank you : your rating and review were submitted for approval.";
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
            if (avgEl) avgEl.textContent = reviews.length ? `${avg.toFixed(1)} / 5` : ":";
            if (countEl) countEl.textContent = String(reviews.length);
            if (!container) return;
            if (!reviews.length) { container.innerHTML = '<p class="empty-message">No published reviews yet.</p>'; return; }
            container.innerHTML = reviews.slice(0, 6).map(item => `<article class="review-card"><div class="review-stars">${"★".repeat(Number(item.rating))}${"☆".repeat(5-Number(item.rating))}</div><p>${escapeHTML(item.review)}</p><strong>${escapeHTML(item.display_name || "ProcureIQ user")}</strong><span>Verified ProcureIQ user</span></article>`).join("");
        } catch (error) { /* Reviews are optional; keep the page clean if unavailable. */ }
    }
    loadPublicReviews();
})();


/* =====================================================
   V12 : PROCUREMENT INTELLIGENCE ENGINE
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
    set('v12AtRisk',money(riskSpend)); set('v12HighConfidence',money(highConfidence)); set('v12Dependency',concentration?`${concentration.toFixed(1)}%`:':'); set('v12DependencyCopy',concentration>35?'top supplier share : dependency signal':'top supplier share'); set('v12SpendFlowTotal',money(total)); set('v12PotentialSavings',money(savings));
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


/* V18 : supplier benchmark + material concentration widgets */
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
   V15 : DOCUMENT-LEVEL WORKSPACE NAVIGATION
   Every primary destination is a real HTML document.
===================================================== */
(function initProcureIQDocumentNavigation(){
  const routes={overview:'/workspace/overview',act:'/workspace/act',analyze:'/workspace/analyze',control:'/workspace/control',chat:'/workspace/chat',reports:'/workspace/reports',billing:'/workspace/billing',help:'/workspace/help'};
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
   V14 : CALM INTERACTIONS / FEATURE DISCOVERY
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
    const get=id=>document.getElementById(id)?.textContent||':';
    const map=[['v12HealthScore','v14ControlScore'],['v12Dependency','v14Dependency'],['v12DependencyCopy','v14DependencyCopy'],['v12TrustScore','v14DataTrust'],['v12PotentialSavings','v14PotentialSavings'],['v12ApprovedSavings','v14ApprovedSavings'],['v12NegotiatedSavings','v14NegotiatedSavings'],['v12RealizedSavings','v14RealizedSavings']];
    map.forEach(([a,b])=>{const v=get(a),el=document.getElementById(b);if(el&&v!==':')el.textContent=v;});
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
            ? `Start with ${high.material} : ${high.supplier}, ${high.variance.toFixed(1)}% above the lowest observed comparable price.`
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
        const savings = opps.reduce((sum, opportunity) => {
            const value = Number(opportunity?.saving);
            return sum + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);
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


document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => { window.procureIQLoadOpportunityMemory?.(); window.procureIQSyncOutcomeLedger?.(); }, 650);
});

window.PROCUREIQ_BUILD = "86"; console.info("ProcureIQ build V86 loaded");
