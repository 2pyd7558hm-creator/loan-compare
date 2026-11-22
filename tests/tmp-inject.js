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
(() => { const l = document.querySelector("#price").closest("label"); if (!document.getElementById("priceLbl")) l.firstChild.replaceWith(Object.assign(document.createElement("span"), { id: "priceLbl", textContent: "Purchase price" })); render(); })();
"analyze,normFeeItems,feeAmount,closingTotals,renderClosing";
