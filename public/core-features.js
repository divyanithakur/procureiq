
/* ============================================================
   PROCUREIQ CORE PRODUCT SURFACES : v25
   Deterministic outputs. No fabricated market/vendor/risk data.
============================================================ */
(function () {
  const esc = window.escapeHTML || (v => String(v ?? ""));
  const money = v => {
    const n = Number(v) || 0;
    return `₹${n.toLocaleString("en-IN", {maximumFractionDigits: 2})}`;
  };
  const rows = () => (typeof data !== "undefined" && Array.isArray(data)) ? data : [];
  const onReady = fn => document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", fn, {once:true})
    : fn();

  function setStatus(id, text, type="") {
    const el=document.getElementById(id); if(!el) return;
    el.textContent=text; el.className=`inline-status ${type}`.trim();
  }

  /* ---------- Pillar 01: Contract recovery ---------- */
  async function extractContractText(file) {
    if (!file) throw new Error("Choose a commercial-terms file first.");
    const ext=String(file.name||"").toLowerCase().split(".").pop();
    if(ext === "pdf"){
      if (!window.pdfjsLib) throw new Error("PDF extraction is unavailable. Refresh the page and try again.");
      const pdf=await window.pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
      let out=[];
      for(let p=1;p<=pdf.numPages;p++){
        const page=await pdf.getPage(p), content=await page.getTextContent();
        out.push(content.items.map(i=>String(i.str||"").trim()).filter(Boolean).join(" "));
      }
      return out.join("\n");
    }
    if(["xlsx","xls","csv"].includes(ext)){
      if(typeof XLSX === "undefined") throw new Error("Excel/CSV reader failed to load. Refresh the page and try again.");
      const workbook=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
      const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
      if(!firstSheet) throw new Error("No readable sheet was found in the commercial-terms file.");
      const rows=XLSX.utils.sheet_to_json(firstSheet,{defval:"",raw:false});
      if(!rows.length) throw new Error("The commercial-terms file is empty.");
      return rows.map(row=>Object.entries(row).map(([k,v])=>`${k}: ${v}`).join(" | ")).join("\n");
    }
    throw new Error("Unsupported format. Upload PDF, XLSX, XLS or CSV.");
  }
  function firstNum(text, patterns) {
    for(const re of patterns){ const m=text.match(re); if(m) return Number(String(m[1]).replace(/,/g,"")); }
    return null;
  }
  function parseContractCandidates(text) {
    const clean=String(text||"").replace(/\s+/g," ");
    return {
      material:(clean.match(/(?:material|sku|item|product)\s*[:#-]\s*([^|;,\n]{2,80})/i)||[])[1]?.trim() || null,
      price:firstNum(clean,[/(?:unit price|unit cost|price per unit|rate|unit\s*price)\D{0,50}(?:₹|Rs\.?|INR|\$)?\s*([\d,]+(?:\.\d+)?)/i]),
      threshold:firstNum(clean,[/(?:rebate|discount)[^.;]{0,100}?(?:threshold|tier|volume)\D{0,40}([\d,]+(?:\.\d+)?)/i,/([\d,]+(?:\.\d+)?)\s*(?:units|unit)\D{0,30}(?:rebate|discount)/i]),
      rebate:firstNum(clean,[/(?:rebate|discount)\D{0,50}(\d+(?:\.\d+)?)\s*%/i,/(\d+(?:\.\d+)?)\s*%\D{0,30}(?:rebate|discount)/i])
    };
  }
  function runRecovery() {
    const material=(document.getElementById("contractMaterial")?.value||"").trim();
    const price=Number(document.getElementById("contractPrice")?.value);
    const threshold=Number(document.getElementById("rebateThreshold")?.value);
    const rebate=Number(document.getElementById("rebateRate")?.value);
    const rs=rows();
    if(!material || !Number.isFinite(price) || price<=0){ setStatus("contractStatus","Enter a material/SKU and a valid contracted unit price.","error"); return; }
    const matches=rs.filter(r=>String(r.material||"").trim().toLowerCase()===material.toLowerCase());
    const volume=matches.reduce((s,r)=>s+(Number(r.quantity)||0),0);
    const leakage=matches.reduce((s,r)=>s+Math.max(0,(Number(r.price)||0)-price)*(Number(r.quantity)||0),0);
    const rebateValue=(threshold>0 && volume>=threshold && rebate>0) ? (volume*price)*(rebate/100) : 0;
    const box=document.getElementById("recoveryResult");
    if(document.getElementById("recoveryMatches")) document.getElementById("recoveryMatches").textContent=matches.length.toLocaleString("en-IN");
    if(document.getElementById("recoveryVolume")) document.getElementById("recoveryVolume").textContent=volume.toLocaleString("en-IN");
    if(document.getElementById("recoveryLeakage")) document.getElementById("recoveryLeakage").textContent=money(leakage);
    if(document.getElementById("recoveryRebate")) document.getElementById("recoveryRebate").textContent=money(rebateValue);
    const issues=[];
    if(!matches.length) issues.push("No transaction rows match this material/SKU in the uploaded history.");
    if(leakage>0) issues.push(`${money(leakage)} is a potential exposure based on the contracted price you entered; validate like-for-like specification, freight and effective dates.`);
    if(threshold>0 && volume<threshold) issues.push(`Rebate threshold is not reached: ${volume.toLocaleString("en-IN")} / ${threshold.toLocaleString("en-IN")} units.`);
    if(threshold>0 && volume>=threshold && rebate>0) issues.push(`Rebate threshold is reached. Candidate rebate value: ${money(rebateValue)}.`);
    if(!threshold || !rebate) issues.push("Rebate terms are incomplete, so no rebate claim value is asserted.");
    box.innerHTML=`<div class="result-header"><div><span class="section-kicker">DECISION-READY FINDING</span><h2>${leakage>0 || rebateValue>0 ? "Recovery candidate identified" : "No supported recovery claim yet"}</h2></div><span class="result-badge">${leakage>0 || rebateValue>0 ? "REVIEW" : "INSUFFICIENT EVIDENCE"}</span></div><div class="finding-list">${issues.map((x,i)=>`<div class="finding-row"><span>${String(i+1).padStart(2,"0")}</span><p>${esc(x)}</p></div>`).join("")}</div>${leakage>0||rebateValue>0?`<div class="claim-preview"><strong>Next step</strong><p>Validate the contract clause, invoice period and supplier calculation before sending a binding claim. ProcureIQ does not send claims automatically.</p><button class="secondary-btn" type="button" id="copyRecoveryBrief">Copy recovery brief</button></div>`:""}`;
    document.getElementById("copyRecoveryBrief")?.addEventListener("click",()=>{ const brief=`ProcureIQ recovery review\nMaterial: ${material}\nMatching transactions: ${matches.length}\nVolume: ${volume}\nPotential exposure: ${money(leakage)}\nPotential rebate: ${money(rebateValue)}\nAction: Validate contract and invoice evidence before supplier claim.`; navigator.clipboard?.writeText(brief).then(()=>setStatus("contractStatus","Recovery brief copied.","success")).catch(()=>setStatus("contractStatus","Copy unavailable in this browser.","error")); });
    setStatus("contractStatus",`Audit complete: ${matches.length} matching transaction(s).`,"success");
  }
  function initRecovery(){
    const file=document.getElementById("contractFile");
    file?.addEventListener("change", async()=>{
      const f=file.files?.[0]; if(!f)return;
      const name=document.getElementById("contractFileName"); if(name)name.textContent=f.name;
      try{
        const text=await extractContractText(f), c=parseContractCandidates(text);
        if(c.material && !document.getElementById("contractMaterial")?.value) document.getElementById("contractMaterial").value=c.material;
        if(c.price!=null) document.getElementById("contractPrice").value=c.price;
        if(c.threshold!=null) document.getElementById("rebateThreshold").value=c.threshold;
        if(c.rebate!=null) document.getElementById("rebateRate").value=c.rebate;
        const inferred= c.material || c.price!=null || c.threshold!=null || c.rebate!=null;
        setStatus("contractStatus",inferred?"Candidate terms extracted. Confirm them against the source file before running the audit.":"No reliable commercial terms were extracted. Enter them manually.","");
      }catch(e){setStatus("contractStatus",e.message,"error");}
    });
    document.getElementById("runRecoveryBtn")?.addEventListener("click",runRecovery);
  }

  /* ---------- Pillar 02: 3-way match ---------- */
  function runMatch(){
    const poQ=Number(document.getElementById("matchPOQty")?.value);
    const grnQ=Number(document.getElementById("matchGRNQty")?.value);
    const invQ=Number(document.getElementById("matchInvQty")?.value);
    const poP=Number(document.getElementById("matchPOPrice")?.value);
    const invP=Number(document.getElementById("matchInvPrice")?.value);
    const tol=Number(document.getElementById("matchTolerance")?.value);
    if([poQ,grnQ,invQ,poP,invP,tol].some(n=>!Number.isFinite(n)||n<0) || tol>100){
      document.getElementById("matchResult").innerHTML='<div class="result-empty"><span class="section-kicker">INPUT ERROR</span><h2>Enter valid non-negative values.</h2><p>Quantity, price and tolerance are required to calculate a decision.</p></div>';return;
    }
    const qtyAgainstReceipt=grnQ>0 ? ((invQ-grnQ)/grnQ)*100 : (invQ===0?0:100);
    const priceVar=poP>0 ? ((invP-poP)/poP)*100 : (invP===0?0:100);
    const qtyException=Math.abs(qtyAgainstReceipt)>tol;
    const priceException=Math.abs(priceVar)>tol;
    const invoiceValue=invQ*invP;
    const receivedValue=grnQ*poP;
    const exposure=Math.max(0,invoiceValue-receivedValue);
    const action=qtyException||priceException ? "HOLD & ROUTE TO SUPPLIER REVIEW" : "WITHIN TOLERANCE : REVIEW-READY";
    const badge=qtyException||priceException?"EXCEPTION":"MATCH";
    document.getElementById("matchResult").innerHTML=`<div class="result-header"><div><span class="section-kicker">MATCH DECISION</span><h2>${action}</h2><p>Calculated from the values entered above.</p></div><span class="result-badge">${badge}</span></div>
    <div class="match-table"><div class="match-row head"><span>Check</span><span>Variance</span><span>Status</span></div>
    <div class="match-row"><span>Invoice quantity vs GRN</span><strong>${qtyAgainstReceipt.toFixed(2)}%</strong><span class="${qtyException?"status-bad":"status-ok"}">${qtyException?"Outside tolerance":"Within tolerance"}</span></div>
    <div class="match-row"><span>Invoice unit price vs PO</span><strong>${priceVar.toFixed(2)}%</strong><span class="${priceException?"status-bad":"status-ok"}">${priceException?"Outside tolerance":"Within tolerance"}</span></div>
    <div class="match-row"><span>Invoice value vs received @ PO price</span><strong>${money(exposure)}</strong><span>${exposure>0?"Potential overstatement":"No positive exposure"}</span></div></div>
    <div class="claim-preview"><strong>Recommended next action</strong><p>${qtyException||priceException?"Create a supplier discrepancy request with the exact variance(s). Do not auto-approve this invoice.":"The entered values fall inside the configured tolerance. Keep the match evidence with the approval record."}</p><button class="secondary-btn" id="copyMatchBrief" type="button">Copy exception brief</button></div>`;
    const copyMatchButton=document.getElementById("copyMatchBrief");
    if(copyMatchButton){ copyMatchButton.onclick=async()=>{
      const b=`ProcureIQ 3-way match review\nQuantity variance: ${qtyAgainstReceipt.toFixed(2)}%\nPrice variance: ${priceVar.toFixed(2)}%\nPotential positive exposure: ${money(exposure)}\nDecision: ${action}`;
      try{
        if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(b);
        else { const ta=document.createElement("textarea"); ta.value=b; ta.style.position="fixed"; ta.style.left="-9999px"; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand("copy"); ta.remove(); }
        copyMatchButton.textContent="Copied ✓";
        setTimeout(()=>copyMatchButton.textContent="Copy exception brief",1600);
      }catch(e){
        copyMatchButton.textContent="Copy failed";
        setTimeout(()=>copyMatchButton.textContent="Copy exception brief",1800);
      }
    }; }
  }
  function initMatch(){document.getElementById("runMatchBtn")?.addEventListener("click",runMatch);}

  /* ---------- Pillar 03: Guided buying ---------- */
  function initBuying(){
    const renderSuppliers=()=>{
      const box=document.getElementById("knownBuySuppliers"); if(!box)return;
      const map=new Map();
      rows().forEach(r=>{const s=String(r.supplier||"").trim(); if(s)map.set(s,(map.get(s)||0)+1);});
      const arr=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
      box.innerHTML=arr.length?arr.map(([s,n])=>`<span class="supplier-chip">${esc(s)} <b>${n} records</b></span>`).join(""):'<span class="empty-message">Upload purchasing data on Overview first.</span>';
    };
    const generate=()=>{
      const item=(document.getElementById("buyItem")?.value||"").trim();
      const qty=Number(document.getElementById("buyQty")?.value);
      const budget=Number(document.getElementById("buyBudget")?.value);
      const date=document.getElementById("buyDate")?.value||"Not specified";
      const specs=(document.getElementById("buySpecs")?.value||"").trim();
      if(!item || !Number.isFinite(qty)||qty<=0 || !specs){
        setStatus("buyStatus","Enter the requirement, quantity and specifications so the RFQ is usable.","error");return;
      }
      const lower=item.toLowerCase();
      const supplierStats=new Map();
      rows().forEach(r=>{
        const s=String(r.supplier||"").trim(), m=String(r.material||"").trim();
        if(!s)return;
        const relevance=m && (lower.includes(m.toLowerCase())||m.toLowerCase().includes(lower));
        if(relevance){const a=supplierStats.get(s)||{count:0,prices:[]};a.count++;if(Number(r.price)>0)a.prices.push(Number(r.price));supplierStats.set(s,a);}
      });
      const suppliers=[...supplierStats.entries()].sort((a,b)=>b[1].count-a[1].count).slice(0,5);
      const supplierLine=suppliers.length
        ? `<div class="rfq-suppliers"><strong>Internal supplier evidence</strong>${suppliers.map(([s,v])=>`<div><span>${esc(s)}</span><small>${v.count} matching record(s)${v.prices.length?` · median historical unit price ${money(v.prices.sort((a,b)=>a-b)[Math.floor(v.prices.length/2)])}`:""}</small></div>`).join("")}</div>`
        : `<div class="evidence-note"><strong>No matching supplier evidence</strong><span>Do not invent a vendor shortlist. Send the RFQ to your approved supplier list after category review.</span></div>`;
      document.getElementById("rfqResult").innerHTML=`<div class="result-header"><div><span class="section-kicker">STRUCTURED RFQ</span><h2>Purchase request is ready for sourcing</h2><p>Draft generated only from your request and internal history.</p></div><span class="result-badge">DRAFT</span></div>
      <div class="rfq-preview"><div><span>Requirement</span><strong>${esc(item)}</strong></div><div><span>Quantity</span><strong>${qty.toLocaleString("en-IN")}</strong></div><div><span>Budget</span><strong>${Number.isFinite(budget)&&budget>0?money(budget):"Not specified"}</strong></div><div><span>Required by</span><strong>${esc(date)}</strong></div><div class="rfq-wide"><span>Specifications</span><p>${esc(specs)}</p></div></div>
      ${supplierLine}<div class="claim-preview"><strong>Vendor message</strong><p>Hello, please provide your best commercial quotation for the requirement above, including unit price, taxes, freight, lead time, payment terms, warranty and validity. Please confirm all specifications before quoting.</p><button class="secondary-btn" id="copyRFQBtn" type="button">Copy RFQ draft</button></div>`;
      document.getElementById("copyRFQBtn")?.addEventListener("click",async()=>{
        const b=`RFQ : ${item}\nQuantity: ${qty}\nBudget: ${Number.isFinite(budget)&&budget>0?money(budget):"Not specified"}\nRequired by: ${date}\nSpecifications: ${specs}\nPlease quote unit price, taxes, freight, lead time, payment terms, warranty and quote validity.`;
        try{
          if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(b);
          else { const ta=document.createElement("textarea"); ta.value=b; ta.style.position="fixed"; ta.style.left="-9999px"; document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand("copy"); ta.remove(); }
          setStatus("buyStatus","RFQ draft copied.","success");
        }catch(e){ setStatus("buyStatus","Copy was blocked by the browser.","error"); }
      });
      setStatus("buyStatus","Structured RFQ generated. Vendor pricing was not fabricated.","success");
    };
    document.getElementById("generateRFQBtn")?.addEventListener("click",generate);
    window.addEventListener("procureiq:data-updated",renderSuppliers); renderSuppliers();
  }

  /* ---------- Pillar 04: supplier risk ---------- */
  function runRisk(){
    const rs=rows(), box=document.getElementById("riskFindings");
    if(!box)return;
    if(!rs.length){box.innerHTML='<div class="result-empty"><h2>No internal evidence yet.</h2><p>Upload procurement data on Overview first. External financial/sanctions monitoring is not claimed without connected data.</p></div>';return;}
    const spendBySupplier=new Map(), mats=new Map();
    let maxDate=0;
    rs.forEach(r=>{
      const s=String(r.supplier||"Unknown").trim(), m=String(r.material||"Unknown").trim();
      const spend=(Number(r.quantity)||0)*(Number(r.price)||0);
      spendBySupplier.set(s,(spendBySupplier.get(s)||0)+spend);
      if(!mats.has(m))mats.set(m,new Set());mats.get(m).add(s);
      const d=new Date(r.transaction_date||r.date||0).getTime();if(Number.isFinite(d))maxDate=Math.max(maxDate,d);
    });
    const total=[...spendBySupplier.values()].reduce((a,b)=>a+b,0);
    const top=[...spendBySupplier.entries()].sort((a,b)=>b[1]-a[1])[0];
    const single=[...mats.values()].filter(s=>s.size===1).length;
    const share=total>0?(top[1]/total)*100:0;
    document.getElementById("riskSupplierCount").textContent=spendBySupplier.size;
    document.getElementById("riskTopShare").textContent=`${share.toFixed(1)}%`;
    document.getElementById("riskSingleSource").textContent=single;
    document.getElementById("riskDataFreshness").textContent=maxDate?new Date(maxDate).toLocaleDateString("en-IN"):"Not available";
    const findings=[];
    if(share>=50) findings.push(`High concentration: ${esc(top[0])} represents ${share.toFixed(1)}% of observed supplier spend.`);
    else if(share>=30) findings.push(`Concentration signal: ${esc(top[0])} represents ${share.toFixed(1)}% of observed supplier spend.`);
    else findings.push(`No high supplier concentration threshold was triggered. Largest observed supplier share is ${share.toFixed(1)}%.`);
    if(single) findings.push(`${single} material categor${single===1?"y":"ies"} has only one observed supplier in this dataset. This is an internal dependency signal, not proof of external supplier risk.`);
    else findings.push("No single-source material signal was detected from the uploaded rows.");
    findings.push("External bankruptcy, sanctions and geopolitical status are not assessed because no external risk feed is connected in this build.");
    box.innerHTML=findings.map((x,i)=>`<div class="finding-row"><span>${String(i+1).padStart(2,"0")}</span><p>${x}</p></div>`).join("");
  }
  function initRisk(){document.getElementById("runRiskAuditBtn")?.addEventListener("click",runRisk);window.addEventListener("procureiq:data-updated",runRisk);setTimeout(runRisk,700);}

  onReady(()=>{initRecovery();initMatch();initBuying();initRisk();});
})();
