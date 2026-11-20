/* ===== Borrower calculators for the hub (loaded after the loan comparison script; uses $, usd, pct, lineChart, MONTHS) =====
   Each calculator: { label, tag, title, intro, note, blank(basics), mount(el, data, changed), refresh() }
   - mount builds the inputs and results inside its section and keeps `data` up to date as the loan officer types
   - changed() is called after every edit so the hub can save and broadcast live
*/

/* FHFA purchase-only house price index by state, annualized change to 2026 Q2 (not seasonally adjusted, same quarter compared).
   [last 1 yr, 5-yr average, 10-yr average], in % per year. Source: fhfa.gov/data/hpi/datasets (hpi_po_state.txt), pulled 2026-11-19. */
const FHFA_ASOF = "2026 Q2";
const FHFA = {"AK":[8.3,6.5,5.1],"AL":[2.8,6.4,6.9],"AR":[1.1,6.6,6.5],"AZ":[0.5,5,7.9],"CA":[-0.3,3.2,5.8],"CO":[-0.6,3,6.2],"CT":[4.6,8.4,7.1],"DC":[1.5,-0.6,2.7],"DE":[3.2,6.4,6.2],"FL":[0.9,6.6,8.1],"GA":[1.8,6.8,7.8],"HI":[5.9,6.8,6.9],"IA":[2.3,5.8,5.6],"ID":[3.5,4.4,10],"IL":[5.5,7.6,6.2],"IN":[3.5,6.9,7.6],"KS":[3.2,6.4,6.8],"KY":[4.3,6.9,7],"LA":[1.6,3.1,3.6],"MA":[3.6,6.2,7],"MD":[0.9,4.6,4.9],"ME":[1,8,8.8],"MI":[3.7,6.7,7.7],"MN":[2.4,4.5,5.9],"MO":[3.7,6.7,7.3],"MS":[0.6,6.3,5.6],"MT":[2.6,7,8.1],"NC":[0.4,7.2,8],"ND":[4.8,5.8,4.5],"NE":[2,6,6.8],"NH":[3.1,7.9,8.4],"NJ":[4.5,8.5,7.5],"NM":[-1.2,6.1,6.5],"NV":[2.7,5.1,7.9],"NY":[3.5,7.7,7.4],"OH":[4.3,7.2,7.7],"OK":[1.9,5.7,5.8],"OR":[0.2,3,5.9],"PA":[3.9,6.5,6.7],"RI":[4.6,7.8,8.5],"SC":[2.3,7.7,8.1],"SD":[1.1,6.3,6.7],"TN":[0.9,6.7,8.1],"TX":[0.4,4.6,6.1],"UT":[1,4.4,8.3],"VA":[3,6.5,6.6],"VT":[7.2,8.7,8],"WA":[-1,3.6,7.4],"WI":[4.8,7.9,7.9],"WV":[5.7,7,5.4],"WY":[3.2,6.4,6]};
const APPR_SRC = [["1", "Last 12 months"], ["5", "5-yr average"], ["10", "10-yr average"], ["custom", "Custom"]];
const DEFAULT_STATE = "CO", DEFAULT_SRC = "5";
function fhfaRate(st, src) { const r = FHFA[st]; return r ? r[src === "1" ? 0 : src === "10" ? 2 : 1] : null; }
function apprOf(d) { if (d.apprSrc === "custom") return +d.appr || 0; const v = fhfaRate(d.st, d.apprSrc); return v === null ? (+d.appr || 0) : v; }
function apprLabel(d) {
  if (d.apprSrc === "custom" || !FHFA[d.st]) return pct(apprOf(d), 2) + " / yr";
  return `${pct(apprOf(d), 2)} / yr <span class="est">FHFA ${d.st}, ${APPR_SRC.find((x) => x[0] === d.apprSrc)[1].toLowerCase()}</span>`;
}

const pmt = (loan, ratePct, years) => { const n = years * 12, r = ratePct / 1200; return loan <= 0 ? 0 : r ? loan * r / (1 - Math.pow(1 + r, -n)) : loan / n; };
const balAfter = (loan, ratePct, years, m) => { const r = ratePct / 1200, p = pmt(loan, ratePct, years); return r ? Math.max(0, loan * Math.pow(1 + r, m) - p * (Math.pow(1 + r, m) - 1) / r) : Math.max(0, loan - p * m); };
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/* Small form builders. Inputs carry data-k so one listener can update the calculator's data. */
function numIn(label, k, d, o = {}) {
  const pre = o.pre ? `<div class="affix pre"><span>${o.pre}</span>` : `<div class="affix"><span>${o.suf || ""}</span>`;
  return `<label class="f${o.wide ? " wide" : ""}">${label}${pre}<input type="number" step="${o.step || "any"}" min="${o.min ?? 0}" data-k="${k}" value="${esc(d[k])}"></div></label>`;
}
function selIn(label, k, d, opts) {
  return `<label class="f">${label}<select data-k="${k}">${opts.map(([v, t]) => `<option value="${v}"${String(d[k]) === String(v) ? " selected" : ""}>${t}</option>`).join("")}</select></label>`;
}
function stateSel(d) { return selIn("State", "st", d, Object.keys(FHFA).map((s) => [s, s])); }
function apprIn(d) {
  return selIn("Home value growth", "apprSrc", d, APPR_SRC) +
    `<label class="f" data-show="custom">Custom growth<div class="affix"><span>%</span><input type="number" step="0.25" min="-10" data-k="appr" value="${esc(d.appr)}"></div></label>`;
}
function segIn(k, d, vals, unit) {
  return `<div class="seg" data-seg="${k}" role="group">${vals.map((v) => `<button type="button" data-v="${v}" aria-pressed="${+d[k] === v}">${v} ${unit}</button>`).join("")}</div>`;
}
const hlBox = (k, v, s, cls = "") => `<div class="hl ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || ""}</div></div>`;

// Wire a calculator section: inputs live in .calc-in, results in .calc-out
function wireCalc(sec, data, compute, changed) {
  const sync = () => {
    sec.querySelectorAll("[data-show]").forEach((el) => {
      const [k, v] = el.dataset.show.includes("=") ? el.dataset.show.split("=") : ["apprSrc", el.dataset.show];
      el.hidden = String(data[k]) !== v;
    });
    sec.querySelectorAll("[data-seg]").forEach((g) => [...g.children].forEach((b) => b.setAttribute("aria-pressed", String(data[g.dataset.seg]) === b.dataset.v)));
  };
  sec.oninput = (e) => {
    const t = e.target, k = t.dataset.k; if (!k) return;
    const val = t.type === "checkbox" ? t.checked : t.tagName === "SELECT" || t.type === "text" ? t.value : (t.value === "" ? 0 : +t.value);
    if (t.dataset.row !== undefined) { data[t.dataset.list][+t.dataset.row][k] = val; compute(); changed(); return; }
    data[k] = val;
    if (k === "program") { data.mi = data.program === "va" ? 0 : 0.55; const mi = sec.querySelector('[data-k="mi"]'); if (mi) mi.value = data.mi; }
    sync(); compute(); changed();
  };
  sec.onclick = (e) => {
    const b = e.target.closest("[data-seg] button"); if (!b || document.body.classList.contains("readonly")) return;
    data[b.closest("[data-seg]").dataset.seg] = +b.dataset.v; sync(); compute(); changed();
  };
  sync(); compute();
}

/* ---------- Cost of waiting: purchase or refinance ---------- */
const COW = {
  label: "Cost of waiting", tag: "Cost of waiting",
  title: (d) => d.mode === "refi" ? "Refinance now, or wait for a lower rate?" : "What waiting to buy could cost",
  intro: (d) => d.mode === "refi"
    ? "Compares refinancing at today's rate with waiting for a lower one: what you give up while you wait, and how long the lower rate takes to make it back."
    : "If prices keep rising, waiting means paying more for the same home. This shows the higher price, payment and down payment, and the equity you'd build by buying now.",
  note: "Cost of waiting assumes home values grow at the rate shown each year and that property taxes grow with the home's value. Refinance figures compare principal and interest only and leave out closing costs, which you'd pay either way.",
  blank: (b) => ({ mode: "purchase", st: b.st || DEFAULT_STATE, apprSrc: DEFAULT_SRC, appr: 3,
    price: b.price || 450000, downPct: b.downPct ?? 5, rate: b.rate || 6.5, rateLater: b.rate || 6.5, term: 30,
    taxes: b.taxes ?? 5400, insurance: b.insurance ?? 1500, hoa: b.hoa || 0, mi: 0.55, months: 12, years: 5,
    curBal: 400000, curRate: 7.5, curYears: 28, newAmt: 400000, newTerm: 30, rateNow: b.rate || 6.25, rateHope: (b.rate || 6.25) - 0.5, wait: 12 }),
  mount(sec, d, changed) {
    const purchase = d.mode !== "refi";
    sec.innerHTML = `
      <div class="calc-head"><h2>${purchase ? "Buying now vs later" : "Refinancing now vs later"}</h2>
        <div class="seg staff-only" id="cowMode" role="group"><button type="button" data-m="purchase" aria-pressed="${purchase}">Purchase</button><button type="button" data-m="refi" aria-pressed="${!purchase}">Refinance</button></div></div>
      <div class="panel fields calc-in" id="cowIn">${purchase ? `
        ${numIn("Home price today", "price", d, { pre: "$", step: 1000 })}
        ${numIn("Down payment", "downPct", d, { suf: "%", step: 0.5 })}
        ${numIn("Rate today", "rate", d, { suf: "%", step: 0.125 })}
        ${numIn("Rate if you wait", "rateLater", d, { suf: "%", step: 0.125 })}
        ${selIn("Term", "term", d, [[30, "30 years"], [20, "20 years"], [15, "15 years"]])}
        ${numIn("Months you'd wait", "months", d, { step: 1 })}
        ${numIn("Property taxes / yr", "taxes", d, { pre: "$", step: 100 })}
        ${numIn("Home insurance / yr", "insurance", d, { pre: "$", step: 100 })}
        ${numIn("HOA dues / mo", "hoa", d, { pre: "$", step: 10 })}
        ${numIn("PMI rate / yr", "mi", d, { suf: "%", step: 0.05 })}
        ${stateSel(d)}${apprIn(d)}` : `
        ${numIn("Current loan balance", "curBal", d, { pre: "$", step: 1000 })}
        ${numIn("Current rate", "curRate", d, { suf: "%", step: 0.125 })}
        ${numIn("Years left on it", "curYears", d, { step: 1 })}
        ${numIn("New loan amount", "newAmt", d, { pre: "$", step: 1000 })}
        ${selIn("New term", "newTerm", d, [[30, "30 years"], [25, "25 years"], [20, "20 years"], [15, "15 years"]])}
        ${numIn("Rate available today", "rateNow", d, { suf: "%", step: 0.125 })}
        ${numIn("Rate you're hoping for", "rateHope", d, { suf: "%", step: 0.125 })}
        ${numIn("Months you'd wait for it", "wait", d, { step: 1 })}`}
      </div>
      <div class="results-head"><h2>${purchase ? `Waiting ${d.months} months` : `Waiting ${d.wait} months for ${pct(+d.rateHope || 0)}`}</h2>
        ${purchase ? `<div><span class="seg-label">Compare payments over</span>${segIn("years", d, [3, 5, 7, 10], "yrs")}</div>` : ""}</div>
      <div class="highlights" id="cowHl"></div>
      <div class="table-wrap"><table id="cowTable"></table></div>`;
    sec.querySelector("#cowMode").onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b || b.dataset.m === d.mode) return; d.mode = b.dataset.m; COW.mount(sec, d, changed); changed(); };
    const compute = () => {
      const h2 = sec.querySelector(".results-head h2");
      if (d.mode === "refi") {
        h2.textContent = `Waiting ${d.wait} months for ${pct(+d.rateHope || 0)}`;
        const cur = pmt(d.curBal, d.curRate, d.curYears), now = pmt(d.newAmt, d.rateNow, d.newTerm), later = pmt(d.newAmt, d.rateHope, d.newTerm);
        const sNow = cur - now, sLater = cur - later, cost = Math.max(0, sNow) * d.wait, gain = sLater - sNow;
        const back = gain > 0 ? Math.ceil(cost / gain) : null;
        sec.querySelector("#cowHl").innerHTML =
          hlBox("Cost of waiting", usd.format(cost), `${usd.format(Math.max(0, sNow))}/mo savings you'd skip for ${d.wait} months`) +
          hlBox("Time to make it back", back === null ? "Never" : back < 12 ? back + " months" : `${Math.floor(back / 12)} yr ${back % 12 ? (back % 12) + " mo" : ""}`, back === null ? "the hoped-for rate doesn't save more than today's" : `after the refinance, at ${usd.format(gain)}/mo extra savings`) +
          hlBox("Save by refinancing now", usd.format(sNow * 12), "per year, starting now") +
          hlBox("If rates don't drop", usd.format(Math.max(0, sNow) * 12), "lost for each year you wait");
        const row = (l, a, b, c, cls = "") => `<tr class="${cls}"><td>${l}</td><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;
        sec.querySelector("#cowTable").innerHTML = `<thead><tr><th></th><th>Current loan</th><th>Refinance now</th><th>Refinance in ${d.wait} months</th></tr></thead><tbody>
          ${row("Loan amount", usd.format(d.curBal), usd.format(d.newAmt), usd.format(d.newAmt))}
          ${row("Rate", pct(+d.curRate), pct(+d.rateNow), pct(+d.rateHope))}
          ${row("Term", d.curYears + " yrs left", d.newTerm + " yrs", d.newTerm + " yrs")}
          ${row("Principal &amp; interest", usd.format(cur), usd.format(now), usd.format(later), "strong")}
          ${row("Monthly savings", "–", usd.format(sNow), usd.format(sLater))}</tbody>`;
        return;
      }
      h2.textContent = `Waiting ${d.months} months`;
      const g = apprOf(d) / 100, m = +d.months || 0, dp = (+d.downPct || 0) / 100;
      const pLater = d.price * Math.pow(1 + g, m / 12);
      const side = (price, rate) => {
        const loan = price * (1 - dp), pi = pmt(loan, rate, d.term), mi = dp < 0.2 ? loan * d.mi / 1200 : 0;
        const tx = d.taxes * price / d.price / 12, rest = tx + d.insurance / 12 + (+d.hoa || 0);
        return { price, loan, pi, mi, rest, down: price * dp, total: pi + mi + rest };
      };
      const a = side(+d.price, +d.rate), b = side(pLater, +d.rateLater);
      const paid = a.loan - balAfter(a.loan, d.rate, d.term, m), rise = pLater - d.price;
      const extra = b.total - a.total;
      sec.querySelector("#cowHl").innerHTML =
        hlBox("Equity you'd give up", usd.format(rise + paid), `${usd.format(rise)} price growth + ${usd.format(paid)} loan paid down, by buying now`) +
        hlBox("Payment change", (extra >= 0 ? "+" : "−") + usd.format(Math.abs(extra)) + "/mo", `${usd.format(a.total)} now vs ${usd.format(b.total)} later`) +
        hlBox(`Extra paid over ${d.years} yrs`, usd.format(Math.max(0, extra) * 12 * d.years), "from the higher monthly payment") +
        hlBox("Extra down payment", usd.format(b.down - a.down), `${pct(+d.downPct, 2)} of a ${usd.format(pLater)} price`);
      const row = (l, f, cls = "") => `<tr class="${cls}"><td>${l}</td><td>${f(a)}</td><td>${f(b)}</td></tr>`;
      sec.querySelector("#cowTable").innerHTML = `<thead><tr><th></th><th>Buy now</th><th>Buy in ${m} months</th></tr></thead><tbody>
        ${row("Home price", (s) => usd.format(s.price))}
        ${row("Down payment", (s) => usd.format(s.down))}
        ${row("Loan amount", (s) => usd.format(s.loan))}
        ${row("Rate", (s) => pct(s === a ? +d.rate : +d.rateLater))}
        ${row("Principal &amp; interest", (s) => usd.format(s.pi))}
        ${row("Mortgage insurance", (s) => s.mi ? usd.format(s.mi) : "None")}
        ${row("Taxes, insurance, HOA", (s) => usd.format(s.rest))}
        ${row("Total monthly payment", (s) => usd.format(s.total), "strong")}
        <tr><td>Home value growth</td><td colspan="2">${apprLabel(d)}</td></tr></tbody>`;
    };
    wireCalc(sec, d, compute, changed);
  }
};

/* ---------- Rent vs buy ---------- */
const RVB = {
  label: "Rent vs buy", tag: "Rent vs buy",
  title: () => "Renting vs buying",
  intro: () => "Compares what you'd spend on rent with the real cost of owning: everything you pay, minus the equity you build as the loan is paid down and the home's value grows.",
  note: "Rent vs buy counts the down payment, closing costs, principal and interest, mortgage insurance, taxes, insurance, HOA and upkeep, minus home equity (estimated value less loan balance). Taxes, insurance and upkeep grow with the home's value. It leaves out selling costs, tax deductions, and investment returns on cash not used for the down payment.",
  blank: (b) => ({ st: b.st || DEFAULT_STATE, apprSrc: DEFAULT_SRC, appr: 3, rent: b.rent || 2400, rentGrowth: 3,
    price: b.price || 450000, downPct: b.downPct ?? 5, rate: b.rate || 6.5, term: 30, taxes: b.taxes ?? 5400, insurance: b.insurance ?? 1500,
    hoa: b.hoa || 0, mi: 0.55, closingPct: 3, maint: 1, years: 7 }),
  mount(sec, d, changed) {
    sec.innerHTML = `
      <div class="calc-head"><h2>Rent and home</h2></div>
      <div class="panel fields calc-in" id="rvbIn">
        ${numIn("Rent / mo", "rent", d, { pre: "$", step: 50 })}
        ${numIn("Rent increase / yr", "rentGrowth", d, { suf: "%", step: 0.5 })}
        ${numIn("Home price", "price", d, { pre: "$", step: 1000 })}
        ${numIn("Down payment", "downPct", d, { suf: "%", step: 0.5 })}
        ${numIn("Interest rate", "rate", d, { suf: "%", step: 0.125 })}
        ${selIn("Term", "term", d, [[30, "30 years"], [20, "20 years"], [15, "15 years"]])}
        ${numIn("Property taxes / yr", "taxes", d, { pre: "$", step: 100 })}
        ${numIn("Home insurance / yr", "insurance", d, { pre: "$", step: 100 })}
        ${numIn("HOA dues / mo", "hoa", d, { pre: "$", step: 10 })}
        ${numIn("PMI rate / yr", "mi", d, { suf: "%", step: 0.05 })}
        ${numIn("Closing costs", "closingPct", d, { suf: "% of price", step: 0.5 })}
        ${numIn("Upkeep / yr", "maint", d, { suf: "% of value", step: 0.25 })}
        ${stateSel(d)}${apprIn(d)}
      </div>
      <div class="results-head"><h2 id="rvbH">How they compare</h2><div><span class="seg-label">Stay in the home for</span>${segIn("years", d, [3, 5, 7, 10, 15, 30], "yrs")}</div></div>
      <div class="highlights" id="rvbHl"></div>
      <div class="table-wrap"><table id="rvbTable"></table></div>
      <div class="charts one"><div class="chart"><h3>Total cost over time</h3><p>Rent paid vs the cost of owning after equity. Where the lines cross, buying pulls ahead.</p><div id="rvbChart"></div>
        <div class="legend"><span><i style="background:var(--s4)"></i>Renting: rent paid</span><span><i style="background:var(--s2)"></i>Buying: cost after equity</span></div></div></div>`;
    const compute = () => {
      const g = apprOf(d) / 100, dp = (+d.downPct || 0) / 100, loan = d.price * (1 - dp), n = d.term * 12, r = d.rate / 1200;
      const pi = pmt(loan, d.rate, d.term), cash0 = d.price * dp + d.price * d.closingPct / 100;
      const rentCum = [0], ownNet = [cash0 - d.price * dp], value = [d.price], bal = [loan], first = {};
      let R = 0, O = cash0, b = loan;
      for (let m = 1; m <= MONTHS; m++) {
        const yr = Math.floor((m - 1) / 12), grow = Math.pow(1 + g, yr);
        const rentM = d.rent * Math.pow(1 + d.rentGrowth / 100, yr);
        let interest = 0, p = 0, mi = 0;
        if (m <= n && b > 0.005) { interest = b * r; p = Math.min(pi - interest, b); if (dp < 0.2 && b / d.price > 0.78) mi = loan * d.mi / 1200; b -= p; }
        const own = (m <= n ? pi : 0) + mi + (d.taxes / 12 + d.insurance / 12 + d.price * d.maint / 1200) * grow + (+d.hoa || 0);
        if (m === 1) Object.assign(first, { rent: rentM, own, pi, mi, rest: own - pi - mi });
        R += rentM; O += own;
        const v = d.price * Math.pow(1 + g, m / 12);
        rentCum.push(R); value.push(v); bal.push(b); ownNet.push(O - (v - b));
      }
      const h = d.years * 12, diff = rentCum[h] - ownNet[h];
      let be = null; for (let m = 1; m <= MONTHS; m++) if (ownNet[m] < rentCum[m]) { be = m; break; }
      const beTxt = be === null ? "Not within 30 yrs" : (be >= 12 ? Math.floor(be / 12) + " yr " : "") + (be % 12 ? (be % 12) + " mo" : "");
      sec.querySelector("#rvbH").textContent = `After ${d.years} years`;
      sec.querySelector("#rvbHl").innerHTML =
        hlBox(diff >= 0 ? "Buying comes out ahead" : "Renting comes out ahead", usd.format(Math.abs(diff)), `after ${d.years} years`, diff >= 0 ? "good" : "") +
        hlBox("Home equity", usd.format(value[h] - bal[h]), `home worth ${usd.format(value[h])}, loan ${usd.format(bal[h])}`) +
        hlBox("Monthly today", `${usd.format(first.own)} <span class="vs">vs ${usd.format(first.rent)}</span>`, "owning vs rent, first month") +
        hlBox("Buying pulls ahead", beTxt, "when owning's cost after equity drops below rent paid");
      const row = (l, a, b2, cls = "") => `<tr class="${cls}"><td>${l}</td><td>${a}</td><td>${b2}</td></tr>`;
      sec.querySelector("#rvbTable").innerHTML = `<thead><tr><th></th><th>Rent</th><th>Buy</th></tr></thead><tbody>
        <tr class="group"><td colspan="3">First month</td></tr>
        ${row("Rent", usd.format(first.rent), "–")}
        ${row("Principal &amp; interest", "–", usd.format(first.pi))}
        ${row("Mortgage insurance", "–", first.mi ? usd.format(first.mi) : "None")}
        ${row("Taxes, insurance, HOA, upkeep", "–", usd.format(first.rest))}
        ${row("Total per month", usd.format(first.rent), usd.format(first.own), "strong")}
        <tr class="group"><td colspan="3">Over ${d.years} years</td></tr>
        ${row("Cash up front", "–", `${usd.format(cash0)} <span class="est">down payment + closing</span>`)}
        ${row("Total paid", usd.format(rentCum[h]), usd.format(ownNet[h] + value[h] - bal[h]))}
        ${row("Home equity built", "–", usd.format(value[h] - bal[h]))}
        ${row("Cost after equity", usd.format(rentCum[h]), usd.format(ownNet[h]), "strong")}
        <tr><td>Home value growth</td><td colspan="2">${apprLabel(d)}</td></tr></tbody>`;
      lineChart(sec.querySelector("#rvbChart"), [{ color: "--s4", values: rentCum }, { color: "--s2", values: ownNet }], h);
    };
    wireCalc(sec, d, compute, changed);
  }
};

/* ---------- Affordability (math from the website calculator) with a rate ladder ---------- */
// Program rules: minimum down and how mortgage insurance applies (conventional MI drops at 80% LTV; FHA adds 1.75% upfront MIP)
const AFF_PROGRAMS = { conv: { minDown: 0.03, miUntilLtv: 0.80, upfront: 0 }, fha: { minDown: 0.035, miUntilLtv: 0, upfront: 0.0175 }, va: { minDown: 0, miUntilLtv: -1, upfront: 0 } };
function affSolve(d, rateOverride) {
  const prog = AFF_PROGRAMS[d.program] || AFF_PROGRAMS.conv;
  const rate = (rateOverride ?? d.rate) / 1200, n = Math.max(1, d.term) * 12;
  const dti = d.dti / 100, tax = d.taxRate / 100, ins = +d.ins || 0, hoa = +d.hoa || 0, miRate = d.mi / 100, down = +d.down || 0, debts = +d.debts || 0;
  const f = rate > 0 ? rate / (1 - Math.pow(1 + rate, -n)) : 1 / n;
  const budget = d.income / 12 * dti - debts - ins - hoa;
  const priceFor = (withMi) => { const k = (f + (withMi ? miRate / 12 : 0)) * (1 + prog.upfront); return (budget + down * k) / (k + tax / 12); };
  let price, hasMi = false;
  if (prog.miUntilLtv < 0) price = priceFor(false);
  else if (prog.miUntilLtv === 0) { price = priceFor(true); hasMi = true; }
  else { price = priceFor(false); if ((price - down) / price > prog.miUntilLtv) { price = priceFor(true); hasMi = true; } }
  if (prog.minDown > 0 && down < price * prog.minDown) price = down / prog.minDown;
  price = Math.max(0, price);
  const loan = Math.max(0, price - down) * (1 + prog.upfront);
  const pi = loan * f, tx = price * tax / 12, mi = hasMi ? loan * miRate / 12 : 0, total = pi + tx + ins + mi + hoa;
  return { price, loan, pi, tx, ins, mi, hoa, total, down, dtiOut: d.income > 0 ? (total + debts) / (d.income / 12) : 0, cc: price * d.cc / 100, pp: price * d.pp / 100 };
}
const AFF = {
  label: "Affordability", tag: "Affordability",
  title: () => "How much home you can afford",
  intro: () => "Starts from income, monthly debts and the cash you have for a down payment, and works out the price that keeps your total debt payments at the target share of income.",
  note: "Affordability uses the debt-to-income target shown. Conventional mortgage insurance applies above 80% loan-to-value; FHA adds a 1.75% upfront premium to the loan and annual MIP. Closing costs and prepaids are estimated as a percent of price.",
  blank: (b) => ({ income: 95000, debts: 500, down: b.price ? Math.round(b.price * (b.downPct ?? 5) / 100) : 25000, program: "conv", rate: b.rate || 6.5, term: 30,
    dti: 36, taxRate: b.price && b.taxes ? +(b.taxes / b.price * 100).toFixed(2) : 0.55, ins: b.insurance ? Math.round(b.insurance / 12) : 150, hoa: b.hoa || 0, mi: 0.55, cc: 3, pp: 1.5, realtor: "" }),
  mount(sec, d, changed) {
    sec.innerHTML = `
      <div class="calc-head"><h2>Income and savings</h2></div>
      <div class="panel fields calc-in" id="affIn">
        ${numIn("Annual income (before taxes)", "income", d, { pre: "$", step: 1000 })}
        ${numIn("Monthly debt payments", "debts", d, { pre: "$", step: 25 })}
        ${numIn("Cash for down payment", "down", d, { pre: "$", step: 1000 })}
        ${selIn("Loan program", "program", d, [["conv", "Conventional"], ["fha", "FHA"], ["va", "VA"]])}
        ${numIn("Interest rate", "rate", d, { suf: "%", step: 0.125 })}
        ${selIn("Term", "term", d, [[30, "30 years"], [20, "20 years"], [15, "15 years"]])}
        ${numIn("Target debt-to-income", "dti", d, { suf: "%", step: 1 })}
        ${numIn("Property tax rate", "taxRate", d, { suf: "% / yr", step: 0.05 })}
        ${numIn("Home insurance / mo", "ins", d, { pre: "$", step: 10 })}
        ${numIn("HOA dues / mo", "hoa", d, { pre: "$", step: 10 })}
        ${numIn("Mortgage insurance", "mi", d, { suf: "% / yr", step: 0.05 })}
        ${numIn("Closing costs", "cc", d, { suf: "% of price", step: 0.25 })}
        ${numIn("Prepaids &amp; escrows", "pp", d, { suf: "% of price", step: 0.25 })}
        <label class="f wide staff-only">Realtor partner shown on this tab (optional)<input type="text" data-k="realtor" value="${esc(d.realtor)}" placeholder="e.g. Jane Doe, Modern Real Estate"></label>
      </div>
      <div class="results-head"><h2>What you can afford</h2></div>
      <div class="highlights" id="affHl"></div>
      <div class="charts"><div class="chart"><h3>Monthly payment</h3><div id="affPay"></div></div>
        <div class="chart"><h3>Cash to close</h3><div id="affCash"></div></div></div>
      <div class="results-head"><h2>How the rate changes your price range</h2></div>
      <div class="table-wrap"><table id="affLadder"></table></div>
      <div class="cobrand-row" id="affCo"></div>`;
    const compute = () => {
      const s = affSolve(d), dtiTxt = d.dti <= 36 ? "Comfortable" : d.dti <= 43 ? "Stretch" : "Aggressive";
      sec.querySelector("#affHl").innerHTML =
        hlBox("Homes up to", usd.format(s.price), `<span class="pill ${d.dti <= 36 ? "" : "warn"}">${dtiTxt}</span> at ${pct(+d.dti, 1)} debt-to-income`, "good") +
        hlBox("Total monthly payment", usd.format(s.total), `at ${pct(+d.rate)}`) +
        hlBox("Estimated cash to close", usd.format(s.down + s.cc + s.pp), "down payment, closing costs, prepaids") +
        hlBox("Loan amount", usd.format(s.loan), s.price ? pct(s.down / s.price * 100, 1) + " down" : "");
      const rows = (list) => `<div class="rows">${list.map(([k, v, cls]) => `<div class="row ${cls || ""}"><span>${k}</span><span>${v}</span></div>`).join("")}</div>`;
      sec.querySelector("#affPay").innerHTML = rows([["Principal &amp; interest", usd.format(s.pi)], ["Property taxes", usd.format(s.tx)], ["Home insurance", usd.format(s.ins)], ["Mortgage insurance", usd.format(s.mi)], ["HOA dues", usd.format(s.hoa)], ["Total", usd.format(s.total), "total"], ["Debt-to-income with this home", pct(s.dtiOut * 100, 1)]]);
      sec.querySelector("#affCash").innerHTML = rows([["Down payment", usd.format(s.down)], ["Closing costs", usd.format(s.cc)], ["Prepaids &amp; escrows", usd.format(s.pp)], ["Estimated cash to close", usd.format(s.down + s.cc + s.pp), "total"]]);
      const base = +d.rate, steps = [-1, -0.5, 0, 0.5, 1].map((x) => +(base + x).toFixed(3)).filter((x) => x > 0);
      const lad = steps.map((r) => ({ r, s: affSolve(d, r) })), sameLoanPay = (r) => s.loan * (r > 0 ? (r / 1200) / (1 - Math.pow(1 + r / 1200, -d.term * 12)) : 1 / (d.term * 12));
      sec.querySelector("#affLadder").innerHTML = `<thead><tr><th>Rate</th>${lad.map((x) => `<th${x.r === base ? ' class="best"' : ""}>${pct(x.r)}</th>`).join("")}</tr></thead><tbody>
        <tr><td>Homes up to</td>${lad.map((x) => `<td class="${x.r === base ? "best" : ""}">${usd.format(x.s.price)}</td>`).join("")}</tr>
        <tr><td>Change vs ${pct(base)}</td>${lad.map((x) => `<td>${x.r === base ? "–" : (x.s.price >= s.price ? "+" : "−") + usd.format(Math.abs(x.s.price - s.price))}</td>`).join("")}</tr>
        <tr><td>P&amp;I on a ${usd.format(s.loan)} loan</td>${lad.map((x) => `<td>${usd.format(sameLoanPay(x.r))}</td>`).join("")}</tr></tbody>`;
      sec.querySelector("#affCo").innerHTML = d.realtor ? `<span class="sample">Prepared with</span> <b>${esc(d.realtor)}</b>` : "";
    };
    wireCalc(sec, d, compute, changed);
  }
};

/* ---------- Debt consolidation (refinance) with blended rate ---------- */
// Months and total interest to pay off `bal` at `ratePct` with a fixed monthly payment
function payoff(bal, ratePct, pay) {
  const r = ratePct / 1200; let b = bal, m = 0, int = 0;
  if (pay <= b * r) return { months: Infinity, interest: Infinity };
  while (b > 0.005 && m < 1200) { const i = b * r; int += i; b -= Math.min(pay - i, b); m++; }
  return { months: m, interest: int };
}
const yrsMo = (m) => !isFinite(m) ? "Never at this payment" : (m >= 12 ? Math.floor(m / 12) + " yr " : "") + (m % 12 ? (m % 12) + " mo" : "");
const DEBT = {
  label: "Debt consolidation", tag: "Debt consolidation",
  title: () => "Rolling debts into your mortgage",
  intro: () => "Shows what you pay each month today on your mortgage and the debts you'd pay off, what you'd pay after refinancing, and how the money you free up could pay the home off sooner or grow.",
  note: "Debt consolidation compares principal and interest plus the monthly payments on the debts being paid off. Taxes and insurance stay the same either way and are left out. Closing costs are added to the new loan. Payoff times use the rates and payments shown. Rolling short-term debt into a 30-year loan can cost more interest overall unless the savings go back toward the loan.",
  blank: (b) => ({ income: 0, value: b.price ? Math.round(b.price * 1.1) : 500000, mBal: 320000, mRate: 7.25, mYears: 27,
    rate: b.rate || 6.5, term: 30, cc: 6000, investRate: 6, years: 10, mode: "payoff",
    debts: [{ name: "Credit card", kind: "revolving", bal: 18000, rate: 24.9, pay: 540, payoff: true },
            { name: "Car loan", kind: "installment", bal: 22000, rate: 8.9, pay: 520, payoff: true },
            { name: "Personal loan", kind: "installment", bal: 9000, rate: 13.5, pay: 310, payoff: true }] }),
  mount(sec, d, changed) {
    const debtRows = () => d.debts.map((x, i) => `<tr>
        <td><input type="text" data-list="debts" data-row="${i}" data-k="name" value="${esc(x.name)}" aria-label="Debt name"></td>
        <td><select data-list="debts" data-row="${i}" data-k="kind" aria-label="Type">${[["revolving", "Card / revolving"], ["installment", "Installment"], ["other", "Other"]].map(([v, t]) => `<option value="${v}"${x.kind === v ? " selected" : ""}>${t}</option>`).join("")}</select></td>
        <td><div class="affix pre"><span>$</span><input type="number" min="0" step="100" data-list="debts" data-row="${i}" data-k="bal" value="${esc(x.bal)}" aria-label="Balance"></div></td>
        <td><div class="affix"><span>%</span><input type="number" min="0" step="0.25" data-list="debts" data-row="${i}" data-k="rate" value="${esc(x.rate)}" aria-label="Rate"></div></td>
        <td><div class="affix pre"><span>$</span><input type="number" min="0" step="10" data-list="debts" data-row="${i}" data-k="pay" value="${esc(x.pay)}" aria-label="Monthly payment"></div></td>
        <td class="c"><input type="checkbox" data-list="debts" data-row="${i}" data-k="payoff"${x.payoff ? " checked" : ""} aria-label="Pay off with the refinance"></td>
        <td class="staff-only"><button class="icon-btn" type="button" data-act="del" data-i="${i}" aria-label="Remove debt">×</button></td></tr>`).join("");
    sec.innerHTML = `
      <div class="calc-head"><h2>Debts</h2></div>
      <div class="panel calc-in" id="debtIn">
        <div class="table-wrap"><table class="debts" id="debtList"><thead><tr><th>Debt</th><th>Type</th><th>Balance</th><th>Rate</th><th>Payment / mo</th><th class="c">Pay off</th><th class="staff-only"></th></tr></thead>
          <tbody>${debtRows()}</tbody></table></div>
        <div class="actions staff-only"><button class="btn" type="button" data-act="add">+ Add a debt</button></div>
      </div>
      <div class="calc-head"><h2>Mortgage and new loan</h2></div>
      <div class="panel fields calc-in" id="debtLoan">
        ${numIn("Home value", "value", d, { pre: "$", step: 1000 })}
        ${numIn("Current mortgage balance", "mBal", d, { pre: "$", step: 1000 })}
        ${numIn("Current rate", "mRate", d, { suf: "%", step: 0.125 })}
        ${numIn("Years left on it", "mYears", d, { step: 1 })}
        ${numIn("New rate", "rate", d, { suf: "%", step: 0.125 })}
        ${selIn("New term", "term", d, [[30, "30 years"], [25, "25 years"], [20, "20 years"], [15, "15 years"]])}
        ${numIn("Closing costs (added to loan)", "cc", d, { pre: "$", step: 100 })}
        ${numIn("Monthly income (optional)", "income", d, { pre: "$", step: 100 })}
      </div>
      <div class="results-head"><h2>Before and after</h2></div>
      <div class="highlights" id="debtHl"></div>
      <div class="table-wrap"><table id="debtTable"></table></div>
      <div class="results-head"><h2>Put the savings to work</h2>
        <div class="seg" id="debtMode" role="group"><button type="button" data-m="payoff">Pay the home off sooner</button><button type="button" data-m="invest">Invest it</button></div></div>
      <div class="highlights" id="debtWork"></div>
      <div class="panel fields" id="debtInvest" data-show="mode=invest">
        ${numIn("Assumed return / yr", "investRate", d, { suf: "%", step: 0.5 })}
        <div><span class="seg-label">Over</span>${segIn("years", d, [5, 10, 15, 20], "yrs")}</div>
      </div>`;
    sec.querySelector("#debtIn").onclick = (e) => {
      const a = e.target.closest("[data-act]"); if (!a) return;
      if (a.dataset.act === "add") d.debts.push({ name: "New debt", kind: "revolving", bal: 0, rate: 0, pay: 0, payoff: true });
      else d.debts.splice(+a.dataset.i, 1);
      DEBT.mount(sec, d, changed); changed();
    };
    sec.querySelector("#debtMode").onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) return; d.mode = b.dataset.m; sync2(); compute(); changed(); };
    const sync2 = () => { [...sec.querySelector("#debtMode").children].forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === d.mode)); };
    const compute = () => {
      sync2();
      const paid = d.debts.filter((x) => x.payoff), kept = d.debts.filter((x) => !x.payoff);
      const sum = (l, f) => l.reduce((a, x) => a + (+f(x) || 0), 0);
      const debtBal = sum(paid, (x) => x.bal), debtPay = sum(paid, (x) => x.pay);
      const allBal = sum(d.debts, (x) => x.bal);
      const blendDebts = allBal ? sum(d.debts, (x) => x.bal * x.rate) / allBal : 0;
      const blendAll = (allBal + d.mBal) ? (sum(d.debts, (x) => x.bal * x.rate) + d.mBal * d.mRate) / (allBal + d.mBal) : 0;
      const mPI = pmt(d.mBal, d.mRate, d.mYears), loan = d.mBal + debtBal + (+d.cc || 0), newPI = pmt(loan, d.rate, d.term);
      const before = mPI + debtPay, save = before - newPI, ltv = d.value ? loan / d.value * 100 : 0;
      const keptPay = sum(kept, (x) => x.pay);
      const dtiB = d.income ? (before + keptPay) / d.income * 100 : null, dtiA = d.income ? (newPI + keptPay) / d.income * 100 : null;
      sec.querySelector("#debtHl").innerHTML =
        hlBox("Monthly savings", (save >= 0 ? "" : "−") + usd.format(Math.abs(save)), `${usd.format(before)} today vs ${usd.format(newPI)} after`, save >= 0 ? "good" : "") +
        hlBox("Blended rate today", pct(blendAll, 2), `mortgage and debts together · debts alone ${pct(blendDebts, 2)}`) +
        hlBox("New loan", usd.format(loan), `${pct(+d.rate)} · ${pct(ltv, 1)} of home value${ltv > 80 ? ' <span class="pill warn">over 80%</span>' : ""}`) +
        hlBox("Debts paid off", usd.format(debtBal), `${paid.length} of ${d.debts.length} debts`);
      const row = (l, a, b, cls = "") => `<tr class="${cls}"><td>${l}</td><td>${a}</td><td>${b}</td></tr>`;
      sec.querySelector("#debtTable").innerHTML = `<thead><tr><th></th><th>Today</th><th>After refinancing</th></tr></thead><tbody>
        ${row("Mortgage principal &amp; interest", `${usd.format(mPI)} <span class="est">${pct(+d.mRate)}</span>`, `${usd.format(newPI)} <span class="est">${pct(+d.rate)}, ${d.term} yrs</span>`)}
        ${paid.map((x) => row(esc(x.name), `${usd.format(x.pay)} <span class="est">${pct(+x.rate, 2)}</span>`, "Paid off")).join("")}
        ${row("Total monthly", usd.format(before), usd.format(newPI), "strong")}
        ${kept.length ? row("Debts you keep", usd.format(keptPay), usd.format(keptPay)) : ""}
        ${dtiB !== null ? row("Debt-to-income (before taxes, insurance)", pct(dtiB, 1), pct(dtiA, 1)) : ""}
        ${row("Balance owed", usd.format(d.mBal + debtBal), usd.format(loan))}</tbody>`;
      let work;
      if (d.mode === "invest") {
        const r = d.investRate / 1200, n = d.years * 12, fv = r ? Math.max(0, save) * (Math.pow(1 + r, n) - 1) / r : Math.max(0, save) * n;
        work = hlBox(`Invest ${usd.format(Math.max(0, save))}/mo for ${d.years} yrs`, usd.format(fv), `at ${pct(+d.investRate, 1)} a year, compounded monthly`, "good") +
          hlBox("You put in", usd.format(Math.max(0, save) * n), "") + hlBox("Growth", usd.format(fv - Math.max(0, save) * n), "");
      } else {
        const std = payoff(loan, d.rate, newPI), fast = payoff(loan, d.rate, Math.max(newPI, before));
        work = hlBox("Paid off in", yrsMo(fast.months), `by paying today's ${usd.format(before)} a month instead of ${usd.format(newPI)}`, "good") +
          hlBox("Time saved", yrsMo(std.months - fast.months), `vs ${d.term} years`) +
          hlBox("Interest saved", usd.format(std.interest - fast.interest), `on the new loan`);
      }
      sec.querySelector("#debtWork").innerHTML = work;
      sec.querySelector("#debtInvest").hidden = d.mode !== "invest";
    };
    wireCalc(sec, d, compute, changed);
  }
};

/* ---------- Extra payments (amortization) ---------- */
const AMORT = {
  label: "Extra payments", tag: "Extra payments",
  title: () => "Paying your loan off faster",
  intro: () => "Shows how an extra amount each month, or a one-time payment, shortens the loan and cuts the interest you pay.",
  note: "Extra payments are applied to principal in the month paid. Figures cover principal and interest only and assume the rate stays the same for the life of the loan.",
  blank: (b) => ({ loan: b.price ? Math.round(b.price * (1 - (b.downPct ?? 10) / 100)) : 400000, rate: b.rate || 6.5, term: 30, extra: 200, lump: 0, lumpYear: 5, yearly: 0, schedule: false }),
  mount(sec, d, changed) {
    sec.innerHTML = `
      <div class="calc-head"><h2>Loan and extra payments</h2></div>
      <div class="panel fields calc-in" id="amIn">
        ${numIn("Loan amount", "loan", d, { pre: "$", step: 1000 })}
        ${numIn("Interest rate", "rate", d, { suf: "%", step: 0.125 })}
        ${selIn("Term", "term", d, [[30, "30 years"], [25, "25 years"], [20, "20 years"], [15, "15 years"], [10, "10 years"]])}
        ${numIn("Extra each month", "extra", d, { pre: "$", step: 25 })}
        ${numIn("Extra once a year", "yearly", d, { pre: "$", step: 100 })}
        ${numIn("One-time payment", "lump", d, { pre: "$", step: 1000 })}
        ${numIn("…paid in year", "lumpYear", d, { step: 1, min: 1 })}
      </div>
      <div class="results-head"><h2>With your extra payments</h2></div>
      <div class="highlights" id="amHl"></div>
      <div class="charts one"><div class="chart"><h3>Loan balance</h3><p>Without and with extra payments.</p><div id="amChart"></div>
        <div class="legend"><span><i style="background:var(--s3)"></i>Regular payments</span><span><i style="background:var(--s2)"></i>With extra payments</span></div></div></div>
      <div class="results-head"><h2>Year by year</h2></div>
      <div class="table-wrap"><table id="amTable"></table></div>`;
    const run = (withExtra) => {
      const r = d.rate / 1200, n = d.term * 12, p = pmt(d.loan, d.rate, d.term), bal = [d.loan], years = [];
      let b = d.loan, int = 0, yr = { int: 0, prin: 0, extra: 0 }, months = 0;
      for (let m = 1; m <= MONTHS; m++) {
        if (m <= n && b > 0.005) {
          const i = b * r, reg = Math.min(p - i, b); b -= reg; int += i; yr.int += i; yr.prin += reg; months = m;
          if (withExtra) {
            let x = +d.extra || 0; if (m % 12 === 0) x += +d.yearly || 0; if (m === Math.max(1, d.lumpYear) * 12 - 11) x += +d.lump || 0;
            x = Math.min(x, b); b -= x; yr.extra += x;
          }
        }
        bal.push(b);
        if (m % 12 === 0) { years.push({ ...yr, bal: b }); yr = { int: 0, prin: 0, extra: 0 }; }
      }
      return { p, bal, int, months, years };
    };
    const compute = () => {
      const a = run(false), b = run(true), saved = a.months - b.months;
      sec.querySelector("#amHl").innerHTML =
        hlBox("Paid off in", yrsMo(b.months), `instead of ${yrsMo(a.months)}`, "good") +
        hlBox("Interest saved", usd.format(a.int - b.int), `${usd.format(b.int)} total instead of ${usd.format(a.int)}`, "good") +
        hlBox("Time saved", saved > 0 ? yrsMo(saved) : "None", "") +
        hlBox("Regular payment", usd.format(a.p), `principal and interest${+d.extra ? `, plus ${usd.format(+d.extra)} extra` : ""}`);
      lineChart(sec.querySelector("#amChart"), [{ color: "--s3", values: a.bal }, { color: "--s2", values: b.bal }], Math.min(b.months, MONTHS));
      const ys = b.years.filter((y, i) => i < d.term && (y.prin + y.extra > 0.5 || i === 0));
      sec.querySelector("#amTable").innerHTML = `<thead><tr><th>Year</th><th>Principal</th><th>Extra</th><th>Interest</th><th>Balance</th><th>Balance without extra</th></tr></thead><tbody>` +
        ys.map((y, i) => `<tr><td>${i + 1}</td><td>${usd.format(y.prin)}</td><td>${usd.format(y.extra)}</td><td>${usd.format(y.int)}</td><td>${usd.format(y.bal)}</td><td>${usd.format(a.years[i].bal)}</td></tr>`).join("") + `</tbody>`;
    };
    wireCalc(sec, d, compute, changed);
  }
};

const CALCS = { cow: COW, rvb: RVB, aff: AFF, debt: DEBT, amort: AMORT };
// Shown as bubbles. Calculators without a module yet show as "coming soon".
const BUBBLES = [["compare", "Loan comparison"], ["cow", "Cost of waiting"], ["rvb", "Rent vs buy"], ["aff", "Affordability"],
  ["debt", "Debt consolidation"], ["amort", "Extra payments"], ["arm", "ARM vs fixed"], ["equity", "Equity & appreciation"], ["invest", "Investment property"]];
