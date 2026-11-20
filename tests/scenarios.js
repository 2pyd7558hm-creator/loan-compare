/* Assistant scenario tests: notes written the way loan officers and borrowers type them, with the answers each should give.
   Run in the signed-in workspace (AI reader on):  eval(await (await fetch(URL_OF_THIS_FILE)).text()); tmcRun();
   then read window.tmcResults. Nothing is saved. Names are made up. */
(() => {
  const C = (msgs, exp) => ({ msgs: Array.isArray(msgs) ? msgs : [msgs], exp });
  const o = (type, term, rate, down, more) => ({ type, term, rate, down, ...more });
  window.TMC_CASES = [
    C("Stephanie Jones, $450,000, CO, conv 5% down at 6.5% vs FHA 3.5% down at 6.25%", { name: "Stephanie Jones", price: 450000, st: "CO", opts: [o("conv", 30, 6.5, 5), o("fha", 30, 6.25, 3.5)] }),
    C("john & mary smith 525k denver co 30yr fixed 10% dn 6.75 vs 15yr 10% dn 6.125", { name: /smith/i, price: 525000, st: "CO", opts: [o("conv", 30, 6.75, 10), o("conv", 15, 6.125, 10)] }),
    C("Buyers are Tom and Lisa Nguyen, price 550k, Colorado Springs CO, conv 10% down 30 yr vs 15 yr", { name: "Tom and Lisa Nguyen", price: 550000, st: "CO", opts: [o("conv", 30, null, 10), o("conv", 15, null, 10)] }),
    C("New client Kevin Hart, 800k in Boulder County CO, 7/6 ARM at 6.125 vs 30 yr fixed at 6.75, 20% down", { name: "Kevin Hart", price: 800000, county: "Boulder", opts: [o("conv", 30, 6.125, 20, { arm: 7 }), o("conv", 30, 6.75, 20, { arm: 0 })] }),
    C("Amanda Clark $1,200,000 Eagle County CO 10% down 30 yr fixed 7.0 vs 20% down 30 yr fixed 6.875", { name: "Amanda Clark", price: 1200000, county: "Eagle", opts: [o(null, 30, 7, 10), o(null, 30, 6.875, 20)] }),
    C("VA loan for Mike Brown, 0 down, $600k, Colorado, 6.25% 30yr", { name: "Mike Brown", price: 600000, st: "CO", opts: [o("va", 30, 6.25, 0)] }),
    C("FHA 3.5% down 6.0% vs conv 3% down 6.5% for Jose Garcia, 400k, Aurora CO", { name: "Jose Garcia", price: 400000, opts: [o("fha", 30, 6, 3.5), o("conv", 30, 6.5, 3, { fthb: true })] }),
    C("Refi for Pat Lee, home worth 700k, owe 420k, 30 yr at 6.25 vs 15 yr at 5.75", { name: "Pat Lee", price: 700000, refi: true, opts: [o("conv", 30, 6.25, 40), o("conv", 15, 5.75, 40)] }),
    C("Chris Wong, 500k CO, 5% down 30 yr fixed 0 points 7.0 vs 1 point 6.75 vs 2 points 6.5", { name: "Chris Wong", price: 500000, opts: [o("conv", 30, 7, 5, { points: 0 }), o("conv", 30, 6.75, 5, { points: 1 }), o("conv", 30, 6.5, 5, { points: 2 })] }),
    C("Sarah Kim $650,000 CO 5% down 30yr 7.25 with 2-1 buydown seller paid vs no buydown 7.25", { name: "Sarah Kim", price: 650000, opts: [o("conv", 30, 7.25, 5, { bd: 2 }), o("conv", 30, 7.25, 5, { bd: 0 })], anyOrder: true }),
    C("Dan Ortiz 480k CO FHA 3.5% down 6.375, $10,000 seller credit", { name: "Dan Ortiz", price: 480000, opts: [o("fha", 30, 6.375, 3.5, { credit: 10000 })] }),
    C("Rachel Green 375k CO conv 3% down 6.99 with $15,000 DPA at 0%", { name: "Rachel Green", price: 375000, opts: [o("conv", 30, 6.99, 3, { amt2: 15000 })] }),
    C("Ben Carter, 900k, CO, wants to see paying cash vs 20% down 30 yr at 6.5, they have 1.2M in a brokerage account", { name: "Ben Carter", price: 900000, opts: [o("conv", 30, 6.5, 20)], calcs: ["cash"] }),
    C("Lisa Ray 425k CO conv 5% down 6.75, rent is 2400", { name: "Lisa Ray", price: 425000, opts: [o("conv", 30, 6.75, 5)], calcs: ["rvb"], data: { rvb: { rent: 2400 } } }),
    C("Omar Ali, income 110k, 400k CO conv 5% down 6.5, can they afford it", { name: "Omar Ali", price: 400000, calcs: ["aff"], data: { aff: { income: 110000 } } }),
    C("Greg Hill 550k CO 30 yr 6.875 10% down, wants to see 2 extra payments a year", { name: "Greg Hill", price: 550000, opts: [o("conv", 30, 6.875, 10)], calcs: ["amort"] }),
    C("Nina Patel 600k CO 30yr fixed 7 vs 7/6 arm 6.25, 10% down", { name: "Nina Patel", price: 600000, opts: [o("conv", 30, 7, 10, { arm: 0 }), o("conv", 30, 6.25, 10, { arm: 7 })], calcs: ["arm"] }),
    C("Tony Stark 2.5M Pitkin County CO 25% down jumbo 30 yr 6.875", { name: "Tony Stark", price: 2500000, county: "Pitkin", opts: [o("jumbo", 30, 6.875, 25)] }),
    C("jim beam 450 co conv 5 dn 6.5 vs fha 3.5 dn 6.25", { name: /jim beam/i, price: 450000, opts: [o("conv", 30, 6.5, 5), o("fha", 30, 6.25, 3.5)] }),
    C("Sam Wilson, purcahse price 520,000, Lakewood CO, conventinal 10% down 30 year fixd 6.625 vs FHA 3.5 percent down 6.125", { name: "Sam Wilson", price: 520000, opts: [o("conv", 30, 6.625, 10), o("fha", 30, 6.125, 3.5)] }),
    C("Hi, we're looking at a $480,000 house in Fort Collins, Colorado. We have about 5% to put down. What would our payment be with a 30 year fixed vs FHA?", { name: "", price: 480000, st: "CO", opts: [o("conv", 30, null, 5), o("fha", 30, null, 3.5)] }),
    C("My wife and I make about 140k a year and want to know how much house we can afford in Denver with 10% down", { name: "", calcs: ["aff"], data: { aff: { income: 140000 } } }),
    C("Compare 15 vs 30 year for a $350k condo in Littleton CO, 20% down, rates 5.875 and 6.5", { price: 350000, opts: [o("conv", 15, 5.875, 20), o("conv", 30, 6.5, 20)] }),
    C("Lucy Liu 700k CO, 10% down: 30yr 6.875, 20yr 6.5, 15yr 6.125, 10/6 ARM 6.0", { name: "Lucy Liu", price: 700000, opts: [o("conv", 30, 6.875, 10), o("conv", 20, 6.5, 10), o("conv", 15, 6.125, 10), o("conv", 30, 6, 10, { arm: 10 })] }),
    C("Mark Twain 450k CO conv 5% down 6.5 vs 10% down 6.5 vs 20% down 6.375", { name: "Mark Twain", price: 450000, opts: [o("conv", 30, 6.5, 5), o("conv", 30, 6.5, 10), o("conv", 30, 6.375, 20)] }),
    C(["Ellie Ross 500k CO conv 5% down 6.75 vs FHA 3.5% down 6.25", "add a 15 year at 6%", "make B 6.125", "price is 515k"], { name: "Ellie Ross", price: 515000, opts: [o("conv", 30, 6.75, 5), o("fha", 30, 6.125, 3.5), o(null, 15, 6, null)] }),
    C(["Paul Rudd 600k CO 30 yr 7.0 5% down vs 10% down 6.875", "round up option A to $4,500"], { name: "Paul Rudd", price: 600000, calcs: ["amort"], data: { amort: { opt: "A", roundTo: 4500 } } }),
    C(["Ivy Chen 450k CO conv 5% down 6.5", "add rent vs buy, rent is 2,200"], { name: "Ivy Chen", calcs: ["rvb"], data: { rvb: { rent: 2200 } } }),
    C(["Zoe Park 520k CO conv 5% down 6.75 vs FHA 3.5% down 6.25", "Douglas county", "add a 2-1 buydown on A"], { name: "Zoe Park", county: "Douglas", opts: [o("conv", 30, 6.75, 5, { bd: 2 }), o("fha", 30, 6.25, 3.5)] }),
    C(["Hank Moody 1.1M CO 10% down 30 yr 7.0 vs 15 yr 6.5", "it's in Summit County"], { name: "Hank Moody", price: 1100000, county: "Summit" }),
    C("Quinn Fabray, 30 yr fixed 6.5% vs 15 yr 5.9%, 20% down", { name: "Quinn Fabray", opts: [o("conv", 30, 6.5, 20), o("conv", 15, 5.9, 20)] }),
    C("Rob & Kim Hale 750k castle rock co 5% down conv 30 6.875 vs 10% down 6.75 vs fha 3.5 6.375", { name: "Rob & Kim Hale", price: 750000, opts: [o(null, 30, 6.875, 5), o(null, 30, 6.75, 10), o("fha", 30, 6.375, 3.5)] }),
    C("Wes Bentley 1224 Main St Denver CO 80207, $500,000, conv 5% 6.5", { name: "Wes Bentley", price: 500000, titleHas: "1224 Main St", opts: [o("conv", 30, 6.5, 5)] }),
    C("Grace Lee, 720 credit score, 430k CO, conv 3% down 6.875 vs FHA 3.5% 6.25", { name: "Grace Lee", price: 430000, titleNot: /score|720/, opts: [o("conv", 30, 6.875, 3, { fthb: true }), o("fha", 30, 6.25, 3.5)] }),
    C("Leo Messi 499,900 CO 5% down 30y 6.625", { name: "Leo Messi", price: 499900, opts: [o("conv", 30, 6.625, 5)] }),
    C("Cost of waiting for Ann Perkins, 400k CO conv 5% down 6.5, rates might drop or prices go up", { name: "Ann Perkins", price: 400000, calcs: ["cow"] }),
    C("debt consolidation refi for Ron Swanson, home value 600k, owes 300k at 3.5%, credit cards 40k", { name: "Ron Swanson", refi: true, calcs: ["debt"] }),
    C("Investment property for April Ludgate 550k CO 25% down 7.5 rent 3,200", { name: "April Ludgate", price: 550000, calcs: ["invest"] }),
    C("Andy Dwyer 500k CO 7/6 ARM 6.0 vs 30 fixed 6.75 10% down, show ARM vs fixed", { name: "Andy Dwyer", opts: [o("conv", 30, 6, 10, { arm: 7 }), o("conv", 30, 6.75, 10, { arm: 0 })], calcs: ["arm"] }),
    C("Leslie Knope 475k CO conv 5% down 6.5 vs 20% down 6.25, equity over 10 years, bid 25k over asking", { name: "Leslie Knope", calcs: ["equity"] }),
    C("Tom Haverford, $650k, CO, 5% down, 6.75%, extra $300 a month", { name: "Tom Haverford", price: 650000, calcs: ["amort"], data: { amort: { extra: 300 } } }),
    C("Donna Meagle 800k CO 10% down conv 30 yr 6.875 and seller paying 3% concessions", { name: "Donna Meagle", price: 800000, opts: [o("conv", 30, 6.875, 10, { credit: 24000 })] }),
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const busy = () => document.getElementById("quickBtn").disabled || asLog.some((m) => /^(Thinking…|Reading your note…)$/.test(m.text));
  async function send(t) {
    for (let i = 0; i < 120 && busy(); i++) await sleep(500);
    const q = document.getElementById("quickIn"); q.value = t; document.getElementById("quickBtn").click();
    await sleep(700); for (let i = 0; i < 120 && busy(); i++) await sleep(500); await sleep(500);
    // the AI reader asked a question: take the "just draft it" path so the case still finishes
    const last = asLog[asLog.length - 1];
    if (asPending && asPending.kind === "ai" && last && last.buttons) { const q2 = last.text; last.buttons[0].fn(); await sleep(700); for (let i = 0; i < 120 && busy(); i++) await sleep(500); return q2; }
    return null;
  }
  function snap() {
    syncActive();
    const comp = compareTab(), d = comp ? comp.data : state;
    const opts = (d.scenarios || []).map((s) => { const a = analyze(s); return { name: s.name, type: s.type, term: s.term, arm: s.arm || 0, rate: s.rate, points: s.points, down: s.downPct, mi: s.mi, bd: s.bd || 0, credit: s.credit || 0, amt2: s.amt2 || 0, fthb: s.fthb ?? (s.type === "conv" && s.downPct < 5), loan: a.loan, pi: a.pi, total: a.total }; });
    return { name: $("cName").value.trim(), title: $("cTitle").value, price: d.price, st: file.st || null, county: file.county || null, taxes: d.taxes, ins: d.insurance, opts,
      calcs: file.calcs.map((c) => c.kind), data: Object.fromEntries(file.calcs.map((c) => [c.kind, c.data])), log: asLog.map((m) => m.who + ": " + m.text) };
  }
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const pmtX = (L, r, n) => { const i = r / 1200, k = n * 12; return i ? L * i / (1 - Math.pow(1 + i, -k)) : L / k; };
  function check(c, s) {
    const e = c.exp, f = [];
    const eq = (label, got, want) => { if (want instanceof RegExp ? !want.test(String(got)) : got !== want) f.push(`${label}: got ${JSON.stringify(got)}, want ${want}`); };
    if (e.name !== undefined) eq("name", s.name, e.name);
    if (e.price !== undefined) eq("price", s.price, e.price);
    if (e.st) eq("state", s.st, e.st);
    if (e.county) eq("county", s.county, e.county);
    if (e.refi !== undefined) eq("refi", /^refinance/i.test(s.title), e.refi);
    if (e.titleHas && !s.title.includes(e.titleHas)) f.push(`title lacks ${e.titleHas}: ${s.title}`);
    if (e.titleNot && e.titleNot.test(s.title)) f.push(`title has ${e.titleNot}: ${s.title}`);
    // every comparison: names without rates, title made of loan types, taxes/insurance defaults when not typed, payment math, MI rules
    if (!/^(Purchase|Refinance) Options\b/i.test(s.title)) f.push(`title: ${s.title}`);
    s.opts.forEach((x, i) => {
      const L = "ABCD"[i];
      if (/\bat \d/.test(x.name)) f.push(`${L} name has a rate: ${x.name}`);
      if (/^0 Yr|\b0 Yr Fixed/.test(x.name)) f.push(`${L} name: ${x.name}`);
      if (!near(x.pi, pmtX(x.loan, x.rate, x.term), 0.5)) f.push(`${L} P&I ${x.pi.toFixed(2)} vs ${pmtX(x.loan, x.rate, x.term).toFixed(2)}`);
      const base = s.price * (1 - x.down / 100);
      const wantLoan = x.type === "fha" ? base * 1.0175 : x.type === "va" ? base * (1 + vaFee(x.down) / 100) : base;
      if (!near(x.loan, wantLoan, 1)) f.push(`${L} loan ${Math.round(x.loan)} vs ${Math.round(wantLoan)}`);
      if (x.type === "conv" && x.down < 20 && !near(x.mi, convPmi(x.down, x.term, x.fthb), 0.001)) f.push(`${L} PMI ${x.mi} vs ${convPmi(x.down, x.term, x.fthb)}`);
      if (x.type === "conv") { const lc = loanClass(base, s.st, s.county); if (lc.kind === "jumbo") f.push(`${L} conv over the county limit (should be jumbo)`); }
    });
    if (!/^refinance/i.test(s.title) && s.price > 0) {
      if (!near(s.taxes, s.price * 0.008, 15)) f.push(`taxes ${s.taxes} vs 0.80% ${Math.round(s.price * 0.008)}`);
      if (!near(s.ins, s.price * 0.0055, 15)) f.push(`insurance ${s.ins} vs 0.55% ${Math.round(s.price * 0.0055)}`);
    }
    // expected options (in order unless anyOrder)
    if (e.opts) {
      if (s.opts.length !== e.opts.length) f.push(`${s.opts.length} options, want ${e.opts.length}`);
      const pool = [...s.opts];
      e.opts.forEach((w, i) => {
        const L = "ABCD"[i];
        const matches = (x) => (w.type == null || x.type === w.type || (w.type === "conv" && x.type === "jumbo")) && (w.term == null || x.term === w.term) && (w.rate == null || near(x.rate, w.rate, 0.001)) && (w.down == null || near(x.down, w.down, 0.01)) && (w.arm == null || x.arm === w.arm) && (w.points == null || x.points === w.points) && (w.bd == null || x.bd === w.bd) && (w.credit == null || near(x.credit, w.credit, 1)) && (w.amt2 == null || near(x.amt2, w.amt2, 1)) && (w.fthb == null || x.fthb === w.fthb);
        const got = c.exp.anyOrder ? pool.find(matches) : (matches(s.opts[i] || {}) ? s.opts[i] : null);
        if (!got) f.push(`${L} want ${JSON.stringify(w)} got ${JSON.stringify(s.opts[i] && (({ type, term, arm, rate, down, points, bd, credit, amt2, fthb }) => ({ type, term, arm, rate, down, points, bd, credit, amt2, fthb }))(s.opts[i]))}`);
        else if (c.exp.anyOrder) pool.splice(pool.indexOf(got), 1);
      });
    }
    (e.calcs || []).forEach((k) => { if (!s.calcs.includes(k)) f.push(`missing ${k} tab (have ${s.calcs.join(",")})`); });
    Object.entries(e.data || {}).forEach(([k, want]) => Object.entries(want).forEach(([fk, fv]) => { const got = s.data[k] && s.data[k][fk]; if (got !== fv && !(typeof fv === "number" && near(+got, fv, 1))) f.push(`${k}.${fk}: got ${got}, want ${fv}`); }));
    return f;
  }
  window.tmcRun = async (from = 0, to = window.TMC_CASES.length) => {
    window.tmcResults = window.tmcResults || [];
    // keep each AI reply, so the same answers can be replayed offline without spending
    window.tmcAi = window.tmcAi || [];
    if (!sb.functions.__tmc) { const inv = sb.functions.invoke.bind(sb.functions); sb.functions.invoke = async (name, opts) => { const r = await inv(name, opts); window.tmcAi.push({ case: window.tmcCase, body: opts && opts.body, data: r && r.data }); return r; }; sb.functions.__tmc = true; }
    for (let n = from; n < to; n++) {
      const c = window.TMC_CASES[n]; window.tmcCase = n;
      try {
        asReset(); newComparison(); file.st = undefined; file.county = undefined;
        const asked = [];
        for (const m of c.msgs) { const q = await send(m); if (q) asked.push(q); }
        const s = snap(), fails = check(c, s);
        window.tmcResults[n] = { n, note: c.msgs.join(" ⟶ "), ok: !fails.length, fails, asked, snap: s };
      } catch (err) { window.tmcResults[n] = { n, note: c.msgs.join(" ⟶ "), ok: false, fails: ["crash: " + err.message] }; }
    }
    asReset(); newComparison();
    return window.tmcResults.filter(Boolean).map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.n}: ${r.fails.join("; ")}`);
  };
})();
