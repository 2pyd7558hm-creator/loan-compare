window.analyze = function analyze(s) {
  const value = state.price;
  const down = value * s.downPct / 100;
  const base = Math.max(value - down, 0);
  const fha = s.type === "fha" ? fhaMip(base, value, s.term) : null;
  const financed = fha ? base * 0.0175 : s.type === "va" ? base * vaFeeFor(s.downPct) / 100 : 0;
  const loan = base + financed;
  const n = s.term * 12, r = s.rate / 1200;
  const pi = loan === 0 ? 0 : r ? loan * r / (1 - Math.pow(1 + r, -n)) : loan / n;
  const pointsCost = loan * s.points / 100;
  const cc = closingTotals(loan, s.rate);
  // Temporary buydown (1-0, 2-1, 3-2-1): the payment is figured 1 to 3 points under the note rate in the first years.
  // The difference is paid up front (often by the seller) into an account that makes up each month's shortfall.
  const bd = Math.min(Math.max(0, Math.round(+s.bd || 0)), 3), bdPay = [];
  for (let y = 0; y < bd; y++) { const rr = Math.max(0, s.rate - (bd - y)) / 1200; bdPay.push(loan === 0 ? 0 : rr ? loan * rr / (1 - Math.pow(1 + rr, -n)) : loan / n); }
  const bdCost = bdPay.reduce((a, x) => a + (pi - x) * 12, 0);
  // Second loan or down payment assistance: amount, rate, and term in years (0 = deferred, no monthly payment)
  const amt2 = Math.max(0, +s.amt2 || 0), r2 = (+s.rate2 || 0) / 1200, n2 = Math.max(0, +s.term2 || 0) * 12;
  const pi2 = amt2 && n2 ? (r2 ? amt2 * r2 / (1 - Math.pow(1 + r2, -n2)) : amt2 / n2) : 0;
  // Seller credit pays closing costs, prepaids and the buydown, never the down payment
  const costs = pointsCost + s.fees + cc.apr + cc.other + cc.prepaid + bdCost;
  const creditAsked = Math.max(0, +s.credit || 0), credit = Math.min(creditAsked, costs);
  const upfront = pointsCost + s.fees + cc.apr + cc.other + financed + bdCost - credit;
  const miMonths = fha ? Math.min(n, fha.years * 12) : n;
  // FHA monthly MIP the way HUD figures it: average scheduled balance for each loan year x annual rate,
  // divided by (1 + upfront MIP factor) since the upfront MIP is financed, then divided by 12
  const fhaYr = [];
  if (fha) { let bb = loan; for (let y = 0; y * 12 < miMonths; y++) { let sum = 0; for (let k = 0; k < 12; k++) { bb = Math.max(0, bb + bb * r - pi); sum += bb; } fhaYr.push(sum / 12 * fha.rate / 100 / 1.0175 / 12); } }

  const bal = [loan], cost = [upfront], equity = [value - loan - amt2], pay = [];
  let b = loan, cumInt = 0, cumMI = 0, firstMI = null, b2 = amt2, cum2 = 0;
  for (let m = 1; m <= MONTHS; m++) {
    let interest = 0, mi = 0, p = 0;
    if (m <= n && b > 0.005) {
      interest = b * r;
      if (s.type === "conv" && s.downPct < 20 && b / value > 0.78) mi = base * s.mi / 1200;
      if (fha && m <= miMonths) mi = fhaYr[Math.floor((m - 1) / 12)] || 0;
      p = Math.min(pi - interest, b);
      b -= p;
    }
    if (firstMI === null) firstMI = mi;
    // the buydown account pays part of each payment in the first years; that money was already counted up front
    const sub = m <= bd * 12 ? pi - bdPay[Math.floor((m - 1) / 12)] : 0;
    if (n2 && m <= n2 && b2 > 0.005) { const i2 = b2 * r2; cum2 += i2; b2 -= Math.min(pi2 - i2, b2); }
    cumInt += interest - sub; cumMI += mi;
    if (m <= n) pay.push(pi + mi);
    bal.push(b); cost.push(upfront + cumInt + cumMI + cum2);
    equity.push(value * Math.pow(1 + state.appreciation / 100, m / 12) - b - b2);
  }
  // APR: monthly rate i where PV(payments) = amount financed
  const amtFin = loan - financed - pointsCost - s.fees - cc.apr - cc.ppi;
  let apr = s.rate;
  if (amtFin > 0 && pay.length) {
    const pv = (i) => pay.reduce((acc, x, k) => acc + x / Math.pow(1 + i, k + 1), 0);
    let lo = 0, hi = 0.05;
    for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; pv(mid) > amtFin ? lo = mid : hi = mid; }
    apr = (lo + hi) / 2 * 1200;
  }
  const escrow = state.taxes / 12 + state.insurance / 12 + state.hoa;
  const total = pi + (firstMI || 0) + escrow + pi2;
  // A refinance has no down payment: the new loan pays off what's owed (state.payoff, when known), the costs are paid at
  // closing, and anything left over is cash back. With no payoff known the loan is taken to be what's owed.
  const refi = isRefiFile(), left = refi && state.payoff > 0 ? base - state.payoff : 0;
  const cashToClose = refi ? Math.max(0, costs - credit - left) : Math.max(0, down - amt2 + costs - credit);
  const cashBack = refi ? Math.max(0, left - costs + credit) : 0;
  return { s, down, loan, financed, pi, mi: firstMI || 0, escrow, total, pay1: bd ? total - pi + bdPay[0] : total, bd, bdPay, bdCost, amt2, pi2, credit, creditUnused: creditAsked - credit,
           pointsCost, cc, lenderFees: s.fees + cc.apr, cashToClose, cashBack, refi, apr, bal, cost, equity, n };
};
window.normFeeItems = function normFeeItems(items, st) {
  if (!items.some((it) => /prepaid interest/i.test(it.name))) items.push({ name: "Prepaid Interest", amt: 0, pct: 0, by: "B", apr: false, prepaid: true });
  const r = STAMP_RULE[(st || "").toUpperCase()];
  for (const it of items) if (r && r.split && /deed|transfer|stamp|documentary/i.test(it.name) && it.auto !== false && it.by !== "X") { it.by = "X"; it.split = r.split; it.splitBy = "%"; }
  return items;
};
window.feeAmount = function feeAmount(it, loan, rate) {
  const isStamp = /deed|transfer|stamp|documentary/i.test(it.name);
  const base = isStamp ? state.price : loan;
  let a = (+it.amt || 0) + base * (+it.pct || 0) / 100, est = false, note = "";
  if (it.auto !== false) {
    if (isStamp && STAMP_RULE[feeState()]) { const r = STAMP_RULE[feeState()]; a = isRefiFile() ? 0 : Math.max(r.min, state.price * r.pct / 100); note = r.note; }
    else if (it.prepaid && /prepaid interest/i.test(it.name)) { a = loan * (rate ?? (state.scenarios[0] ? +state.scenarios[0].rate : 0)) / 100 / 365 * PREPAID_DAYS; est = true; note = `${PREPAID_DAYS} days`; }
    else if (/credit report/i.test(it.name) && (state.creditReports || 1) > 1) { a = (+it.amt || 0) * state.creditReports; note = `${state.creditReports} separate reports`; }
    else if (it.prepaid && /hazard.*premium|insurance premium/i.test(it.name)) { a = state.insurance; est = true; note = "1 yr"; }
    else if (it.prepaid && /hazard.*reserve|insurance reserve/i.test(it.name)) { a = state.insurance / 12 * reserveMonths(); est = true; note = reserveMonths() + " mo"; }
    else if (it.prepaid && /tax.*reserve/i.test(it.name)) { a = state.taxes / 12 * reserveMonths(); est = true; note = reserveMonths() + " mo"; }
  }
  return { a, est, note };
};
window.closingTotals = function closingTotals(loan, rate) {
  const t = { apr: 0, other: 0, prepaid: 0, seller: 0, lender: 0, ppi: 0 };
  for (const it of (state.closing && state.closing.items) || []) {
    const { a } = feeAmount(it, loan, rate);
    const sh = feeShares(it, a);
    t.seller += sh.s; t.lender += sh.l;
    if (it.prepaid && /prepaid interest/i.test(it.name)) t.ppi += sh.b; // a finance charge, so it counts in the APR
    if (it.prepaid) t.prepaid += sh.b; else if (it.apr) t.apr += sh.b; else t.other += sh.b;
  }
  return t;
};
window.renderClosing = function renderClosing(a) {
  const items = state.closing.items, has = items.length > 0, open = !has || !!state.closing.open;
  $("feeEmpty").hidden = has; $("feeWrap").hidden = !has; $("feeBar").hidden = !has;
  const fst = feeState(), STATE_NAMES = { CO: "Colorado", NH: "New Hampshire" };
  $("feeStateNote").hidden = !has;
  $("feeStateNote").textContent = `Fees, taxes and recording costs are estimates based on ${STATE_NAMES[fst] || fst} and vary by state and county. Insurance reserves and tax reserves are ${reserveMonths()} months each${isRefiFile() ? " on a refinance" : " on a purchase"}.`;
  $("feeBody").hidden = !open;
  $("feeToggle").textContent = open ? "Hide fees" : `Show all ${items.length} fees`; $("feeToggle").setAttribute("aria-expanded", open);
  $("feeClear").hidden = !has; $("tplSaveOpen").hidden = !has;
  document.getElementById("closingSec").hidden = !has && document.body.classList.contains("readonly");
  if (!has) { feeRowsKey = ""; $("feeTable").innerHTML = ""; return; }
  const loan = a ? a.loan : state.price;
  // This loan's fees in dollars. The rules behind them (flat $, %, per $100, months of reserves, APR, prepaid) live in the fee template (Manage > Edit).
  // Staff can type over an amount for this loan only; Reset puts the template's figure back.
  const ro = document.body.classList.contains("readonly");
  const key = items.length + ":" + state.closing.template + ":" + ro;
  if (key !== feeRowsKey || !$("feeTable").rows.length || !$("feeTable").contains(document.activeElement)) {
    feeRowsKey = key;
    $("feeTable").innerHTML = `<thead><tr><th>Fee</th><th>Paid by</th><th class="num">Amount${state.scenarios.length > 1 ? " (option A)" : ""}</th><th class="staff-only"></th></tr></thead><tbody>` +
      items.map((it, i) => `<tr data-f="${i}">
        <td>${it.custom && !ro ? `<input type="text" data-k="name" value="${escAttr(it.name)}" aria-label="Fee name">` : `<span class="fee-nm">${escAttr(it.name)}</span>`}</td>
        <td>${ro ? (it.by === "X" ? "Split" : (BY.find(([v]) => v === it.by) || BY[0])[1]) : `<select data-k="by" aria-label="Paid by">${BY.map(([v, t]) => `<option value="${v}"${it.by === v ? " selected" : ""}>${t}</option>`).join("")}</select>${splitBox(it, "data-k")}`}</td>
        <td class="num">${ro ? `<span data-amt></span>` : `<div class="affix pre fee-amt"><span>$</span><input type="number" min="0" step="1" data-k="over" aria-label="Amount for this loan"></div>`}<div class="fee-why" data-why></div></td>
        <td class="staff-only"><button class="icon-btn fee-x" type="button" data-del="${i}" aria-label="Remove fee">×</button></td>
      </tr>`).join("") + `</tbody>`;
  }
  items.forEach((it, i) => {
    const { a: amt, est, note } = feeAmount(it, loan, a ? a.s.rate : undefined);
    const tr = $("feeTable").querySelector(`tr[data-f="${i}"]`); if (!tr) return;
    const inp = tr.querySelector("[data-k=over]"), out = tr.querySelector("[data-amt]");
    if (inp && document.activeElement !== inp) inp.value = Math.round(amt);
    if (out) out.textContent = usd.format(amt);
    const base = /deed|transfer|stamp|documentary/i.test(it.name) ? "price" : "loan";
    const why = it.custom ? "Added for this loan" : it.over ? `Changed for this loan${ro ? "" : ` · <button class="btn link" type="button" data-reset="${i}">Reset</button>`}`
      : [/days$/.test(note) ? `${note} of interest at the rate` : note === "1 yr" ? "1 year of insurance" : /mo$/.test(note) ? `${note.replace(" mo", "")} months of ${/tax/i.test(it.name) ? "taxes" : "insurance"}` : note ? note : +it.pct ? `${+it.amt ? usd.format(+it.amt) + " + " : ""}${+it.pct}% of the ${base}` : "",
         est ? "estimate" : "", it.apr ? "in APR" : "", it.prepaid ? "prepaid" : ""].filter(Boolean).join(" · ");
    const sh = feeShares(it, amt);
    const who = it.by === "X" ? `Borrower ${usd.format(sh.b)} · seller ${usd.format(sh.s)}` : it.by === "S" ? "seller pays" : it.by === "L" ? "lender pays" : "";
    tr.querySelector("[data-why]").innerHTML = [who, why].filter(Boolean).join(" · ");
  });
  const t = closingTotals(loan, a ? a.s.rate : undefined);
  $("feeSum").innerHTML = `<span>Lender fees (in APR) <b>${usd.format(t.apr)}</b></span><span>Third-party fees <b>${usd.format(t.other)}</b></span><span>Prepaids &amp; escrow <b>${usd.format(t.prepaid)}</b></span>` +
    (t.seller ? `<span>Paid by seller <b>${usd.format(t.seller)}</b></span>` : "") + (t.lender ? `<span>Paid by lender <b>${usd.format(t.lender)}</b></span>` : "") +
    (state.closing.template ? `<span style="color:var(--muted)">From template: ${escAttr(state.closing.template)}</span>` : "");
};
window.optionSpecs = function optionSpecs(text) {
  // Break the text into short phrases: sentences, commas (not inside $450,000), " - ", "vs", "then"
  const SPLIT = /(?<!\d)\.(?!\d)|[;\n]|,(?!\d{3})|\s[-–—]\s|\s+then\s+/i, VS = /\s+(?:vs\.?|versus|compared (?:to|with))\s+/i;
  // Which loan details a phrase names, so "20% down, 7.375%" reads as one option (a down payment and its rate)
  const feats = (c) => ({ rate: /\d\s*%(?!\s*down)|\b(?:at|rate)\s*\d/i.test(c), down: /%\s*(?:down|dn)|\b(?:no|zero|\d+(?:\.\d+)?)\s*(?:down|dn)\b/i.test(c),
    points: /\b(?:no|zero|\d+(?:\.\d+)?)\s*(?:points?|pts?)\b/i.test(c), type: /\b(?:conv|conventional|fha|va|jumbo)\b/i.test(c), term: /\b(?:10|15|20|25|30)\s*-?\s*(?:yr|year)s?\b(?!\s*arm)/i.test(c),
    product: /\bfixed\b|\barm\b|adjustable/i.test(c) });
  let specs = [];
  for (const group of text.split(VS)) {
    let cur = null;
    for (const raw of group.split(SPLIT).map((x) => (x || "").trim()).filter(Boolean)) {
      // "no points and 1.5 points" / "7.375% and 10% down": split lists when every part is a loan detail
      const sub = raw.split(/\s+(?:and|or|&)\s+|\s*\/\s*/i).map((x) => x.trim()).filter(Boolean);
      for (const c of sub.length > 1 && sub.every((x) => OPT_FEATURE.test(x)) ? sub : [raw]) {
        const f = feats(c);
        // A phrase that adds details the option before it doesn't have yet finishes that option ("30 yr fixed at 7%, with 1 point")
        if (cur && (OPT_FEATURE.test(c) || /^(?:with|at|plus)\b/i.test(c)) && !Object.keys(f).some((k) => f[k] && cur.f[k])) {
          cur.text += " " + c; Object.keys(f).forEach((k) => { cur.f[k] = cur.f[k] || f[k]; });
        } else if (OPT_FEATURE.test(c)) { cur = { text: c, f }; specs.push(cur); }
      }
    }
  }
  specs = specs.map((x) => x.text);
  // typed without commas ("John Smith 450k CO no points vs ..."): start the first option at its first loan word
  const m0 = specs[0] && specs[0].match(/\b(?:no|zero|conv|conventional|fha|va|buy ?down|\d+(?:\.\d+)?\s*(?:%|points?|pts?|-?\s*(?:yr|year)s?\b))/i);
  if (m0 && m0.index > 0) specs[0] = specs[0].slice(m0.index);
  // "a loan comparison with 2 scenarios": keep exactly that many
  const cm = text.match(OPT_COUNT), want = cm ? ({ two: 2, three: 3, four: 4 }[cm[1].toLowerCase()] || +cm[1]) : 4;
  return specs.slice(0, Math.min(4, want || 4));
};
window.parseOption = function parseOption(sp, base) {
  const low = sp.toLowerCase(), num = (re) => { const m = low.match(re); return m ? parseFloat(m[1]) : null; };
  const type = /\bfha\b/.test(low) ? "fha" : /\bva\b/.test(low) ? "va" : /\bjumbo\b/.test(low) ? "jumbo" : "conv";
  // "7/6 ARM", "7 yr ARM", "10-year ARM"; a bare "ARM" is read as 7/6
  const am = low.match(/\b(3|5|7|10)\s*(?:\/\s*\d+|-?\s*(?:yr|year)s?)?\s*(?:arm|adjustable)\b/), arm = am ? +am[1] : /\barm\b|adjustable/.test(low) ? 7 : 0;
  let points = /\b(no|zero|0)\s*(points?|pts?)\b/.test(low) ? 0 : num(/(\d+(?:\.\d+)?)\s*(?:points?|pts?)\b/);
  let down = /\b(no|zero)\s*(?:down|dn)\b/.test(low) ? 0 : num(/(\d+(?:\.\d+)?)\s*%?\s*(?:down|dn)\b/);
  const term = num(/\b(10|15|20|25|30)\s*-?\s*(?:yr|year|years)\b(?!\s*(?:arm|adjustable))/);
  let rate = num(/(?:\b(?:rate|at)\b|@)\s*(\d+(?:\.\d+)?)\s*%?/) ?? num(/(\d+(?:\.\d+)?)\s*%(?!\s*down)/);
  if (rate !== null && (rate < 1 || rate > 15)) rate = null;
  // a bare rate like "6.75" or "6.125" (not a down payment, points, or an amount like 1.2M)
  if (rate === null) { const m = low.match(/(?:^|\s)((?:[2-9]|1[0-2])\.\d{1,3})(?![\d.]|\s*%?\s*(?:down|dn|k|m|mil|points?|pts?|yrs?|years?)\b)/); if (m) rate = parseFloat(m[1]); }
  const guessed = rate === null;
  if (guessed) rate = base.rate - (type === "fha" ? 0.25 : type === "va" ? 0.375 : 0) - ((term || 30) <= 15 ? 0.5 : 0) - 0.25 * (points || 0) - (arm ? 0.5 : 0);
  if (down === null) down = type === "fha" ? 3.5 : type === "va" ? 0 : base.downPct;
  const bdm = low.match(/\b([123])\s*[-\/]\s*[0-2](?:\s*[-\/]\s*[01])?\s*(?:temporary\s+)?buy\s*-?\s*downs?\b/), bd = bdm ? +bdm[1] : 0;
  return { guessed, src: sp, bd, typed: { points: points !== null, down: /\bdown\b/.test(low) }, s: { name: "", type, term: term || 30, rate: +rate.toFixed(3), points: points || 0, arm, fees: base.fees, downPct: down,
    mi: type === "conv" ? convPmi(down, term || 30) : 0 } };
};
window.quickDraft = function quickDraft(text, ai) {
  let { parts, low, price, st, name, addr, rent, income, extraYearN, extraMonth } = noteBasics(text);
  if (ai) { name = ai.name || null; addr = ai.addr || addr; }
  const refi = /\brefi(nance)?\b/.test(low), condo = /\bcondo\b/.test(low), raw = (ai && ai.raw) || text;
  // Numbers for the tabs: the AI reader's facts, else what the typed rules can read
  const F = { ...noteFacts(raw) };
  Object.entries((ai && ai.facts) || {}).forEach(([k, v]) => { if (v != null && v !== false && !(Array.isArray(v) && !v.length)) F[k] = v; });
  let preset = "starter";
  if (/\bpoints?\b|buy ?down/.test(low)) preset = "points";
  else if (/\b15\b/.test(low)) preset = "term";
  else if (/\bva\b/.test(low) && /\bfha\b/.test(low)) preset = "convfhava";
  else if (/\bfha\b/.test(low)) preset = "convfha";
  else if (/\bdown\b/.test(low)) preset = "down";
  // Start a fresh comparison, then fill it in
  newComparison();
  state.creditReports = creditReportsFrom(text, ai ? ai.raw : "");
  state.payoff = null; state.irrrl = !!(F.irrrl || /\birrrl\b|\bva\s+streamline\b/i.test(raw));
  if (F.hoa_monthly) { state.hoa = Math.round(F.hoa_monthly); $("hoa").value = state.hoa; }
  draftInfo = { guessed: [], noPrice: !price, overLimit: 0 };
  if (name) $("cName").value = name;
  $("cTitle").value = (refi ? "Refinance options" : "Purchase options") + (addr ? ", " + addr : "");
  if (price) setPrice(price);
  if (st) {
    const pool = feeTemplates.filter((t) => (t.state || "").toUpperCase() === st);
    const fits = (t) => refi ? /refi/i.test(t.name) : condo ? /condo/i.test(t.name) : !/refi|condo/i.test(t.name);
    const pick = pool.find((t) => /^xpert/i.test(t.name) && fits(t)) || pool.find(fits) || pool[0];
    if (pick) applyFeeTemplate(pick);
    else applyDefaultTemplate(refi, condo);
  } else applyDefaultTemplate(refi, condo);
  // County, for the conforming loan limit: "Eagle County" (a high-cost county) or any "<name> County"
  let county = null;
  if (st) county = Object.keys(CLL_HIGH[st] || {}).find((c) => new RegExp("\\b" + c.replace(/[.'\\]/g, ".") + "\\s+county\\b", "i").test(text)) || null;
  if (!county) { const cm = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+County\b/); if (cm) county = cm[1]; }
  file.county = county || undefined; file.st = st || undefined;
  // Use the options exactly as typed when there are at least two; otherwise fall back to a common comparison
  let specs = ai && ai.opts ? null : optionSpecs(text.replace(CASH_RE, " "));
  if (ai && ai.opts && !ai.opts.length) { const sp = optionSpecs(raw.replace(CASH_RE, " ")); if (sp.length) specs = sp; }
  let optText, guessed = false;
  const overLimit = [];
  if (specs ? specs.length >= (ai ? 1 : 2) : ai.opts.length >= 1) {
    const base = { ...state.scenarios[0] };
    const opts = specs ? specs.map((sp) => parseOption(sp, base)) : ai.opts.map((o) => aiOption(o, base));
    // Conventional loans over the county limit are jumbo (no mortgage insurance); "jumbo" anywhere in the text means all of them
    const allJumbo = /\bjumbo\b/i.test(text) && !opts.some((o) => /\bjumbo\b/i.test(o.src));
    for (const o of opts) {
      if (o.s.type !== "conv") continue;
      const lc = loanClass(state.price * (1 - o.s.downPct / 100), st, county);
      if (allJumbo || lc.kind === "jumbo") { o.s.type = "jumbo"; o.s.mi = 0; }
      else if (lc.kind === "unknown") overLimit.push(o);
    }
    nameOptions(opts);
    // "seller credit $8,000" / "3% seller concessions" and "DPA $15,000" / "2nd of $20k" apply to every option
    const sc = text.match(/\bseller\s+(?:credit|concessions?|contributions?)\s*(?:of|is|:)?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|%)?|\b(\d+(?:\.\d+)?)\s*%\s*(?:in\s+)?seller\s+(?:credit|concessions?|contributions?)/i);
    const credit = !sc ? 0 : sc[3] ? state.price * +sc[3] / 100 : sc[2] === "%" ? state.price * parseFloat(sc[1]) / 100 : parseFloat(sc[1].replace(/,/g, "")) * (sc[2] ? 1000 : 1);
    const dm = text.match(/\b(?:dpa|down\s+payment\s+assistance|2nd(?:\s+(?:loan|mortgage))?|second\s+(?:loan|mortgage))\s*(?:of|for|is|:)?\s*\$?\s*(\d[\d,]*)\s*(k)?/i);
    const amt2 = dm ? parseFloat(dm[1].replace(/,/g, "")) * (dm[2] ? 1000 : 1) : 0;
    const dr = text.match(/\b(?:dpa|assistance|2nd|second)[^.,;]*?\bat\s*(\d+(?:\.\d+)?)\s*%/i);
    opts.forEach((o) => { if (o.bd) o.s.bd = o.bd; if (credit) o.s.credit = Math.round(credit); if (amt2 >= 1000) Object.assign(o.s, { amt2, rate2: dr ? +dr[1] : 0, term2: dr ? 30 : 0 }); });
    // The AI reader can tie a seller credit or a 2nd loan to one option
    opts.forEach((o) => { const x = o.ai; if (!x) return; if (x.seller_credit) o.s.credit = Math.round(x.seller_credit); if (x.second_amount >= 1000) Object.assign(o.s, { amt2: Math.round(x.second_amount), rate2: x.second_rate || 0, term2: x.second_rate ? 30 : 0 }); });
    guessed = opts.some((o) => o.guessed);
    draftInfo.guessed = opts.map((o, i) => o.guessed ? i : -1).filter((i) => i >= 0);
    opts.forEach((o) => { o.s.est = !!o.guessed; });
    state.scenarios = opts.map((o) => o.s);
    // A refinance: the loan is what's owed (plus any second, debts paid off and cash out), whatever down payment was read
    if (refi && state.price) {
      const rn = refiNumbers(raw, F);
      if (rn.owed) {
        state.payoff = rn.owed + (rn.second || 0) + rn.debt;
        setRefiLoan(Math.min(state.payoff + rn.cashOut, state.price * 0.97));
        if (rn.second === null) draftInfo.refiAsk = { debt: rn.debt, owed: rn.owed, cashOut: rn.cashOut };
      } else if (!opts.some((o) => o.typed.down)) { setRefiLoan(state.price * 0.8); draftInfo.refiAsk = { debt: rn.debt, second: rn.second, cashOut: rn.cashOut }; }
      nameOptions(opts);
    }
    renderCards(); render();
    optText = opts.map((o) => o.s.name).join(" vs ");
  } else if (refi && state.price) {
    // A refinance with no loans typed: 30 and 15 year conventional for what they owe (plus debts being paid off), or 80% of the value
    // With no balance given, start at 80% of the value and ask for the balance and any second mortgage
    const rp = refiNumbers(raw, F);
    const known = !!rp.owed;
    const loan = known ? rp.owed + (rp.second || 0) + rp.debt + rp.cashOut : state.price * 0.8;
    if (known) state.payoff = rp.owed + (rp.second || 0) + rp.debt;
    if (!known) draftInfo.refiAsk = { debt: rp.debt, second: rp.second, cashOut: rp.cashOut };
    else if (rp.second === null) draftInfo.refiAsk = { debt: rp.debt, owed: rp.owed, cashOut: rp.cashOut };
    const a = { ...state.scenarios[0] };
    file.st = st || undefined; file.county = county || undefined;
    state.scenarios = [30, 15].map((term) => ({ ...a, type: "conv", term, arm: 0, points: 0, bd: 0, credit: 0, amt2: 0, fthb: false, rate: +(term === 15 ? (+a.rate || 6.75) - 0.5 : (+a.rate || 6.75)).toFixed(3), est: true }));
    const down = setRefiLoan(Math.min(loan, state.price * 0.97));
    nameOptions(state.scenarios.map((x) => ({ s: x, typed: { down: false } })));
    renderCards(); render();
    optText = state.scenarios.map((x) => x.name).join(" vs ") + ` (loan ${usd.format(Math.round(state.price * (1 - down / 100)))})`;
    draftInfo.guessed = [0, 1]; draftInfo.sample = true;
  } else {
    applyPreset(preset);
    optText = $("preset").querySelector(`option[value="${preset}"]`).textContent;
    draftInfo.guessed = state.scenarios.map((x, i) => i); draftInfo.sample = true;
    state.scenarios.forEach((x) => { x.est = true; });
  }
  // State's FHFA home value growth (5-yr average) for the equity chart
  if (st && fhfaRate(st, DEFAULT_SRC) !== null) { state.appreciation = fhfaRate(st, DEFAULT_SRC); $("appreciation").value = state.appreciation; render(); }
  file.st = st || undefined; file.rent = rent || undefined;
  if (st) stateEscrow(st);
  const added = calcsFromNote(text, { refi, rent, income, extraYearN, extraMonth, specs, facts: F, raw });
  if (added.length) drawTabs();
  draftInfo.overLimit = overLimit.length;
  const bits = [name && "client " + name, price && "price " + usd.format(price), st && "state " + st, "options: " + optText, added.length && "also added " + added.join(", "), state.creditReports > 1 && `credit report for ${state.creditReports} (the buyers aren't a couple, so each gets a report)`];
  const limNote = overLimit.length ? ` ${overLimit.length === 1 ? "One loan is" : "Some loans are"} over the ${usd.format(CLL_BASE)} conforming limit: add the ${st ? "county" : "state and county"} (e.g. "Eagle County, CO") to tell high balance from jumbo.` : "";
  autoTitle();
  say("saveStatus", "Drafted " + bits.filter(Boolean).join(", ") + "." + limNote + (guessed ? " Rates you didn't type are placeholders, so enter today's pricing" : " Check the pricing") + ", then save.");
};
(() => { const l = document.querySelector("#price").closest("label"); if (!document.getElementById("priceLbl")) l.firstChild.replaceWith(Object.assign(document.createElement("span"), { id: "priceLbl", textContent: "Purchase price" })); render(); })();
"analyze,normFeeItems,feeAmount,closingTotals,renderClosing,optionSpecs,parseOption,quickDraft";
