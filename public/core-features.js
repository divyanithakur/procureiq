
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
      material:(clean.match(/(?:material\s*\/?\s*sku|material|sku|item|product)\s*(?::|#|-)?\s*([^|;\n]{2,80}?)(?=\s+(?:contracted unit price|unit price|unit cost|price per unit|rate|rebate|discount|threshold|effective date|supplier)\b|$)/i)||[])[1]?.trim() || null,
      supplier:(clean.match(/supplier\s*(?::|#|-)?\s*([^|;\n]{2,100}?)(?=\s+(?:material|sku|contracted unit price|unit price|unit cost|rebate|discount|threshold|effective date)\b|$)/i)||[])[1]?.trim() || null,
      price:firstNum(clean,[/(?:unit price|unit cost|price per unit|rate|unit\s*price)\D{0,50}(?:₹|Rs\.?|INR|\$)?\s*([\d,]+(?:\.\d+)?)/i]),
      threshold:firstNum(clean,[/(?:rebate|discount)[^.;]{0,100}?(?:threshold|tier|volume)\D{0,40}([\d,]+(?:\.\d+)?)/i,/([\d,]+(?:\.\d+)?)\s*(?:units|unit)\D{0,30}(?:rebate|discount)/i]),
      rebate:firstNum(clean,[/(?:rebate|discount)\D{0,50}(\d+(?:\.\d+)?)\s*%/i,/(\d+(?:\.\d+)?)\s*%\D{0,30}(?:rebate|discount)/i])
    };
  }
  function runRecovery() {
    const supplier=(document.getElementById("contractSupplier")?.value||"").trim();
    const material=(document.getElementById("contractMaterial")?.value||"").trim();
    const price=Number(document.getElementById("contractPrice")?.value);
    const threshold=Number(document.getElementById("rebateThreshold")?.value);
    const rebate=Number(document.getElementById("rebateRate")?.value);
    const rs=rows();
    if(!material || !Number.isFinite(price) || price<=0){ setStatus("contractStatus","Enter a material/SKU and a valid contracted unit price.","error"); return; }
    const materialKey=material.toLowerCase();
    const supplierKey=supplier.toLowerCase();
    const materialMatches=rs.filter(r=>String(r.material||"").trim().toLowerCase()===materialKey);
    const matches=supplierKey
      ? materialMatches.filter(r=>String(r.supplier||"").trim().toLowerCase()===supplierKey)
      : materialMatches;
    const volume=matches.reduce((s,r)=>s+(Number(r.quantity)||0),0);
    const leakage=matches.reduce((s,r)=>s+Math.max(0,(Number(r.price)||0)-price)*(Number(r.quantity)||0),0);
    const rebateValue=(threshold>0 && volume>=threshold && rebate>0) ? (volume*price)*(rebate/100) : 0;
    const box=document.getElementById("recoveryResult");
    if(document.getElementById("recoveryMatches")) document.getElementById("recoveryMatches").textContent=matches.length.toLocaleString("en-IN");
    if(document.getElementById("recoveryVolume")) document.getElementById("recoveryVolume").textContent=volume.toLocaleString("en-IN");
    if(document.getElementById("recoveryLeakage")) document.getElementById("recoveryLeakage").textContent=money(leakage);
    if(document.getElementById("recoveryRebate")) document.getElementById("recoveryRebate").textContent=money(rebateValue);
    const issues=[];
    if(!matches.length) {
      issues.push(supplier
        ? `No transaction rows match ${material} for supplier ${supplier} in the uploaded history.`
        : "No transaction rows match this material/SKU in the uploaded history.");
    }
    if(!supplier && materialMatches.length > matches.length) issues.push("Supplier was not specified, so the audit used all suppliers for this material. Add the contract supplier for a supplier-specific recovery calculation.");
    if(leakage>0) issues.push(`${money(leakage)} is a potential exposure based on the contracted price; validate like-for-like specification, freight and effective dates.`);
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
      const isPdf=String(f.name||"").toLowerCase().endsWith(".pdf");
      try{
        const text=await extractContractText(f), c=parseContractCandidates(text);
        if(c.supplier && !document.getElementById("contractSupplier")?.value) document.getElementById("contractSupplier").value=c.supplier;
        if(c.material && !document.getElementById("contractMaterial")?.value) document.getElementById("contractMaterial").value=c.material;
        if(c.price!=null) document.getElementById("contractPrice").value=c.price;
        if(c.threshold!=null) document.getElementById("rebateThreshold").value=c.threshold;
        if(c.rebate!=null) document.getElementById("rebateRate").value=c.rebate;
        const inferred= c.material || c.price!=null || c.threshold!=null || c.rebate!=null;
        setStatus("contractStatus",isPdf?"PDF uploaded successfully.":"File uploaded successfully.","success");
        setTimeout(()=>setStatus("contractStatus","",""),3500);
        if(!inferred) console.info("Contract file uploaded, but no reliable commercial terms were extracted.");
      }catch(e){
        setStatus("contractStatus",`${isPdf?"PDF not uploaded":"File not uploaded"} — ${e.message||"Unable to read the file."}`,"error");
        setTimeout(()=>setStatus("contractStatus","",""),5000);
      }
    });
    document.getElementById("runRecoveryBtn")?.addEventListener("click",runRecovery);
  }

  /* ---------- Pillar 02: 3-way match ---------- */
  async function saveControlAction(invoiceNumber, action, status="RESOLVED", note="") {
    const response=await window.procureiqApiFetch("/api/control-actions",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({invoiceNumber,action,status,note})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||"Unable to save the control action.");
    return result.action;
  }

  function runMatch(){
    const invoiceNumber=(document.getElementById("matchInvoiceNumber")?.value||"").trim();
    const poQ=Number(document.getElementById("matchPOQty")?.value);
    const grnQ=Number(document.getElementById("matchGRNQty")?.value);
    const invQ=Number(document.getElementById("matchInvQty")?.value);
    const poP=Number(document.getElementById("matchPOPrice")?.value);
    const invP=Number(document.getElementById("matchInvPrice")?.value);
    const tol=Number(document.getElementById("matchTolerance")?.value);
    if(!invoiceNumber || [poQ,grnQ,invQ,poP,invP,tol].some(n=>!Number.isFinite(n)||n<0) || tol>100){
      document.getElementById("matchResult").innerHTML='<div class="result-empty"><span class="section-kicker">INPUT ERROR</span><h2>Complete the match inputs.</h2><p>Invoice reference, quantity, price and tolerance are required to create an auditable decision.</p></div>';return;
    }
    const qtyAgainstReceipt=grnQ>0 ? ((invQ-grnQ)/grnQ)*100 : (invQ===0?0:100);
    const priceVar=poP>0 ? ((invP-poP)/poP)*100 : (invP===0?0:100);
    const qtyException=Math.abs(qtyAgainstReceipt)>tol;
    const priceException=Math.abs(priceVar)>tol;
    const invoiceValue=invQ*invP;
    const receivedValue=grnQ*poP;
    const exposure=Math.max(0,invoiceValue-receivedValue);
    const exception=qtyException||priceException;
    const action=exception ? "HOLD & ROUTE TO SUPPLIER REVIEW" : "WITHIN TOLERANCE · REVIEW-READY";
    const badge=exception?"EXCEPTION":"MATCH";
    const result=document.getElementById("matchResult");
    result.innerHTML=`<div class="result-header"><div><span class="section-kicker">MATCH DECISION · ${esc(invoiceNumber)}</span><h2>${action}</h2><p>Decision calculated from the PO, GRN and invoice values entered above.</p></div><span class="result-badge">${badge}</span></div>
    <div class="match-table"><div class="match-row head"><span>Check</span><span>Variance / exposure</span><span>Status</span></div>
    <div class="match-row"><span>Invoice quantity vs GRN</span><strong>${qtyAgainstReceipt.toFixed(2)}%</strong><span class="${qtyException?"status-bad":"status-ok"}">${qtyException?"Outside tolerance":"Within tolerance"}</span></div>
    <div class="match-row"><span>Invoice unit price vs PO</span><strong>${priceVar.toFixed(2)}%</strong><span class="${priceException?"status-bad":"status-ok"}">${priceException?"Outside tolerance":"Within tolerance"}</span></div>
    <div class="match-row"><span>Invoice value vs received @ PO price</span><strong>${money(exposure)}</strong><span>${exposure>0?"Potential exposure":"No positive exposure"}</span></div></div>
    <div class="claim-preview control-action-panel"><div><strong>Recommended next action</strong><p>${exception?"Hold this invoice and route the exact discrepancy for supplier review.":"Approve the match for review-ready processing and retain the evidence."}</p></div><div class="control-action-buttons">${exception?`<button class="secondary-btn" data-control-action="HOLD_FOR_REVIEW" type="button">Hold for review</button><button class="secondary-btn" data-control-action="REQUEST_CREDIT" type="button">Request credit</button>`:`<button class="secondary-btn" data-control-action="APPROVE_MATCH" type="button">Record approval</button>`}</div><span class="inline-status" id="controlActionStatus" role="status" aria-live="polite"></span></div>`;
    result.querySelectorAll("[data-control-action]").forEach(button=>button.addEventListener("click",async()=>{
      const actionName=button.dataset.controlAction;
      const actionStatus=actionName==="APPROVE_MATCH"||actionName==="ACCEPT_EXCEPTION"?"RESOLVED":"IN_REVIEW";
      const statusEl=document.getElementById("controlActionStatus");
      result.querySelectorAll("[data-control-action]").forEach(b=>b.disabled=true);
      if(statusEl) statusEl.textContent="Saving decision…";
      try { await saveControlAction(invoiceNumber,actionName,actionStatus,`3-way match: qty variance ${qtyAgainstReceipt.toFixed(2)}%, price variance ${priceVar.toFixed(2)}%, exposure ${money(exposure)}.`); if(statusEl){statusEl.textContent="Decision saved to the control audit trail.";statusEl.className="inline-status success";} }
      catch(e){ if(statusEl){statusEl.textContent=e.message||"Unable to save decision.";statusEl.className="inline-status error";} result.querySelectorAll("[data-control-action]").forEach(b=>b.disabled=false); }
    }));
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
  function setRiskStatus(message,type="",duration=0){
    const status=document.getElementById("riskAuditStatus");
    if(!status)return;
    if(status._timer) clearTimeout(status._timer);
    status.textContent=message;
    status.className=`inline-status ${type}`.trim();
    if(duration>0){
      status._timer=setTimeout(()=>{
        status.textContent="";
        status.className="inline-status";
        status._timer=null;
      },duration);
    }
  }
  async function refreshRiskAudit(){
    const button=document.getElementById("runRiskAuditBtn");
    if(button?.disabled) return;
    try{ sessionStorage.setItem("procureiq_refresh_audit_pending","1"); }catch(_){}
    if(button){
      button.disabled=true;
      button.setAttribute("aria-busy","true");
      button.textContent="Refreshing…";
    }
    setRiskStatus("Refreshing…");
    window.location.reload();
  }
  function showRefreshResultAfterReload(){
    let pending=false;
    try{
      pending=sessionStorage.getItem("procureiq_refresh_audit_pending")==="1";
      if(pending) sessionStorage.removeItem("procureiq_refresh_audit_pending");
    }catch(_){}
    if(!pending)return;
    const button=document.getElementById("runRiskAuditBtn");
    const finish=(message,type,duration)=>{
      setRiskStatus(message,type,duration);
      if(button){button.disabled=false;button.removeAttribute("aria-busy");button.textContent="Refresh audit";}
    };
    let settled=false;
    const onUpdated=()=>{if(settled)return;settled=true;cleanup();finish("Audit refreshed successfully","success",3200);};
    const onFailed=e=>{if(settled)return;settled=true;cleanup();finish(`Audit refresh failed — ${e?.detail?.message||"saved procurement data could not be loaded"}.`,"error",5000);};
    const cleanup=()=>{window.removeEventListener("procureiq:data-updated",onUpdated);window.removeEventListener("procureiq:data-load-failed",onFailed);};
    window.addEventListener("procureiq:data-updated",onUpdated);
    window.addEventListener("procureiq:data-load-failed",onFailed);
    setTimeout(()=>{if(settled)return;settled=true;cleanup();finish("Audit refreshed successfully","success",3200);},2500);
  }
  function initRisk(){
    const button=document.getElementById("runRiskAuditBtn");
    if(button) button.addEventListener("click",refreshRiskAudit);
    window.procureIQRefreshSupplierRiskAudit=refreshRiskAudit;
    async function renderSupplierScorecards(){
      const box=document.getElementById("supplierScorecards"); if(!box)return;
      try{
        const r=await window.procureiqApiFetch("/api/control-audit"); const a=await r.json().catch(()=>({}));
        const list=Array.isArray(a.supplier_scorecards)?a.supplier_scorecards:[];
        if(!list.length){box.innerHTML='<div class="result-empty"><p>Load the control pack or upload procurement data to generate supplier scorecards.</p></div>';return;}
        box.innerHTML=list.slice(0,8).map((x,i)=>`<div class="supplier-scorecard"><div class="supplier-scorecard-main"><span class="supplier-rank">${String(i+1).padStart(2,"0")}</span><div><strong>${esc(x.supplier)}</strong><small>${Number(x.invoices||0)} invoice${Number(x.invoices||0)===1?"":"s"} · ${Number(x.share_pct||0).toFixed(1)}% of observed spend</small></div></div><div class="supplier-score-metrics"><span><b>${money(x.spend)}</b><small>spend</small></span><span><b>${Number(x.exception_rate_pct||0).toFixed(1)}%</b><small>exception rate</small></span><span><b>${Number(x.avg_price_variance_pct||0).toFixed(1)}%</b><small>avg price variance</small></span></div></div>`).join('');
      }catch(_){ }
    }
    window.addEventListener("procureiq:data-updated",runRisk);
    window.addEventListener("procureiq:data-updated",renderSupplierScorecards);
    showRefreshResultAfterReload();
    setTimeout(runRisk,700); setTimeout(renderSupplierScorecards,900);
  }

  onReady(()=>{initRecovery();initMatch();initBuying();initRisk();});

  /* ---------- Procurement control pack ---------- */
  function initControlPack(){
    const importBtn=document.getElementById("importControlPackBtn");
    const fileInput=document.getElementById("controlPackFile");
    if(!importBtn)return;
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=String(v??0)};
    const money2=v=>money(Number(v)||0);
    const renderAudit=(a)=>{
      const c=a.counts||{}, t=a.totals||{}, sc=a.supplier_concentration;
      set("controlPackContracts",c.contracts||0); set("controlPackPOs",c.purchase_orders||0); set("controlPackGRNs",c.goods_receipts||0); set("controlPackInvoices",c.invoices||0);
      set("controlPackExceptions",c.exceptions||0); set("controlPackExposure",money2(t.positive_exposure)); set("controlPackLeakage",money2(t.contract_leakage)); set("controlPackRebate",money2(t.rebate_candidate));
      document.getElementById("controlPackMetrics")?.classList.remove("is-hidden");
      const result=document.getElementById("controlPackResult");
      if(result){ result.innerHTML=`<div class="control-result-state"><span class="control-result-dot ${c.exceptions?"is-alert":"is-ok"}"></span><div><strong>${c.exceptions||0} exception${Number(c.exceptions||0)===1?"":"s"} found</strong><span>${c.matches||0} invoice match${Number(c.matches||0)===1?"":"es"} checked across the loaded evidence chain.</span></div></div>`; }
      const signal=document.getElementById("controlPackSignal");
      if(signal && sc){ signal.classList.remove("is-hidden"); signal.innerHTML=`<span>Supplier concentration</span><strong>${esc(sc.supplier)}</strong><b>${Number(sc.share_pct||0).toFixed(1)}%</b><small>of observed invoice spend</small>`; }
    };
    async function fetchAudit(){ const r=await window.procureiqApiFetch("/api/control-audit"); const a=await r.json().catch(()=>({})); if(!r.ok) throw new Error(a.error||"Unable to run control audit."); return a; }
    async function savePack(pack,sourceLabel){
      const payload={...pack,source_file_name:sourceLabel};
      const response=await window.procureiqApiFetch("/api/control-pack",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json().catch(()=>({})); if(!response.ok) throw new Error(result.error||"Unable to save control data.");
      const audit=await fetchAudit(); renderAudit(audit);
      const counts=result.saved?.counts||{};
      const invalid=result.saved?.invalid||{};
      const skipped=Object.values(invalid).reduce((sum,n)=>sum+(Number(n)||0),0);
      const loaded=`${Number(counts.contracts||0)} contracts · ${Number(counts.purchase_orders||0)} POs · ${Number(counts.goods_receipts||0)} GRNs · ${Number(counts.invoices||0)} invoices`;
      setStatus("controlPackStatus",`${sourceLabel} loaded and audited · ${loaded}${skipped?` · ${skipped} invalid row${skipped===1?"":"s"} skipped`:""}.`,"success");
    }
    async function importFile(file){
      if(!file)return;
      try{
        const ext=String(file.name||"").toLowerCase().split(".").pop();
        let pack=null;
        if(ext==="json"){ pack=JSON.parse(await file.text()); }
        else if(["xlsx","xls","csv"].includes(ext)){
          if(typeof XLSX==="undefined") throw new Error("Excel/CSV reader is unavailable. Refresh the page and try again.");
          const buffer=await file.arrayBuffer();
          const wb=XLSX.read(buffer,{type:"array",cellDates:false});
          const findSheet=(names)=>{const target=names.map(x=>x.toLowerCase()); const key=wb.SheetNames.find(n=>target.includes(n.toLowerCase().replace(/[ _-]/g,""))); return key?wb.Sheets[key]:null;};
          const rowsOf=sheet=>sheet?XLSX.utils.sheet_to_json(sheet,{defval:"",raw:true}):[];
          const normalize=(row,map)=>{const o={}; for(const [k,v] of Object.entries(row)){const key=String(k).toLowerCase().replace(/[ _-]/g,""); const dest=map[key]; if(dest)o[dest]=v;} return o;};
          const maps={
            contracts:{contractref:"contract_ref",contract:"contract_ref",supplier:"supplier",material:"material",sku:"material",contractedunitprice:"contracted_unit_price",unitprice:"contracted_unit_price",rebatethreshold:"rebate_threshold",rebaterate:"rebate_rate",effectivedate:"effective_from"},
            purchase_orders:{ponumber:"po_number",po:"po_number",supplier:"supplier",material:"material",sku:"material",quantity:"quantity",unitprice:"unit_price",orderdate:"order_date"},
            goods_receipts:{grnnumber:"grn_number",grn:"grn_number",ponumber:"po_number",po:"po_number",receivedquantity:"received_quantity",quantityreceived:"received_quantity",receiveddate:"received_date"},
            invoices:{invoicenumber:"invoice_number",invoice:"invoice_number",ponumber:"po_number",po:"po_number",supplier:"supplier",material:"material",sku:"material",quantity:"quantity",unitprice:"unit_price",invoicedate:"invoice_date"}
          };
          if(ext==="csv"){
            const rows=rowsOf(wb.Sheets[wb.SheetNames[0]]);
            const typed=rows.map(r=>normalize(r,{recordtype:"record_type",type:"record_type",supplier:"supplier",material:"material",sku:"material",contractref:"contract_ref",contractedunitprice:"contracted_unit_price",unitprice:"unit_price",rebatethreshold:"rebate_threshold",rebaterate:"rebate_rate",ponumber:"po_number",po:"po_number",quantity:"quantity",receivedquantity:"received_quantity",grnnumber:"grn_number",invoicenumber:"invoice_number"}));
            const type=r=>String(r.record_type||"").toLowerCase();
            pack={contracts:typed.filter(r=>type(r)==="contract"),purchase_orders:typed.filter(r=>["po","purchase_order","purchaseorder"].includes(type(r))),goods_receipts:typed.filter(r=>["grn","goods_receipt","goodsreceipt"].includes(type(r))),invoices:typed.filter(r=>type(r)==="invoice")};
          } else {
            const get=(names,map)=>rowsOf(findSheet(names)).map(r=>normalize(r,map));
            pack={contracts:get(["contracts","contract"],maps.contracts),purchase_orders:get(["purchaseorders","purchase_orders","pos","po"],maps.purchase_orders),goods_receipts:get(["goodsreceipts","goods_receipts","grn","grns"],maps.goods_receipts),invoices:get(["invoices","invoice"],maps.invoices)};
          }
        } else throw new Error("Unsupported control-data format. Use JSON, XLSX, XLS or CSV.");
        if(!pack || (!pack.contracts?.length && !pack.purchase_orders?.length && !pack.goods_receipts?.length && !pack.invoices?.length)) throw new Error("No supported control records were found. Use the workbook sheet names shown below the card.");
        await savePack(pack,file.name);
      }catch(e){setStatus("controlPackStatus",`Import failed — ${e.message||"invalid control data"}`,"error");}
      finally{if(fileInput)fileInput.value="";}
    }
    importBtn.addEventListener("click",()=>fileInput?.click()); fileInput?.addEventListener("change",()=>importFile(fileInput.files?.[0]));
    async function refresh(){try{const a=await fetchAudit(); const c=a.counts||{}; if(Number(c.contracts||0)+Number(c.purchase_orders||0)+Number(c.goods_receipts||0)+Number(c.invoices||0)) renderAudit(a);}catch(_){} }
    refresh();
  }

  onReady(initControlPack);

})();
