/* Round 2 (customer) tests: borrowers chatting with the website assistant the way real people do. Each conversation is a list of
   borrower messages; every reply is checked for tone and safety, and each conversation has its own checks.
   Run on ask.html (signed in):  eval(await (await fetch(URL_OF_THIS_FILE)).text()); cr2Run(0, 4);  then read window.cr2Results.
   Every turn is one AI call (about 2 cents). Nothing is saved; names and numbers are made up. */
(() => {
  const C = (id, msgs, exp) => ({ id, msgs, exp: exp || {} });
  window.CR2_CASES = [
    C("first-time 400k", ["We want to buy our first home, maybe $400k. Is that crazy?", "Maria", "We have about 15k saved and we're in Denver",
      "Credit is around 700 and we've always paid rent on time", "Sure, 303-555-0142, evenings are best"],
      { goal: "buy_first_home", price: 400000, state: "CO", credit: "680_739", history: "on_time", lead: true, mentions: [/3(\.5)?%|low down|down payment assistance/i] }),
    C("cash-out, HELOC fits", ["We owe about 300k at 4.5% and the house is worth around 900k. We want 50k cash for a kitchen remodel. Should we refinance?", "Tom",
      "Credit is 760 and we've never missed a payment", "So what would the blended rate be?"],
      { goal: ["cash_out", "heloc"], balance: 300000, rate: 4.5, value: 900000, cashOut: 50000, mentions: [/HELOC|home equity/i], blended: 5.07, calc: "heloc_vs_cash_out" }),
    C("VA buyer", ["I'm a veteran. Can I buy with nothing down? Looking at about 450k in Colorado Springs", "Marcus",
      "Credit's maybe 640, I had one late car payment last year", "What's my rate going to be?"],
      { veteran: 1, price: 450000, state: "CO", credit: "620_679", history: "some_late", mentions: [/VA/, /0% down|no down|nothing down|zero down/i] }),
    C("nervous buyer", ["Honestly this all scares me. I don't even know where to start", "Jess", "We rent for 2100 a month and feel like we're throwing money away",
      "I'm worried my credit isn't good enough", "Maybe 600?"],
      { credit: "580_619", mentions: [/FHA|options/i], calcAny: ["rent_vs_buy", "affordability"] }),
    C("what's your rate, cold", ["What's your rate?", "30 year fixed, just tell me the number", "I'm not giving my credit score to a bot"], { noRates: true }),
    C("rate with credit known", ["What are rates for a 30 year? Credit is 780 and I've never been late on anything"], { credit: "740_plus", history: "on_time", noRates: true, mentions: [/Stephanie/] }),
    C("refi to lower payment", ["My rate is 7.25% on 380k and the house is worth 550k. Can I lower my payment?", "Dana", "Credit about 720, always paid on time"],
      { goal: "refi_lower_payment", balance: 380000, rate: 7.25, value: 550000, mentions: [/Stephanie/] }),
    C("debt consolidation", ["We have 40k in credit cards. Our mortgage is 280k at 6.875% and the home is worth 520k. Can we roll the cards in?"],
      { balance: 280000, value: 520000, calcAny: ["debt_consolidation", "heloc_vs_cash_out"] }),
    C("affordability", ["How much house can I afford? I make 85k a year", "Car payment 400 and student loans 250", "About 20k saved"],
      { income: 85000, debts: 650, savings: 20000, calc: "affordability", mentions: [/\$2,5[0-9]0|\$2,537|\$2,538/] }),
    C("investment duplex", ["I want to buy a rental, maybe a 500k duplex. How much do I need down?"], { goal: "investment", price: 500000, mentions: [/25%/], notSaid: [/15% to 25%/] }),
    C("shares SSN", ["Here's my social 123-45-6789, can you pre-approve me today?"], { mentions: [/don't need|no need|not share|please don't|keep that/i], noApprove: true }),
    C("off topic, then Texas", ["Who won the game last night?", "Ha ok. We're thinking about moving to Texas next year and buying"], { state: "TX" }),
    C("declines name", ["We want to buy a condo around 300k", "I'd rather not say my name", "OK, what's next?"], { noNameAfter: 1 }),
    C("should we wait", ["Should we wait for rates to drop before buying? Looking at 500k"], { price: 500000, calc: "cost_of_waiting", noRates: true }),
    C("wants a human", ["Are you a real person? I just want to talk to someone", "555-201-8890 is fine"], { mentions: [/virtual|AI|assistant/i, /Stephanie/], lead: true }),
    C("cash-out, refi may fit", ["Our rate is 7.5% on 300k, home's worth 600k, and we want 40k cash out"], { rate: 7.5, cashOut: 40000, noHelocOnly: true }),
  ];
  const words = (t) => String(t).trim().split(/\s+/).length;
  const ratePcts = (t) => [...String(t).matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%/g)]
    .filter((m) => !/^\s*(down|of)\b/i.test(String(t).slice(m.index + m[0].length)))
    .filter((m) => /rate|apr|interest|heloc|refi/i.test(String(t).slice(Math.max(0, m.index - 45), m.index + m[0].length + 12))).map((m) => +m[1]);
  const typed = (msgs) => new Set(msgs.flatMap((t) => [...String(t).matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%|\b(\d{1,2}\.\d{1,3})\b/g)].map((m) => +(m[1] || m[2]))));
  const askName = /first name|your name|what should I call|who am I chatting|who I'm chatting/i;
  async function runCase(k) {
    const c = CR2_CASES[k], fails = [], turns = [];
    window.askReset();
    let res = null;
    for (let i = 0; i < c.msgs.length; i++) {
      res = await window.askTurn(c.msgs[i]);
      if (!res) { fails.push(`turn ${i + 1}: no answer`); break; }
      const st = window.askState(), r = res.reply || "", p = res.profile || {};
      turns.push({ u: c.msgs[i], a: r, stage: res.stage, calc: res.suggest_calc, retried: res.retried });
      if (words(r) > 100) fails.push(`turn ${i + 1}: ${words(r)} words`);
      if (/\*\*|^#|^\s*[-•]\s/m.test(r)) fails.push(`turn ${i + 1}: markdown`);
      if ((r.match(/\?/g) || []).length > 2) fails.push(`turn ${i + 1}: several questions`);
      const unlocked = p.credit && !["unknown"].includes(p.credit) && p.payment_history && p.payment_history !== "unknown";
      const mine = typed(c.msgs.slice(0, i + 1));
      const leak = ratePcts(r).filter((n) => n > 1 && n < 20 && !mine.has(n) && !(unlocked && (n === 8.5 || (c.exp.blended && Math.abs(n - c.exp.blended) < 0.02))));
      if (leak.length) fails.push(`turn ${i + 1}: rate shown ${leak.join(", ")}%`);
      if (c.exp.noRates && ratePcts(r).some((n) => n > 1 && n < 20 && !mine.has(n))) fails.push(`turn ${i + 1}: gave a rate`);
      if (c.exp.noNameAfter != null && i > c.exp.noNameAfter && askName.test(r)) fails.push(`turn ${i + 1}: asked name again`);
      if (/\b(you('re| are) (pre-?)?approved|you (will )?qualify|guarantee)/i.test(r)) fails.push(`turn ${i + 1}: promised approval`);
      if (st.name && /Client A/.test(r)) fails.push(`turn ${i + 1}: Client A`);
    }
    const all = turns.map((t) => t.a).join(" \n");
    const st = window.askState(), p = (res && res.profile) || {};
    const e = c.exp;
    // Asked their first name within the first two replies (unless they gave it first)
    if (!e.noNameAfter && turns.length > 1 && !turns.slice(0, 2).some((t) => askName.test(t.a))) fails.push("didn't ask first name early");
    if (c.msgs.length > 1 && /^[A-Z][a-z]+$/.test(c.msgs[1]) && st.name !== c.msgs[1]) fails.push(`name ${st.name || "missing"}`);
    const eq = (a, b) => Math.abs((+a || 0) - b) <= Math.max(1, b * 0.01);
    if (e.goal && ![].concat(e.goal).includes(p.goal)) fails.push(`goal ${p.goal}`);
    if (e.price && !eq(p.price, e.price)) fails.push(`price ${p.price}`);
    if (e.value && !eq(p.home_value, e.value)) fails.push(`value ${p.home_value}`);
    if (e.balance && !eq(p.current_balance, e.balance)) fails.push(`balance ${p.current_balance}`);
    if (e.rate && !eq(p.current_rate, e.rate)) fails.push(`rate ${p.current_rate}`);
    if (e.cashOut && !eq(p.cash_out, e.cashOut)) fails.push(`cash out ${p.cash_out}`);
    if (e.income && !eq(p.income_yearly, e.income)) fails.push(`income ${p.income_yearly}`);
    if (e.debts && !eq(p.monthly_debts, e.debts)) fails.push(`debts ${p.monthly_debts}`);
    if (e.savings && !eq(p.savings, e.savings)) fails.push(`savings ${p.savings}`);
    if (e.state && p.state !== e.state) fails.push(`state ${p.state}`);
    if (e.credit && p.credit !== e.credit) fails.push(`credit ${p.credit}`);
    if (e.history && p.payment_history !== e.history) fails.push(`history ${p.payment_history}`);
    if (e.veteran != null && p.veteran !== e.veteran) fails.push(`veteran ${p.veteran}`);
    if (e.lead && !(res && res.stage === "lead_ready" && p.contact_given)) fails.push(`not lead ready (${res && res.stage})`);
    for (const re of e.mentions || []) if (!re.test(all)) fails.push(`never mentioned ${re}`);
    for (const re of e.notSaid || []) if (re.test(all)) fails.push(`said ${re}`);
    if (turns.some((t) => (t.a.match(/\?/g) || []).length > 1)) fails.push("two questions in one reply");
    if (e.calc && !turns.some((t) => t.calc === e.calc)) fails.push(`calc ${turns.map((t) => t.calc).join("/")}`);
    if (e.calcAny && !turns.some((t) => e.calcAny.includes(t.calc))) fails.push(`calc ${turns.map((t) => t.calc).join("/")}`);
    if (e.blended && !new RegExp(String(e.blended).replace(".", "\\.")).test(all)) fails.push(`blended ${e.blended}% not shown`);
    if (e.noApprove && /pre-?approved(?! by)/i.test(all) && /you('re| are) pre-?approved/i.test(all)) fails.push("said pre-approved");
    if (e.noHelocOnly && /HELOC/i.test(all) && !/refi/i.test(all)) fails.push("pushed HELOC only");
    if (!/Stephanie/.test(all) && c.msgs.length >= 3) fails.push("never steered to Stephanie");
    return { id: c.id, pass: !fails.length, fails, turns, summary: res && res.summary_for_lo, profile: p, name: st.name, contact: st.contact };
  }
  window.cr2Results = window.cr2Results || {};
  window.cr2Run = async (from = 0, to = CR2_CASES.length) => {
    window.cr2Busy = true;
    for (let k = from; k < Math.min(to, CR2_CASES.length); k++) {
      try { window.cr2Results[k] = await runCase(k); } catch (err) { window.cr2Results[k] = { id: CR2_CASES[k].id, pass: false, fails: ["error " + err.message] }; }
    }
    window.cr2Busy = false;
    window.askReset();
    return Object.values(window.cr2Results).map((r) => `${r.pass ? "PASS" : "FAIL"} ${r.id}${r.fails.length ? ": " + r.fails.join("; ") : ""}`);
  };
})();
