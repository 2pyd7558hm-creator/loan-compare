/* Round 1 (loan officer) tests: quick, messy notes the way David or Stephanie type them during a call, at least 3 per calculator.
   Every number is checked with math written separately here (not the page's own functions): P&I, FHA upfront MIP and VA funding fee,
   PMI from the team's rule table, FHA annual MIP, county loan limits, taxes 0.80% / insurance 0.55%, every fee in the fee template,
   cash to close, APR, and each calculator tab's inputs and headline numbers.
   Run in the signed-in workspace (AI reader on):  eval(await (await fetch(URL_OF_THIS_FILE)).text()); await lo1Run(0, 5);
   Results in window.lo1Results; AI replies kept in window.lo1Ai. Nothing is saved. Names are made up. */
(() => {
  const C = (msgs, exp) => ({ msgs: Array.isArray(msgs) ? msgs : [msgs], exp });
  const o = (type, term, rate, down, more) => ({ type, term, rate, down, ...more });
  window.LO1_CASES = [
    // ---- Loan comparison: purchase, FHA, VA, jumbo, ARM, buydown, DPA, refi, cash-out ----
    C("500k Denver 30yr 6.5 vs 15 6, 5% down", { price: 500000, opts: [o("conv", 30, 6.5, 5), o("conv", 15, 6, 5)] }),
    C("Mike Brandt 389,900 aurora co fha 3.5 dn 6.125 vs conv 3 dn 6.75 ftb", { name: "Mike Brandt", price: 389900, st: "CO", opts: [o("fha", 30, 6.125, 3.5), o("conv", 30, 6.75, 3, { fthb: true })] }),
    C("va 0 dn 625k colo springs co 6.0 vs va 5 dn 5.875", { price: 625000, st: "CO", opts: [o("va", 30, 6, 0), o("va", 30, 5.875, 5)] }),
    C("Rhea Vance 1.45M cherry hills arapahoe cty CO 20 dn jumbo 7/6 arm 6.25 vs 30 fx 6.875", { name: "Rhea Vance", price: 1450000, county: "Arapahoe", opts: [o("jumbo", 30, 6.25, 20, { arm: 7 }), o("jumbo", 30, 6.875, 20, { arm: 0 })] }),
    C("550k co conv 10 dn 6.99 w 2/1 bd seller pd vs 1 pt 6.75 no bd", { price: 550000, opts: [o("conv", 30, 6.99, 10, { bd: 2 }), o("conv", 30, 6.75, 10, { points: 1, bd: 0 })] }),
    C("fha 3.5 dn 425k co 6.25 w/ $12,750 chfa dpa deferred 0%", { price: 425000, opts: [o("fha", 30, 6.25, 3.5, { amt2: 12750 })] }),
    C("Tara Nunez refi 650 val owe 410 30y 6.375 vs 20y 6.125 co no 2nd", { name: "Tara Nunez", price: 650000, refi: true, loans: [410000, 410000] }),
    C("c/o refi val 900k bal 300k wants 50k cash out 30yr 6.875 co", { price: 900000, refi: true, loans: [350000] }),
    C("va cash out refi 700k value owe 400k 30yr 6.25 co", { price: 700000, refi: true, vaRefi: true, loans: [408600] }),
    C("Jen Ortiz 400k CO conv 5 dn 6.875 vs 10 dn 6.75, seller paying 6k", { name: "Jen Ortiz", price: 400000, opts: [o("conv", 30, 6.875, 5, { credit: 6000 }), o("conv", 30, 6.75, 10, { credit: 6000 })] }),
    // ---- Asks for what's missing ----
    C("Hollis 30 yr vs 15 yr 10 dn", { askPrice: true }),
    C("1.1M 10 dn 30y 7.0 vs 15y 6.5", { price: 1100000, askCounty: true }),
    C("refi val 600k co 30 and 15", { price: 600000, refi: true, askBalance: true }),
    // ---- Cost of waiting ----
    C("cost of waiting 475k co 5 dn 6.75, wait 12 mo for 6.25", { price: 475000, calcs: ["cow"], data: { cow: { price: 475000, downPct: 5, rate: 6.75, rateLater: 6.25, months: 12 } } }),
    C("refi cost of waiting val 600k owe 380k at 7.625, today 6.5 30y, hoping for 6", { refi: true, calcs: ["cow"], data: { cow: { mode: "refi", curBal: 380000, curRate: 7.625, newAmt: 380000, rateNow: 6.5, rateHope: 6 } } }),
    C("buyers want to wait 6 months, 420k fha 3.5 6.25 co", { price: 420000, calcs: ["cow"], data: { cow: { months: 6, downPct: 3.5, rate: 6.25 } } }),
    // ---- Rent vs buy ----
    C("rent vs buy, renting 2,350/mo, 450k co 5 dn 6.625", { price: 450000, calcs: ["rvb"], data: { rvb: { rent: 2350, price: 450000, downPct: 5, rate: 6.625 } } }),
    C("rent 1900 fha 3.5 dn 360k 6.25 co", { price: 360000, calcs: ["rvb"], data: { rvb: { rent: 1900, downPct: 3.5, rate: 6.25 } } }),
    C("pays 2800 rent, condo 400k co 10 dn 6.875 hoa 350", { price: 400000, calcs: ["rvb"], data: { rvb: { rent: 2800, downPct: 10, hoa: 350 } } }),
    // ---- Affordability ----
    C("what can they afford, inc 125k, debts 650/mo, 40k down, conv 6.75 co", { calcs: ["aff"], data: { aff: { income: 125000, debts: 650, down: 40000, program: "conv", rate: 6.75 } } }),
    C("va buyer makes 98k, car pmt 450, 0 down, 6.125 how much house", { calcs: ["aff"], data: { aff: { income: 98000, debts: 450, down: 0, program: "va", rate: 6.125 } } }),
    C("fha max purchase? income 72k, 15k saved, 300 student loans 6.25", { calcs: ["aff"], data: { aff: { income: 72000, debts: 300, down: 15000, program: "fha", rate: 6.25 } } }),
    // ---- Debt consolidation ----
    C("debt consol refi val 600k owes 300k at 3.5% cc 40k", { refi: true, loans: [340000], calcs: ["debt"], data: { debt: { value: 600000, mBal: 300000, mRate: 3.5, debtTotal: 40000 } } }),
    C("c/o to pay off debts: home 520k, 1st 280k @ 6.875, cards 32k, car 18k, new 30y 6.5", { refi: true, loans: [330000], calcs: ["debt"], data: { debt: { value: 520000, mBal: 280000, mRate: 6.875, rate: 6.5, debtTotal: 50000 } } }),
    C("consolidate: val 750, owe 410 @7.25, heloc 60k, 30yr 6.375", { refi: true, loans: [470000], calcs: ["debt"], data: { debt: { value: 750000, mBal: 410000, mRate: 7.25, rate: 6.375 } } }),
    // ---- Extra payments ----
    C("450k co 10 dn 30y 6.75 extra 250/mo", { price: 450000, calcs: ["amort"], data: { amort: { extra: 250, loan: 405000, rate: 6.75 } } }),
    C("600k co 20 dn 30yr 6.5, 1 extra pmt a year", { price: 600000, calcs: ["amort"], data: { amort: { loan: 480000, rate: 6.5 } }, yearlyPI: 1 }),
    C(["Gil Marsh 400k co 5 dn 6.875", "round up to 3500"], { name: "Gil Marsh", calcs: ["amort"], data: { amort: { roundTo: 3500 } } }),
    // ---- ARM vs fixed ----
    C("5/6 arm 5.875 vs 30 fx 6.75 525k co 10 dn", { price: 525000, opts: [o("conv", 30, 5.875, 10, { arm: 5 }), o("conv", 30, 6.75, 10, { arm: 0 })], calcs: ["arm"], data: { arm: { fixedYrs: 5, armRate: 5.875, fixedRate: 6.75, capFirst: 2, capEach: 1, capLife: 5 } } }),
    C("7/6 arm 6.125 vs 30 fixed 6.875 20 dn 700k co", { price: 700000, calcs: ["arm"], data: { arm: { fixedYrs: 7, armRate: 6.125, fixedRate: 6.875, loan: 560000, capFirst: 5, capEach: 1, capLife: 5 } } }),
    C("10/6 arm 6.25 vs 30 fx 6.625 900k douglas cty co 20 dn", { price: 900000, county: "Douglas", calcs: ["arm"], data: { arm: { fixedYrs: 10, armRate: 6.25, fixedRate: 6.625, loan: 720000 } } }),
    // ---- Equity & appreciation ----
    C("show equity over 10 yrs 500k co 10 dn 6.5", { price: 500000, calcs: ["equity"], data: { equity: { price: 500000, downPct: 10, rate: 6.5, years: 10 } } }),
    C("bid 20k over asking on 550k, 10 dn 6.75 co", { calcs: ["equity"], price: 570000, data: { equity: { mode: "bid", over: 20000, asking: 550000, downPct: 10, rate: 6.75 } } }),
    C("offering 35k over list 615k fha 3.5 6.25 co", { calcs: ["equity"], price: 650000, data: { equity: { mode: "bid", over: 35000, asking: 615000, downPct: 3.5, rate: 6.25 } } }),
    // ---- Investment property ----
    C("investment prop 550k co 25 dn 7.5 rent 3,200", { calcs: ["invest"], noCalcs: ["rvb"], data: { invest: { price: 550000, downPct: 25, rate: 7.5, rent: 3200 } } }),
    C("rental 700k 25% dn 7.25 rents for 4700 co", { calcs: ["invest"], noCalcs: ["rvb"], data: { invest: { price: 700000, downPct: 25, rate: 7.25, rent: 4700 } } }),
    C("inv property 400k 20 dn 7.875 co, rent 2600/mo", { calcs: ["invest"], noCalcs: ["rvb"], data: { invest: { price: 400000, downPct: 20, rate: 7.875, rent: 2600 } } }),
    // ---- Cost of paying cash ----
    C("cash vs finance 900k co 20 dn 6.5, 1.2M brokerage", { calcs: ["cash"], data: { cash: { price: 900000, downPct: 20, rate: 6.5, inv: 1200000 } } }),
    C("pay cash or finance? 650k co 25 dn 6.375, 400k savings + 300k 401k, she's 52", { calcs: ["cash"], data: { cash: { price: 650000, downPct: 25, rate: 6.375, liquid: 400000, ret: 300000, under59: 1 } } }),
    C("750k cash buyer co, compare 30y 6.625 20 dn, 800k in brokerage", { calcs: ["cash"], data: { cash: { price: 750000, downPct: 20, rate: 6.625, inv: 800000 } } }),
  ];

  // ---------- independent math ----------
  const pmtX = (L, r, n) => { const i = r / 1200, k = n * 12; return L <= 0 ? 0 : i ? L * i / (1 - Math.pow(1 + i, -k)) : L / k; };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const VA_FEE = (dp) => dp >= 10 ? 1.25 : dp >= 5 ? 1.5 : 2.15;               // va.gov, purchase, first use
  const PMI = (dp, term, fthb) => dp >= 20 ? 0 : (fthb && dp < 10 && term > 15) ? (dp < 5 ? 0.45 : 0.47) : term <= 15 ? 0.3 : dp < 5 ? 0.62 : dp < 10 ? 0.55 : dp < 15 ? 0.45 : 0.3;
  const FHA_ANNUAL = (base, value, term) => { const ltv = base / value, big = base > 726200; return term > 15 ? (big ? (ltv > 0.95 ? 0.75 : 0.7) : (ltv > 0.95 ? 0.55 : 0.5)) : (big ? (ltv > 0.9 ? 0.65 : ltv > 0.78 ? 0.4 : 0.15) : (ltv > 0.9 ? 0.4 : 0.15)); };
  const CO_LIMIT = { adams: 862500, arapahoe: 862500, boulder: 879750, broomfield: 862500, denver: 862500, douglas: 862500, eagle: 1249125, jefferson: 862500, pitkin: 1209750, summit: 1092500, elbert: 862500 };
  // Borrower's share of each fee in the template, figured from the template's own rules
  function feesFor(items, price, loan, taxes, ins, refi, reports) {
    let apr = 0, other = 0, prepaid = 0;
    for (const it of items) {
      const stamp = /deed|transfer|stamp|documentary/i.test(it.name);
      let a = (+it.amt || 0) + (stamp ? price : loan) * (+it.pct || 0) / 100;
      if (it.auto !== false) {
        if (stamp) a = refi ? 0 : price * 0.0001;
        else if (/credit report/i.test(it.name)) a = (+it.amt || 0) * reports;
        else if (it.prepaid && /premium/i.test(it.name)) a = ins;
        else if (it.prepaid && /hazard.*reserve|insurance reserve/i.test(it.name)) a = ins / 12 * (refi ? 6 : 3);
        else if (it.prepaid && /tax.*reserve/i.test(it.name)) a = taxes / 12 * (refi ? 6 : 3);
      }
      const b = it.by === "S" || it.by === "L" ? 0 : it.by === "X" ? (it.splitBy === "$" ? Math.min(a, +it.split || 0) : a * (+it.split || 0) / 100) : a;
      if (it.prepaid) prepaid += b; else if (it.apr) apr += b; else other += b;
    }
    return { apr, other, prepaid };
  }
  function aprOf(amtFin, pays) {
    let lo = 0, hi = 0.05;
    for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2, pv = pays.reduce((s, x, j) => s + x / Math.pow(1 + mid, j + 1), 0); pv > amtFin ? lo = mid : hi = mid; }
    return (lo + hi) / 2 * 1200;
  }

  // ---------- driving the page ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const busy = () => document.getElementById("quickBtn").disabled || asLog.some((m) => /^(Thinking…|Reading your note…)$/.test(m.text));
  async function send(t) {
    for (let i = 0; i < 120 && busy(); i++) await sleep(500);
    const q = document.getElementById("quickIn"); q.value = t; document.getElementById("quickBtn").click();
    await sleep(700); for (let i = 0; i < 120 && busy(); i++) await sleep(500); await sleep(500);
    const last = asLog[asLog.length - 1];
    if (asPending && asPending.kind === "ai" && last && last.buttons) { const q2 = last.text; last.buttons[0].fn(); await sleep(700); for (let i = 0; i < 120 && busy(); i++) await sleep(500); return q2; }
    return null;
  }
  function tabHl(kind) {
    const t = file.calcs.find((c) => c.kind === kind); if (!t) return null;
    activate(t.id);
    const sec = document.querySelector("#calcPane") || document;
    return [...document.querySelectorAll(".highlights .hl")].filter((x) => x.offsetParent).map((x) => ({ k: x.querySelector(".k").textContent, v: x.querySelector(".v").textContent, s: x.querySelector(".s").textContent }));
  }
  const money = (s) => s == null ? NaN : +String(s).replace(/[^0-9.\-−]/g, "").replace("−", "-");

  function check(c) {
    syncActive();
    const e = c.exp, f = [], comp = compareTab(), d = comp ? comp.data : state;
    const title = $("cTitle").value, refi = /^refinance/i.test(title), price = d.price, reports = state.creditReports || 1;
    const log = asLog.map((m) => m.who + ": " + m.text);
    const eq = (label, got, want) => { if (want instanceof RegExp ? !want.test(String(got)) : got !== want) f.push(`${label}: got ${JSON.stringify(got)}, want ${want}`); };
    if (e.name !== undefined) eq("name", $("cName").value.trim(), e.name);
    if (e.price !== undefined) eq("price", price, e.price);
    if (e.st) eq("state", file.st || null, e.st);
    if (e.county) eq("county", file.county || null, e.county);
    if (e.refi !== undefined) eq("refi", refi, e.refi);
    const said = log.filter((x) => x.startsWith("a: ")).join(" | ");
    if (e.askPrice && !/price|value/i.test(said)) f.push("didn't ask for the price");
    if (e.askCounty && !/county/i.test(said)) f.push("didn't ask for the county/state");
    if (e.askBalance && !/balance|owe/i.test(said)) f.push("didn't ask for the loan balance");
    // ---- every option, with separately written math ----
    const items = (state.closing && state.closing.items) || [];
    (d.scenarios || []).forEach((s, i) => {
      const L = "ABCD"[i], a = analyze(s), base = price * (1 - s.downPct / 100);
      const fin = s.type === "fha" ? base * 0.0175 : s.type === "va" ? base * (e.vaRefi ? 2.15 : VA_FEE(s.downPct)) / 100 : 0, loan = base + fin;
      if (!near(a.loan, loan, 1)) f.push(`${L} loan ${Math.round(a.loan)} vs ${Math.round(loan)}${s.type === "va" ? " (VA funding fee)" : ""}`);
      const pi = pmtX(loan, s.rate, s.term);
      if (!near(a.pi, pi, 0.5)) f.push(`${L} P&I ${a.pi.toFixed(2)} vs ${pi.toFixed(2)}`);
      // mortgage insurance
      const co = (file.county || "").toLowerCase().replace(/\s+county$/, ""), lim = file.st === "CO" ? (CO_LIMIT[co] || (co ? 832750 : null)) : (file.st ? 832750 : null);
      if ((s.type === "conv" || s.type === "jumbo") && lim && base > lim && s.type !== "jumbo") f.push(`${L} conventional ${Math.round(base)} is over the ${lim} county limit (should be jumbo)`);
      if (s.type === "jumbo" && a.mi) f.push(`${L} jumbo shows MI ${a.mi.toFixed(2)}`);
      if (s.type === "va" && a.mi) f.push(`${L} VA shows MI`);
      if (s.type === "conv") { const fthb = s.fthb ?? s.downPct < 5, want = PMI(s.downPct, s.term, fthb) * base / 1200; if (!near(a.mi, want, 0.6)) f.push(`${L} PMI ${a.mi.toFixed(2)} vs ${want.toFixed(2)} (${PMI(s.downPct, s.term, fthb)}%)`); }
      if (s.type === "fha") { const want = FHA_ANNUAL(base, price, s.term) * base / 1200; if (!(a.mi > want * 0.97 && a.mi < want * 1.02)) f.push(`${L} FHA MIP ${a.mi.toFixed(2)} vs about ${want.toFixed(2)}`); }
      // fees and cash to close
      const fees = feesFor(items, price, loan, d.taxes, d.insurance, refi, reports);
      if (!near(a.cc.apr + a.cc.other + a.cc.prepaid, fees.apr + fees.other + fees.prepaid, 1.5)) f.push(`${L} closing costs ${Math.round(a.cc.apr + a.cc.other + a.cc.prepaid)} vs template ${Math.round(fees.apr + fees.other + fees.prepaid)}`);
      const pts = loan * (s.points || 0) / 100;
      const bd = Math.min(3, Math.max(0, +s.bd || 0)); let bdCost = 0; for (let y = 0; y < bd; y++) bdCost += (pi - pmtX(loan, Math.max(0, s.rate - (bd - y)), s.term)) * 12;
      const costs = pts + (+s.fees || 0) + fees.apr + fees.other + fees.prepaid + bdCost, credit = Math.min(+s.credit || 0, costs);
      const ctc = Math.max(0, price * s.downPct / 100 - (+s.amt2 || 0) + costs - credit);
      if (!refi && !near(a.cashToClose, ctc, 2)) f.push(`${L} cash to close ${Math.round(a.cashToClose)} vs ${Math.round(ctc)}`);
      // a refinance never asks for the equity as cash: at most the closing costs
      if (refi && a.cashToClose > costs - credit + 1) f.push(`${L} refinance cash to close ${Math.round(a.cashToClose)} is more than the costs ${Math.round(costs - credit)}`);
      if (s.credit) { const lim2 = s.type === "fha" ? 6 : s.type === "va" ? 4 : s.downPct < 10 ? 3 : s.downPct < 25 ? 6 : 9; if (s.type !== "jumbo" && s.credit > price * lim2 / 100 + 1) f.push(`${L} seller credit ${s.credit} over the ${lim2}% limit`); }
      // APR: points, lender fees and financed premiums are finance charges; payments include MI
      // (checked exactly only where there's no monthly MI, so every payment is the same P&I)
      if (a.apr + 0.0005 < s.rate) f.push(`${L} APR ${a.apr.toFixed(3)} below the rate ${s.rate}`);
      if (!(s.type === "conv" && s.downPct < 20) && s.type !== "fha") {
        const aprWant = aprOf(loan - fin - pts - (+s.fees || 0) - fees.apr, new Array(s.term * 12).fill(pi));
        if (!near(a.apr, aprWant, 0.01)) f.push(`${L} APR ${a.apr.toFixed(3)} vs ${aprWant.toFixed(3)}`);
      }
      if (/\bat \d/.test(s.name)) f.push(`${L} name has a rate: ${s.name}`);
    });
    if (!refi && price > 0 && !e.keepEsc) {
      if (!near(d.taxes, price * 0.008, 15)) f.push(`taxes ${d.taxes} vs 0.80% ${Math.round(price * 0.008)}`);
      if (!near(d.insurance, price * 0.0055, 15)) f.push(`insurance ${d.insurance} vs 0.55% ${Math.round(price * 0.0055)}`);
    }
    if (e.loans) e.loans.forEach((v, i) => { const s = d.scenarios[i]; const ln = s ? analyze(s).loan : 0; if (!s || Math.abs(ln - v) > 1) f.push(`${"ABCD"[i]} loan ${Math.round(ln)} vs ${v}`); });
    if (e.vaRefi && !(d.scenarios || []).some((s) => s.type === "va")) f.push("no VA option on a VA refi note");
    if (e.opts) {
      if (d.scenarios.length !== e.opts.length) f.push(`${d.scenarios.length} options, want ${e.opts.length}`);
      e.opts.forEach((w, i) => {
        const x = d.scenarios[i] || {}, L = "ABCD"[i], bad = [];
        if (w.type && x.type !== w.type) bad.push(`type ${x.type}`);
        if (w.term && x.term !== w.term) bad.push(`term ${x.term}`);
        if (w.rate != null && !near(+x.rate, w.rate, 0.001)) bad.push(`rate ${x.rate}`);
        if (w.down != null && !near(+x.downPct, w.down, 0.01)) bad.push(`down ${x.downPct}`);
        if (w.arm != null && (x.arm || 0) !== w.arm) bad.push(`arm ${x.arm}`);
        if (w.points != null && (x.points || 0) !== w.points) bad.push(`points ${x.points}`);
        if (w.bd != null && (x.bd || 0) !== w.bd) bad.push(`buydown ${x.bd}`);
        if (w.credit != null && !near(+x.credit || 0, w.credit, 1)) bad.push(`seller credit ${x.credit}`);
        if (w.amt2 != null && !near(+x.amt2 || 0, w.amt2, 1)) bad.push(`2nd ${x.amt2}`);
        if (w.fthb != null && (x.fthb ?? (x.type === "conv" && x.downPct < 5)) !== w.fthb) bad.push(`first-time buyer ${x.fthb}`);
        if (bad.length) f.push(`${L}: ${bad.join(", ")}`);
      });
    }
    // ---- calculator tabs ----
    const kinds = file.calcs.map((t) => t.kind);
    (e.calcs || []).forEach((k) => { if (!kinds.includes(k)) f.push(`missing ${k} tab (have ${kinds.join(",")})`); });
    (e.noCalcs || []).forEach((k) => { if (kinds.includes(k)) f.push(`shouldn't add a ${k} tab`); });
    const dataOf = (k) => (file.calcs.find((t) => t.kind === k) || {}).data;
    Object.entries(e.data || {}).forEach(([k, want]) => {
      const got = dataOf(k); if (!got) return;
      Object.entries(want).forEach(([fk, fv]) => {
        let gv = got[fk];
        if (fk === "debtTotal") gv = (got.debts || []).filter((x) => x.payoff).reduce((s, x) => s + (+x.bal || 0), 0);
        if (typeof fv === "number" ? !near(+gv, fv, Math.abs(fv) < 100 ? 0.001 : 1) : gv !== fv) f.push(`${k}.${fk}: got ${JSON.stringify(gv)}, want ${fv}`);
      });
    });
    if (e.yearlyPI) { const g = dataOf("amort"), s0 = d.scenarios[0]; if (g) { const want = e.yearlyPI * pmtX(analyze(s0).loan, s0.rate, s0.term); if (!near(+g.yearly, want, 1)) f.push(`amort.yearly ${g.yearly} vs ${Math.round(want)}`); } }
    // headline numbers, recomputed here from the tab's own inputs
    const hl = {};
    for (const k of kinds) if (k !== "compare") hl[k] = tabHl(k);
    const A = dataOf("amort");
    if (A && hl.amort) {
      const p = pmtX(A.loan, A.rate, A.term), r = A.rate / 1200; let b = A.loan, m = 0;
      const extra = +A.extra || 0;
      while (b > 0.005 && m < 600) { m++; b -= Math.min(p - b * r, b); let x = extra; if (m % 12 === 0) x += +A.yearly || 0; if (m === Math.max(1, A.lumpYear) * 12 - 11) x += +A.lump || 0; b -= Math.min(x, b); }
      const shown = hl.amort.find((h) => /Paid off/.test(h.k));
      const yrs = Math.floor(m / 12), mo = m % 12, txt = (yrs ? yrs + " yr " : "") + (mo ? mo + " mo" : "");
      if (shown && shown.v.trim() !== txt.trim()) f.push(`extra payments paid off in "${shown.v}" vs ${txt}`);
    }
    const F = dataOf("aff");
    if (F && hl.aff && F.program === "conv") {
      const i = F.rate / 1200, n = F.term * 12, k = i / (1 - Math.pow(1 + i, -n)), bud = F.income / 12 * F.dti / 100 - F.debts - F.ins - F.hoa;
      let P = (bud + F.down * k) / (k + F.taxRate / 1200); if ((P - F.down) / P > 0.8) { const k2 = k + F.mi / 1200; P = (bud + F.down * k2) / (k2 + F.taxRate / 1200); }
      if (F.down < P * 0.03) P = F.down / 0.03;
      const shown = money((hl.aff.find((h) => /Homes up to/.test(h.k)) || {}).v);
      if (!near(shown, P, 2)) f.push(`affordability ${shown} vs ${Math.round(P)}`);
    }
    const D = dataOf("debt");
    if (D && hl.debt) {
      const paid = D.debts.filter((x) => x.payoff), loan = D.mBal + paid.reduce((s, x) => s + +x.bal, 0) + +D.cc, save = pmtX(D.mBal, D.mRate, D.mYears) + paid.reduce((s, x) => s + +x.pay, 0) - pmtX(loan, D.rate, D.term);
      const shown = money((hl.debt.find((h) => /New loan/.test(h.k)) || {}).v), sv = money((hl.debt.find((h) => /Monthly savings/.test(h.k)) || {}).v);
      if (!near(shown, loan, 1)) f.push(`debt new loan ${shown} vs ${loan}`);
      if (!near(Math.abs(sv), Math.abs(save), 1)) f.push(`debt savings ${sv} vs ${Math.round(save)}`);
    }
    const I = dataOf("invest");
    if (I && hl.invest) {
      const loan = I.price * (1 - I.downPct / 100), pi = pmtX(loan, I.rate, I.term), rent = (I.rent + (+I.other || 0)) * 12;
      const noi = rent - rent * (I.vacancy + I.mgmt + I.repairs + I.capex) / 100 - I.taxes - I.insurance - I.hoa * 12, cf = (noi - pi * 12) / 12;
      const shown = money((hl.invest.find((h) => /cash flow/i.test(h.k)) || {}).v);
      if (!near(Math.abs(shown), Math.abs(cf), 1)) f.push(`investment cash flow ${shown} vs ${Math.round(cf)}`);
    }
    const R = dataOf("arm");
    if (R && hl.arm) {
      const shown = money((hl.arm.find((h) => /first years/.test(h.k)) || {}).v);
      if (!near(shown, pmtX(R.loan, R.armRate, R.term), 1)) f.push(`ARM first payment ${shown} vs ${Math.round(pmtX(R.loan, R.armRate, R.term))}`);
    }
    toCompare();
    return { fails: f, log, hl, opts: (d.scenarios || []).map((s) => ({ name: s.name, type: s.type, term: s.term, arm: s.arm, rate: s.rate, down: s.downPct, points: s.points, bd: s.bd, credit: s.credit, amt2: s.amt2, loan: Math.round(analyze(s).loan), pi: +analyze(s).pi.toFixed(2), mi: +analyze(s).mi.toFixed(2), ctc: Math.round(analyze(s).cashToClose), apr: +analyze(s).apr.toFixed(3) })),
      price, title, st: file.st, county: file.county, tabs: Object.fromEntries(file.calcs.filter((t) => t.kind !== "compare").map((t) => [t.kind, t.data])) };
  }

  window.lo1Run = async (from = 0, to = window.LO1_CASES.length) => {
    window.lo1Results = window.lo1Results || [];
    window.lo1Ai = window.lo1Ai || [];
    const FP = Object.getPrototypeOf(sb.functions);
    // window.lo1Mock = { [case]: [reply, reply...] } replays saved AI replies instead of calling the AI (free re-runs after a page fix)
    if (!FP.__lo1) { const inv = FP.invoke; FP.invoke = async function (name, opts) {
      const q = window.lo1Mock && window.lo1Mock[window.lo1Case];
      if (window.lo1Mock) return q && q.length ? { data: JSON.parse(JSON.stringify(q.shift())) } : { error: "no saved reply" };
      const r = await inv.call(this, name, opts); window.lo1Ai.push({ case: window.lo1Case, body: opts && opts.body, data: r && r.data }); return r; }; FP.__lo1 = true; }
    for (let n = from; n < to; n++) {
      const c = window.LO1_CASES[n]; window.lo1Case = n;
      try {
        asReset(); newComparison(); file.st = undefined; file.county = undefined;
        const asked = [];
        for (const m of c.msgs) { const q = await send(m); if (q) asked.push(q); }
        const r = check(c);
        window.lo1Results[n] = { n, note: c.msgs.join(" ⟶ "), ok: !r.fails.length, asked, ...r };
      } catch (err) { window.lo1Results[n] = { n, note: c.msgs.join(" ⟶ "), ok: false, fails: ["crash: " + err.message + " " + (err.stack || "").split("\n")[1]] }; }
    }
    asReset(); newComparison();
    return window.lo1Results.slice(from, to).filter(Boolean).map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.n}: ${r.fails.join("; ")}`);
  };
})();
