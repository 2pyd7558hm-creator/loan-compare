window.vaFeeFor = function vaFeeFor(downPct) { return isRefiFile() ? (state.irrrl ? 0.5 : 2.15) : vaFee(downPct); };
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
  const cc = closingTotals(loan);
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
  const amtFin = loan - financed - pointsCost - s.fees - cc.apr;
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
window.render = function render() {
  state.scenarios.forEach((s, i) => syncMI(i));
  const res = state.scenarios.map(analyze);
  renderClosing(res[0]);
  const refiNow = isRefiFile(), anyBack = res.some((r) => r.cashBack > 0.5);
  $("priceLbl").textContent = refiNow ? "Home value" : "Purchase price";
  const h = state.horizon * 12;
  const base = res[0];
  [...$("horizon").children].forEach((b) => b.setAttribute("aria-pressed", +b.dataset.y === state.horizon));

  const minBy = (f) => { let bi = 0; res.forEach((r, i) => { if (f(r) < f(res[bi])) bi = i; }); return bi; };
  const bCost = minBy((r) => r.cost[h]), bPay = minBy((r) => r.total), bCash = minBy((r) => r.cashToClose);
  const maxEq = (() => { let bi = 0; res.forEach((r, i) => { if (r.equity[h] > res[bi].equity[h]) bi = i; }); return bi; })();
  const tagOf = (i) => `<span class="tag" style="background:var(${COLORS[i]})">${LETTERS[i]}</span>`;
  const hl = (k, i, v, s) => `<div class="hl"><div class="k">${k}</div><div class="v">${tagOf(i)}${v}</div><div class="s">${state.scenarios[i].name}${s ? " · " + s : ""}</div></div>`;
  const second = [...res].map((r) => r.cost[h]).sort((a, b) => a - b)[1];
  $("highlights").innerHTML =
    hl(`Lowest cost over ${state.horizon} yrs`, bCost, usd.format(res[bCost].cost[h]), res.length > 1 ? `saves ${usd.format(second - res[bCost].cost[h])} vs next` : "") +
    hl("Lowest monthly payment", bPay, usd.format(res[bPay].total), "per month") +
    hl("Least cash to close", bCash, usd.format(res[bCash].cashToClose), "") +
    hl(`Most equity at ${state.horizon} yrs`, maxEq, usd.format(res[maxEq].equity[h]), "");

  const row = (label, f, best, cls = "") => `<tr class="${cls}"><td>${label}</td>${res.map((r, i) => `<td class="${best === i ? "best" : ""}">${f(r, i)}</td>`).join("")}</tr>`;
  const group = (t) => `<tr class="group"><td colspan="${res.length + 1}">${t}</td></tr>`;
  const typeName = { conv: "Conventional", jumbo: "Jumbo", fha: "FHA", va: "VA" };
  const any2 = res.some((r) => r.amt2), anyBd = res.some((r) => r.bd), anyCredit = res.some((r) => r.credit || r.creditUnused);
  const typeOf = (r) => { if (r.s.type !== "conv") return typeName[r.s.type]; const k = loanClass(Math.max(0, state.price - r.down), where().st, where().county).kind; return k === "high" ? "High balance" : k === "jumbo" ? "Conventional (over limit)" : "Conventional"; };
  $("table").innerHTML = `<thead><tr><th></th>${res.map((r, i) => `<th>${tagOf(i)}${r.s.name.replace(/ - /g, "\u00a0- ")}</th>`).join("")}</tr></thead><tbody>
    ${group("Loan")}
    ${row("Loan type / term", (r) => `${typeOf(r)} · ${r.s.term} yr ${r.s.arm ? `${r.s.arm}/6 ARM` : "fixed"}`)}
    ${row("Interest rate", (r) => pct(r.s.rate))}
    ${row("APR (estimated)", (r) => pct(r.apr))}
    ${row("Loan amount", (r) => usd.format(r.loan) + (r.financed ? `<div style="font-size:12px;color:var(--muted)">incl. ${usd.format(r.financed)} financed</div>` : ""))}
    ${refiNow ? row("Loan-to-value", (r) => pct(state.price > 0 ? (r.loan - r.financed) / state.price * 100 : 0, 1)) : ""}
    ${any2 ? row("2nd loan / DPA", (r) => r.amt2 ? usd.format(r.amt2) + `<div style="font-size:12px;color:var(--muted)">${r.pi2 ? `${pct(+r.s.rate2 || 0)} · ${r.s.term2} yrs` : "deferred"}</div>` : "None") : ""}
    ${group("Monthly")}
    ${row("Principal &amp; interest", (r) => usd.format(r.pi))}
    ${row("Mortgage insurance", (r) => r.mi ? usd.format(r.mi) : "None")}
    ${any2 ? row("2nd loan / DPA payment", (r) => r.pi2 ? usd.format(r.pi2) : r.amt2 ? "Deferred" : "None") : ""}
    ${row("Taxes, insurance, HOA", (r) => usd.format(r.escrow))}
    ${row("Total monthly payment", (r) => usd.format(r.total), bPay, "strong")}
    ${anyBd ? row("Payment during buydown", (r) => r.bd ? r.bdPay.map((x, y) => `Yr ${y + 1}: ${usd.format(r.total - r.pi + x)}`).join("<br>") : "No buydown") : ""}
    ${group("Cash to close")}
    ${refiNow ? (state.payoff > 0 ? row("Pays off what's owed", () => usd.format(state.payoff)) : "") : row("Down payment", (r) => `${usd.format(r.down)} <span style="color:var(--muted)">(${pct(r.s.downPct, 2)})</span>`)}
    ${any2 ? row("2nd loan / DPA toward it", (r) => r.amt2 ? "−" + usd.format(r.amt2) : "None") : ""}
    ${row("Points", (r) => usd.format(r.pointsCost))}
    ${row(hasClosing() ? "Lender fees (in APR)" : "Lender fees", (r) => usd.format(r.lenderFees))}
    ${hasClosing() ? row("Third-party fees", (r) => usd.format(r.cc.other)) + row("Prepaids &amp; escrow deposits", (r) => usd.format(r.cc.prepaid)) : ""}
    ${anyBd ? row("Buydown cost", (r) => r.bd ? usd.format(r.bdCost) : "None") : ""}
    ${anyCredit ? row("Seller credit", (r) => r.credit ? "−" + usd.format(r.credit) + (r.creditUnused > 0.5 ? `<div style="font-size:12px;color:var(--muted)">${usd.format(r.creditUnused)} unused</div>` : "") : "None") : ""}
    ${row("Estimated cash to close", (r) => usd.format(r.cashToClose), bCash, "strong")}
    ${anyBack ? row("Cash back to you", (r) => r.cashBack > 0.5 ? usd.format(r.cashBack) : "None", -1, "strong") : ""}
    ${group("Over time")}
    ${row(`Total cost at ${state.horizon} yrs`, (r, i) => usd.format(r.cost[h]) + (i === bCost ? `<span class="pill">Lowest</span>` : ""), bCost, "strong")}
    ${row("Total cost at 30 yrs", (r) => usd.format(r.cost[MONTHS]))}
    ${row(`Loan balance at ${state.horizon} yrs`, (r) => usd.format(r.bal[h]))}
    ${row(`Home equity at ${state.horizon} yrs`, (r) => usd.format(r.equity[h]), maxEq)}
    ${row(`Break-even vs ${LETTERS[0]}`, (r) => breakEven(r, base))}
  </tbody>`;

  const maxPay = Math.max(...res.map((r) => r.total));
  $("payChart").innerHTML = res.map((r, i) => `<div class="bar-row">
      <div class="lbl"><span>${LETTERS[i]} · ${r.s.name}</span><b>${usd.format(r.total)}</b></div>
      <div class="bar"><span style="width:${(r.pi + r.pi2) / maxPay * 100}%;background:var(--brand)"></span><span style="width:${r.mi / maxPay * 100}%;background:var(--brand-2)"></span><span style="width:${r.escrow / maxPay * 100}%;background:var(--muted);opacity:.45"></span></div>
    </div>`).join("");

  $("costTitle").textContent = `Total cost over ${state.horizon} years`;
  const maxCost = Math.max(...res.map((r) => r.cost[h]));
  $("costBars").innerHTML = res.map((r, i) => `<div class="bar-row">
      <div class="lbl"><span>${LETTERS[i]} · ${r.s.name}${i === bCost ? '<span class="pill">Lowest</span>' : ""}</span><b>${usd.format(r.cost[h])}</b></div>
      <div class="bar"><span style="width:${r.cost[h] / maxCost * 100}%;background:var(${COLORS[i]})"></span></div>
    </div>`).join("");

  const legend = res.map((r, i) => `<span><i style="background:var(${COLORS[i]})"></i>${LETTERS[i]} · ${r.s.name}</span>`).join("");
  lineChart($("costChart"), res.map((r, i) => ({ color: COLORS[i], values: r.cost })), h);
  lineChart($("equityChart"), res.map((r, i) => ({ color: COLORS[i], values: r.equity })), h);
  $("lg1").innerHTML = legend; $("lg2").innerHTML = legend;
};
window.setCompare = function setCompare(obj) {
  Object.assign(state, obj);
  state.taxPct = obj.taxPct; state.insPct = obj.insPct; // older saves: worked out from the saved amounts
  state.payoff = obj.payoff ?? null; state.irrrl = !!obj.irrrl;
  state.closing = obj.closing ? JSON.parse(JSON.stringify(obj.closing)) : { template: "", items: [] };
  TOP_KEYS.forEach((k) => { $(k).value = state[k]; });
  escrowHints();
  renderCards(); render();
};
window.nameOptions = function nameOptions(opts) {
  const showType = new Set(opts.map((o) => o.s.type)).size > 1, showPts = opts.some((o) => o.typed.points), downs = new Set(opts.map((o) => o.s.downPct));
  const refi = isRefiFile(), showDown = refi ? downs.size > 1 : opts.some((o) => o.typed.down) && (downs.size > 1 || !showPts);
  const ptsTxt = (p) => `${+p} Point${+p === 1 ? "" : "s"}`;
  const names = opts.map((o) => {
    const s = o.s, det = [];
    if (showPts) det.push(ptsTxt(s.points));
    if (showDown) det.push(refi ? `${+(100 - s.downPct).toFixed(1)}% LTV` : `${+s.downPct}% Down`);
    const bd = s.bd || o.bd;
    return (showType ? { conv: "Conv", jumbo: "Jumbo", fha: "FHA", va: "VA" }[s.type] + " " : "") + (s.arm ? `${s.arm}/6 ARM` : `${s.term} Yr Fixed`) + (det.length ? " - " + det.join(", ") : "") + (bd ? `, ${{ 1: "1-0", 2: "2-1", 3: "3-2-1" }[bd]} Buydown` : "");
  });
  // Names never carry the rate (the rate has its own row); the letters A, B, C tell twins apart
  opts.forEach((o, i) => { o.s.name = names[i]; });
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
  const specs = ai && ai.opts ? null : optionSpecs(text.replace(CASH_RE, " "));
  let optText, guessed = false;
  const overLimit = [];
  if (specs ? specs.length >= 2 : ai.opts.length >= 1) {
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
window.noteFacts = function noteFacts(text) {
  const n = (m) => m ? parseFloat(m[1].replace(/,/g, "")) * (/^k/i.test(m[2] || "") ? 1000 : 1) : null;
  const F = {};
  const hoa = n(text.match(/\bhoa\s*(?:dues|fees?)?\s*(?:is|of|:)?\s*\$?\s*(\d[\d,]*)(k)?/i) || text.match(/\$?\s*(\d[\d,]*)(k)?\s*(?:\/\s*mo\s*)?hoa\b/i)); if (hoa >= 10 && hoa < 5000) F.hoa_monthly = hoa;
  const wm = text.match(/\bwait(?:ing)?\s+(?:for\s+)?(\d+|a|one|two|six)\s*(mo|months?|yrs?|years?)\b/i);
  if (wm) { const k = { a: 1, one: 1, two: 2, six: 6 }[wm[1].toLowerCase()] || +wm[1]; F.wait_months = /^y/i.test(wm[2]) ? k * 12 : k; }
  const bid = n(text.match(/\$?\s*(\d[\d,]*)\s*(k)?\s+(?:over|above)\s+(?:asking|ask|list)/i)); if (bid >= 1000) F.bid_over = bid;
  const debts = n(text.match(/\b(?:debts?|debt payments?)\s*(?:are|is|of|:)?\s*\$?\s*(\d[\d,]*)(k)?\s*(?:\/\s*mo|a month|per month|monthly)/i)); if (debts >= 10 && debts < 20000) F.monthly_debts = debts;
  return F;
};
window.refiParts = function refiParts(text) {
  const owed = refiAmt(text.match(new RegExp(String.raw`\b(?:owes?|owed|owing|balance(?:\s+(?:is|of))?|payoff(?:\s+(?:is|of))?|current\s+(?:loan|mortgage)(?:\s+(?:is|of))?|first(?:\s+mortgage)?(?:\s+(?:is|of))?)\s*(?:about|around|~)?\s*` + AMT, "i")));
  const debt = refiAmt(text.match(new RegExp(String.raw`\b(?:credit\s+cards?|cards|cc|debts?|car\s+loan|student\s+loans?)\s*(?:of|is|are|:|total(?:ing)?)?\s*(?:about|around|~)?\s*` + AMT, "i")))
    || refiAmt(text.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\s+(?:in|of)\s+(?:credit\s+card|card|consumer)?\s*debts?\b/i));
  const co = refiAmt(text.match(new RegExp(String.raw`\bcash[- ]?out\s*(?:of|is|:)?\s*(?:about|around|~)?\s*` + AMT, "i"))) || refiAmt(text.match(new RegExp(AMT + String.raw`\s*(?:cash[- ]?out|cash\s+back|(?:in\s+)?cash\b(?!\s+(?:purchase|buyer|offer)))`, "i")));
  return { owed: owed >= 1000 ? owed : 0, second: refiSecond(text), debt: debt >= 100 ? debt : 0, cashOut: co >= 1000 ? co : 0 };
};
window.refiNumbers = function refiNumbers(raw, F) {
  const rp = refiParts(raw), list = (F.debts_paid_off || []).reduce((a, x) => a + (+x.balance || 0), 0);
  const owed = F.current_balance || rp.owed, second = F.second_balance != null ? F.second_balance : rp.second;
  return { owed: owed && owed < state.price ? owed : 0, second, debt: list || rp.debt, cashOut: F.cash_out || rp.cashOut || 0 };
};
window.calcsFromNote = function calcsFromNote(text, ctx, reuse) {
  const { refi, rent, income, extraYearN, extraMonth, specs } = ctx, F = ctx.facts || {};
  const added = [], s0 = state.scenarios[0], a0 = s0 ? analyze(s0) : null;
  const invest = /\binvest(ment|or)?\b|\brental\b|\binv\.?\s+prop|\bnoo\b|non[- ]owner/i.test(text + " " + (ctx.raw || ""));
  const addOrFill = (kind, extra, silent) => {
    const have = reuse && file.calcs.find((c) => c.kind === kind);
    if (have) { Object.assign(have.data, extra || {}); calcsFromNote.last = have; return have; }
    return (calcsFromNote.last = addCalc(kind, extra, silent));
  };
  if (/\bwait(ing)?\b|cost of waiting/i.test(text)) {
    const ex = refi ? { mode: "refi" } : {};
    if (F.wait_months) Object.assign(ex, refi ? { wait: F.wait_months } : { months: F.wait_months });
    if (!refi && F.rate_if_wait) ex.rateLater = F.rate_if_wait;
    if (refi) {
      // Today's loan from the note; the new loan is option A
      if (F.current_balance) ex.curBal = F.current_balance;
      if (F.current_rate) ex.curRate = F.current_rate;
      if (F.current_years_left) ex.curYears = F.current_years_left;
      if (a0) Object.assign(ex, { newAmt: Math.round(a0.loan), rateNow: s0.rate, newTerm: s0.term });
      if (F.hoped_rate) ex.rateHope = F.hoped_rate; else if (s0) ex.rateHope = +(s0.rate - 0.5).toFixed(3);
    }
    addOrFill("cow", ex, true); added.push("cost of waiting");
  }
  if (rent && !invest) { addOrFill("rvb", { rent }, true); added.push("rent vs buy"); }
  if (income || /\bafford/i.test(text)) {
    // Affordability uses option A's program and rate, and the cash and debts in the note
    const ex = income ? { income } : {};
    if (s0) Object.assign(ex, { program: s0.type === "fha" ? "fha" : s0.type === "va" ? "va" : "conv", rate: s0.rate, term: s0.term });
    if (F.monthly_debts) ex.debts = F.monthly_debts;
    if (F.cash_for_down != null) ex.down = F.cash_for_down; else if (s0 && s0.type === "va" && s0.downPct === 0) ex.down = 0;
    addOrFill("aff", ex, true); added.push("affordability");
  }
  if (/\bdebts?\b|consolidat/i.test(text)) {
    // The mortgage and debts from the note; a payment that wasn't typed is estimated (cards 3% of the balance, loans over 5 years)
    const ex = { value: state.price || 500000 };
    const owed = F.current_balance || refiParts(ctx.raw || text).owed;
    if (owed) ex.mBal = owed;
    if (F.current_rate) ex.mRate = F.current_rate;
    if (F.current_years_left) ex.mYears = F.current_years_left;
    if (s0) Object.assign(ex, { rate: s0.rate, term: s0.term });
    const list = (F.debts_paid_off || []).map((x) => {
      const card = /card|revolv|cc\b/i.test(x.name || ""), rate = x.rate || (card ? 22 : 8.5);
      return { name: x.name || "Debt", kind: card ? "revolving" : "installment", bal: x.balance, rate, pay: x.payment || Math.round(card ? x.balance * 0.03 : pmt(x.balance, rate, 5)), payoff: true, est: !x.payment };
    });
    if (!list.length && refi) { const rp = refiParts(ctx.raw || text); if (rp.debt) list.push({ name: "Debts paid off", kind: "revolving", bal: rp.debt, rate: 22, pay: Math.round(rp.debt * 0.03), payoff: true, est: true }); }
    if (list.length || refi) ex.debts = list.length ? list : [{ name: "Debt to pay off", kind: "revolving", bal: 0, rate: 0, pay: 0, payoff: true }];
    if (F.second_balance && ex.debts) ex.debts.push({ name: "Second mortgage / HELOC", kind: "installment", bal: F.second_balance, rate: 8.5, pay: Math.round(pmt(F.second_balance, 8.5, 15)), payoff: true, est: true });
    addOrFill("debt", ex, true); added.push("debt consolidation" + (ex.debts && ex.debts.some((x) => x.est) ? " (debt payments not typed are estimated, so fix them on the tab)" : ""));
  }
  if (/\bextra\b|pay ?off (early|faster|sooner)/i.test(text)) {
    // Use the first option's loan; "2 extra payments a year" means two extra principal and interest payments each year
    const a = analyze(state.scenarios[0]), s0 = state.scenarios[0], ex = { loan: Math.round(a.loan), rate: s0.rate, term: s0.term };
    if (extraYearN) Object.assign(ex, { yearly: Math.round(extraYearN * a.pi), extra: 0 });
    if (extraMonth) ex.extra = extraMonth;
    addOrFill("amort", ex, true);
    added.push("extra payments" + (extraYearN ? ` (${extraYearN} extra payment${extraYearN === 1 ? "" : "s"} a year, ${usd.format(Math.round(extraYearN * a.pi))})` : extraMonth ? ` (${usd.format(extraMonth)} a month)` : ""));
  }
  if (/\barm\b|adjustable/i.test(text)) {
    // Fill the ARM tab from the typed options: the first ARM against the first fixed loan
    const a = state.scenarios.find((x) => x.arm), f = state.scenarios.find((x) => !x.arm), ex = {};
    // Caps: 2/1/5 on a 5/6 ARM, 5/1/5 on a 7/6 or 10/6 (SOFR ARM standards)
    if (a) Object.assign(ex, { loan: Math.round(analyze(a).loan), armRate: a.rate, fixedYrs: a.arm, term: a.term, capFirst: a.arm <= 5 ? 2 : 5, capEach: 1, capLife: 5 });
    if (f) Object.assign(ex, { fixedRate: f.rate, flatRate: f.rate });
    addOrFill("arm", ex, true); added.push("ARM vs fixed");
  }
  if (/over ?ask|\bbid\b/i.test(text)) {
    // The price is what they'd pay; asking is that less the amount over
    const over = F.bid_over || 15000, ex = { mode: "bid", over };
    if (state.price) Object.assign(ex, { asking: state.price - (F.bid_over ? over : 0), value: state.price - (F.bid_over ? over : 0) });
    if (s0) Object.assign(ex, { downPct: s0.downPct, rate: s0.rate, term: s0.term });
    addOrFill("equity", ex, true); added.push("bid over asking");
  }
  else if (/\bequity\b|apprec/i.test(text)) { addOrFill("equity", null, true); added.push("equity & appreciation"); }
  if (invest) {
    // Price, down payment and rate as typed (option A); rent from the note
    const ex = {};
    if (state.price) ex.price = state.price;
    if (s0 && !s0.est) Object.assign(ex, { rate: s0.rate, term: s0.term });
    if (s0 && /\bdown\b|\bdn\b|%/i.test(ctx.raw || text)) ex.downPct = s0.downPct;
    if (rent) ex.rent = rent;
    if (state.insurance) ex.insurance = state.insurance;
    addOrFill("invest", ex, true); added.push("investment property");
  }
  if (CASH_RE.test(text)) {
    // Compare paying cash with the first financed option
    // Compare with the one financed option typed ("paying cash vs 20% down at 6.5%"), else the first option
    const s0 = specs && specs.length === 1 ? { ...state.scenarios[0], ...parseOption(specs[0], { ...state.scenarios[0] }).s } : state.scenarios[0], a = analyze(s0);
    const ex = { price: state.price, downPct: s0.downPct, rate: s0.rate, term: s0.term, closing: Math.round(a.pointsCost + a.lenderFees + a.cc.other), cashClose: cashClosing() };
    // Where the cash would come from, when the note says
    if (F.savings) ex.liquid = F.savings;
    if (F.investments) ex.inv = F.investments;
    if (F.retirement) ex.ret = F.retirement;
    if (F.under_59 === true) ex.under59 = 1; else if (F.under_59 === false) ex.under59 = 0;
    addOrFill("cash", ex, true); added.push("cost of paying cash");
  }
  return added;
};
window.asAskBalance = function asAskBalance(r) {
  const debtTxt = r.debt ? ` plus ${usd.format(r.debt)} of debts paid off` : "";
  const setLoan = (owed, second) => {
    if (!toCompare()) return asNext();
    state.payoff = owed + second + (r.debt || 0);
    const loan = Math.min(state.payoff + (r.cashOut || 0), state.price * 0.97);
    setRefiLoan(loan); renderCards(); render(); syncActive();
    asSay(`Loan amount set to ${usd.format(Math.round(loan))}: balance ${usd.format(owed)}${second ? ` + second ${usd.format(second)}` : ""}${r.debt ? ` + ${usd.format(r.debt)} debts` : ""}.`);
    asNext();
  };
  const unsure = () => { asSay("OK, I kept the loan at 80% of the value. Change it on the cards when you know the balance."); asNext(); };
  if (r.owed) {
    asSay(`Is there a second mortgage or HELOC to pay off too? Type its balance, or say no.`, [{ label: "No second", fn: () => setLoan(r.owed, 0) }], { kind: "balance", answer: (t) => {
      const sec = /^\s*(?:no|nope|none|n\/?a)\b/i.test(t) ? 0 : refiSecond(t) ?? refiAmt(t.match(new RegExp(AMT, "i")));
      setLoan(r.owed, sec >= 1000 ? sec : 0);
    } });
    return;
  }
  asSay(`What's the current loan balance${debtTxt ? " (I'll add the debts being paid off)" : ""}? And is there a second mortgage or HELOC? For example: "320k, no second" or "320k and a 45k HELOC". I used 80% of the value for now.`,
    [{ label: "Not sure, use 80%", fn: unsure }], { kind: "balance", answer: (t) => {
      if (/not\s+sure|unsure|don'?t\s+know|no\s+idea|idk/i.test(t)) return unsure();
      const sec = refiSecond(t);
      const rest = t.replace(new RegExp(String.raw`\b(?:second|2nd|heloc)(?:\s+(?:mortgage|loan|lien))?\s*(?:of|is|for|balance|:|at)?\s*(?:about|around|~)?\s*` + AMT, "i"), " ").replace(new RegExp(AMT + String.raw`\s*(?:on\s+(?:a|the)\s+|in\s+(?:a|the)\s+)?(?:second|2nd|heloc)\b`, "i"), " ");
      const owed = refiAmt(rest.match(new RegExp(AMT, "i")));
      if (owed < 1000 || owed >= state.price) { asSay("I didn't catch a balance there, so I kept 80% of the value. You can change it on the cards."); return asNext(); }
      setLoan(owed, sec || r.second || 0);
    } });
};
window.asSuggest = function asSuggest() {
  const has = (k) => file.calcs.some((c) => c.kind === k), sc = state.scenarios, out = [];
  const offer = (key, q, fn) => { if (!asDeclined.has(key) && out.length < 2) { out.push({ key, q, fn }); asDeclined.add(key); } };
  const ctx = { refi: false, rent: null, income: null, extraYearN: null, extraMonth: null, specs: null };
  const addTab = (txt) => { const added = calcsFromNote(txt, ctx, true); drawTabs(); asSay(`Added ${added.join(", ")} as a tab below. Save when it looks right.`); asNext(); };
  if (sc.length >= 3 && !has("amort")) offer("amort", "Want to show how extra payments could pay one of these off faster?", () => addTab("extra"));
  if (sc.some((x) => x.arm) && !has("arm")) offer("arm", "One option is an ARM. Want an ARM vs fixed tab showing how the payment could change later?", () => addTab("ARM"));
  const refiOrRental = /refi/i.test($("cTitle").value) || has("invest");
  if (!refiOrRental && sc.some((x) => x.type === "fha" || x.downPct <= 5) && !has("rvb") && out.length < 2 && !asDeclined.has("rvb")) { out.push({ key: "rvb", q: "With a small down payment, a rent vs buy comparison often helps. What's their rent now? Or say no.", rent: true }); asDeclined.add("rvb"); }
  if (!out.length && !has("cow") && !/refi/i.test($("cTitle").value)) offer("cow", "Want a cost of waiting tab, showing what it could cost to wait a year to buy?", () => addTab("wait"));
  if (!out.length) { asNext(); return; }
  out.forEach((o) => asQueue.push(() => {
    const no = { label: "No thanks", fn: () => { asDeclined.add(o.key); asNext(); } };
    if (o.rent) asSay(o.q, [no], { kind: "rent", answer: (t) => {
      const r = +(t.replace(/[^\d.]/g, "")); if (/^\s*no\b/i.test(t) || !(r >= 100)) { asDeclined.add("rvb"); asSay("OK, no rent vs buy."); return asNext(); }
      calcsFromNote("rent " + r, { ...ctx, rent: r }, true); drawTabs(); asSay(`Added rent vs buy with rent of ${usd.format(r)} a month.`); asNext();
    } });
    else asSay(o.q, [{ label: "Yes, add it", fn: o.fn }, no], { kind: "suggest", answer: (t) => { /^\s*(y|yes|sure|ok|please)\b/i.test(t) ? o.fn() : (asDeclined.add(o.key), asNext()); } });
  }));
  asNext();
};
window.applyAi = function applyAi(job, d) {
  const n = (v) => String(Math.round(+v));
  const anyArm = d.options.some((o) => o.arm);
  const bits = [d.price ? "$" + n(d.price) : "", d.state || "", d.county ? d.county.replace(/\s+county$/i, "") + " County" : "", d.refi ? "refi" : "", d.condo ? "condo" : "",
    d.jumbo_all ? "jumbo" : "", d.rent ? "rent " + n(d.rent) : "", d.income ? "income " + n(d.income) : "", d.cost_of_waiting ? "wait" : "", d.debts ? "debts" : "",
    d.extra_payments_per_year ? `${n(d.extra_payments_per_year)} extra payments a year` : d.extra_monthly ? `extra $${n(d.extra_monthly)} a month` : d.extra_payments ? "extra payments" : "",
    d.arm_vs_fixed || anyArm ? "ARM" : "", d.bid_over_asking ? "over asking" : "", d.equity ? "equity" : "", d.investment ? "investment" : "", d.paying_cash ? "paying cash" : "",
    d.seller_credit_all ? "seller credit $" + n(d.seller_credit_all) : "", d.credit_reports > 1 ? `credit reports ${Math.round(d.credit_reports)}` : "", d.dpa_amount ? `DPA $${n(d.dpa_amount)}${d.dpa_rate ? ` at ${d.dpa_rate}%` : ""}` : ""];
  quickDraft(bits.filter(Boolean).join(", "), { name: job.name || "", addr: job.addr || "", opts: d.options.slice(0, 4), raw: job.note, facts: d.facts || {} });
  const notes = (d.assumptions || []).filter(Boolean);
  if (notes.length) say("saveStatus", $("saveStatus").textContent + " AI reader notes: " + notes.join(" "));
};
(() => { const l = document.querySelector("#price").closest("label"); if (!document.getElementById("priceLbl")) l.firstChild.replaceWith(Object.assign(document.createElement("span"), { id: "priceLbl", textContent: "Purchase price" })); render(); })();
"vaFeeFor,analyze,render,setCompare,nameOptions,quickDraft,noteFacts,refiParts,refiNumbers,calcsFromNote,asAskBalance,asSuggest,applyAi";
