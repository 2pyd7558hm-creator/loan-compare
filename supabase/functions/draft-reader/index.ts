// Supabase Edge Function: draft-reader
// Reads a loan officer's Quick draft note and returns either one short clarifying question or the
// structured fields the workspace fills in. Only signed-in staff can call it. The Anthropic key lives in
// this function's secrets (ANTHROPIC_API_KEY) and never reaches the browser. The page removes client names
// and street addresses before the note is sent; the math (MI, loan limits, APR) stays in the workspace.
import Anthropic from "npm:@anthropic-ai/sdk@1.12.0";
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const ALLOWED_ORIGINS = ["https://compare.thatmortgagecouple.com", "http://localhost:8765"];
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

// Structured output allows only a few nullable fields, so "not stated" is 0, -1 or "" here and becomes null in normalize()
const N = { type: "number" }, S = { type: "string" }, B = { type: "boolean" };
const OPTION = {
  type: "object", additionalProperties: false,
  properties: {
    type: { type: "string", enum: ["conv", "fha", "va", "jumbo", "unknown"] },
    term: N, arm: { type: "integer", enum: [0, 3, 5, 7, 10] },
    rate: N, points: N, down_pct: N, buydown: { type: "integer", enum: [0, 1, 2, 3] },
    seller_credit: N, second_amount: N, second_rate: N,
  },
  required: ["type", "term", "arm", "rate", "points", "down_pct", "buydown", "seller_credit", "second_amount", "second_rate"],
};
const DRAFT_KEYS = ["refi", "condo", "jumbo_all", "price", "state", "county", "options", "seller_credit_all", "dpa_amount", "dpa_rate",
  "rent", "income", "extra_monthly", "extra_payments_per_year", "cost_of_waiting", "debts", "extra_payments",
  "arm_vs_fixed", "bid_over_asking", "equity", "investment", "paying_cash", "credit_reports", "facts", "assumptions"];
// Numbers the calculator tabs need, read from the note. 0 (or "" / empty list) means not stated.
const DEBT = { type: "object", additionalProperties: false, properties: { name: S, balance: N, rate: N, payment: N }, required: ["name", "balance", "rate", "payment"] };
const FACT_KEYS = ["current_balance", "current_rate", "current_years_left", "second_balance", "cash_out", "irrrl", "debts_paid_off", "monthly_debts",
  "cash_for_down", "hoa_monthly", "wait_months", "rate_if_wait", "hoped_rate", "bid_over", "savings", "investments", "retirement", "under_59"];
const FACTS = {
  type: "object", additionalProperties: false,
  properties: {
    current_balance: N, current_rate: N, current_years_left: N, second_balance: N, cash_out: N, irrrl: B,
    debts_paid_off: { type: "array", items: DEBT }, monthly_debts: N, cash_for_down: N, hoa_monthly: N,
    wait_months: N, rate_if_wait: N, hoped_rate: N, bid_over: N, savings: N, investments: N, retirement: N,
    under_59: { type: "integer", enum: [-1, 0, 1] },
  },
  required: FACT_KEYS,
};
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["question", "draft"] },
    question: S,
    draft: {
      type: "object", additionalProperties: false,
      properties: {
        refi: B, condo: B, jumbo_all: B, price: N, state: S, county: S,
        options: { type: "array", items: OPTION },
        seller_credit_all: N, dpa_amount: N, dpa_rate: N, rent: N, income: N, extra_monthly: N, extra_payments_per_year: N,
        cost_of_waiting: B, debts: B, extra_payments: B, arm_vs_fixed: B, bid_over_asking: B, equity: B, investment: B, paying_cash: B,
        credit_reports: { type: "integer" },
        facts: FACTS,
        assumptions: { type: "array", items: S },
      },
      required: DRAFT_KEYS,
    },
  },
  required: ["kind", "question", "draft"],
};
// Back to the page's shape: null for anything not stated
const pos = (v: unknown) => typeof v === "number" && v > 0 ? v : null;
const nonneg = (v: unknown) => typeof v === "number" && v >= 0 ? v : null;
const txt = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
// deno-lint-ignore no-explicit-any
function normFacts(f: any) {
  // deno-lint-ignore no-explicit-any
  const out: any = {};
  for (const k of FACT_KEYS) out[k] = k === "irrrl" ? f[k] === true : k === "under_59" ? (f[k] === 1 ? true : f[k] === 0 ? false : null) : k === "debts_paid_off" ? [] : pos(f[k]);
  out.debts_paid_off = (Array.isArray(f.debts_paid_off) ? f.debts_paid_off : []).slice(0, 8)
    // deno-lint-ignore no-explicit-any
    .filter((x: any) => pos(x.balance)).map((x: any) => ({ name: txt(x.name) || "Debt", balance: pos(x.balance), rate: pos(x.rate), payment: pos(x.payment) }));
  return out;
}
// deno-lint-ignore no-explicit-any
function normalize(out: any) {
  if (out.kind === "question" && txt(out.question)) return { kind: "question", question: txt(out.question), draft: null };
  const d = out.draft || {};
  return {
    kind: "draft", question: null,
    draft: {
      ...d, price: pos(d.price), state: txt(d.state), county: txt(d.county),
      seller_credit_all: pos(d.seller_credit_all), dpa_amount: pos(d.dpa_amount), dpa_rate: pos(d.dpa_rate), rent: pos(d.rent), income: pos(d.income),
      facts: normFacts(d.facts || {}),
      extra_monthly: pos(d.extra_monthly), extra_payments_per_year: pos(d.extra_payments_per_year), credit_reports: Math.max(1, Math.min(4, Math.round(+d.credit_reports || 1))), assumptions: Array.isArray(d.assumptions) ? d.assumptions : [],
      // deno-lint-ignore no-explicit-any
      options: (Array.isArray(d.options) ? d.options : []).slice(0, 4).map((o: any) => ({
        type: o.type === "unknown" ? null : o.type, term: pos(o.term), arm: o.arm || 0, rate: pos(o.rate), points: nonneg(o.points), down_pct: nonneg(o.down_pct),
        buydown: o.buydown || 0, seller_credit: pos(o.seller_credit), second_amount: pos(o.second_amount), second_rate: pos(o.second_rate),
      })),
    },
  };
}

const SYSTEM = `You read short notes that mortgage loan officers type to set up a loan comparison for a client, and turn them into structured fields.

The note never contains the client's real name or street address: they appear as "Client A" and "[street address]". Ignore them.

Fill the draft like this:
- options: one entry per loan option the note describes, in the order written, at most 4. "vs", commas, "then", "and" and line breaks can all separate options; a down payment followed by a rate ("20% down, 7.375%") is ONE option. If the note says "N scenarios", return exactly N options. If the note describes no options, return an empty list.
- type: "conv" (conventional), "fha", "va" or "jumbo"; "unknown" if not stated. A jumbo note with several options: every option is jumbo.
- term: loan term in years (30, 25, 20, 15, 10); 0 if not stated. For an ARM, term is the full loan term (usually 30), and arm is the fixed period: "7/6 ARM" or "7 year ARM" is arm 7; a bare "ARM" is 7. A fixed-rate loan has arm 0.
- rate: the note rate in percent, ONLY if the note states it. Never guess a rate: use 0.
- points: discount points ("1 point" = 1, "no points" = 0); -1 if not stated.
- down_pct: down payment as a percent of price. Convert dollar down payments using the price. -1 if not stated ("no down" or "0 down" is 0).
- buydown: temporary buydown, 2 for "2-1", 3 for "3-2-1", 1 for "1-0", else 0.
- seller_credit / second_amount / second_rate per option only when the note ties them to one option; otherwise use seller_credit_all (dollars; convert percents using the price) and dpa_amount / dpa_rate (down payment assistance or a 2nd mortgage). Use 0 for any of these that don't apply; second_rate 0 means deferred.
- price: purchase price or home value in dollars ("750k" = 750000, "1.5M" = 1500000); 0 if not stated.
- state: two-letter code, "" if not stated. county: the county name without the word "County", "" if not stated.
- refi: true for a refinance. condo: true for a condo.
- Calculators to add, true only when the note asks for or clearly implies them: cost_of_waiting ("wait", "waiting"), debts (paying off debts, consolidation), extra_payments (extra or faster payoff; also set extra_monthly in dollars or extra_payments_per_year as a count), arm_vs_fixed (an ARM compared with a fixed loan), bid_over_asking (offering over asking), equity (equity or appreciation), investment (rental or investment property), paying_cash (paying cash, an all-cash purchase or a cash offer). rent and income are monthly rent and yearly income in dollars when stated. Any number not stated is 0.
- facts: numbers for the calculator tabs, only when the note states them (0, false, -1 or an empty list otherwise). Dollars are whole dollars ("410" next to a home value means 410000; "1.2M" = 1200000); rates are percents.
  - Refinance or debt consolidation: current_balance (what they owe on the first mortgage), current_rate (that loan's rate), current_years_left, second_balance (a second mortgage or HELOC being paid off; 0 if none), cash_out (cash they want back at closing), irrrl (true for a VA IRRRL / VA streamline), debts_paid_off (each card, car loan, student loan or other debt being paid off: name like "Credit cards", "Car loan", balance, rate, monthly payment). The current loan's rate is never a loan option, and neither is a rate they're hoping for.
  - Affordability: monthly_debts (their monthly debt payments, e.g. car 450 + student loans 300 = 750; a small amount next to a debt, like "300 student loans" or "car pmt 450", is a monthly payment), cash_for_down (cash they have for the down payment and closing, e.g. "40k down", "15k saved").
  - hoa_monthly: HOA dues per month.
  - Cost of waiting: wait_months ("wait 6 months" = 6, "a year" = 12), rate_if_wait (the rate if they buy later), hoped_rate (on a refinance, the lower rate they're waiting for).
  - Bid over asking: bid_over in dollars ("20k over asking" = 20000; convert a percent using the asking price). price is what they'd pay: the asking price plus bid_over.
  - Paying cash: savings (savings and checking), investments (brokerage), retirement (401k or IRA), under_59: 1 if the person taking money from retirement is under 59 and a half (from an age or a statement), 0 if 59 and a half or older, -1 if unknown.
- Refinance: price is the home value. For each option, down_pct is 100 minus the loan as a percent of the value when you can tell the loan (balance + second + debts paid off + cash out); otherwise -1.
- Investment ("investment", "inv prop", "rental", "NOO", "non-owner"): set investment true; rent is the property's monthly rent (add the units' rents together).
- A note that gives only a down payment and/or a rate and/or a term ("10 dn 6.75", "fha ... 6.25") describes ONE option; don't return an empty options list for it, and a lone rate in the note is that option's rate. "dn" means down.
- credit_reports: how many separate credit reports the borrowers need. 1 for one borrower, or for a married or partnered couple (one joint report). Each co-borrower who isn't the borrower's spouse or partner adds one ("me and my mom", "two brothers", "my friend and I", "with my dad as co-borrower" = 2; "me, my wife and my mom" = 2). Someone only giving gift money or helping isn't a borrower. Use 1 unless the note clearly says so.
- assumptions: short plain-English notes about anything you had to read loosely, for the loan officer to check. Empty if none.

Ask ONE short question (kind "question"; fill draft with what you have) only when a missing detail would change the comparison and a sensible default would likely be wrong. The main cases:
- the loan amount (price minus down payment) is over $832,750 and the state or county is missing, because it decides conforming, high balance or jumbo: ask which state and county;
- you can't tell how many options there are or which details belong to which option;
- there is no price or home value at all.
Don't ask about rates, points, fees or anything the loan officer can easily fix on the cards. When the message says no more questions, always return a draft, using sensible defaults and listing them in assumptions.
Otherwise return kind "draft" with question "".`;


// ---- Chat mode: one turn of the workspace assistant. It sees the form as it is now and the recent conversation,
// and answers with a short reply plus changes for the page to make. "Keep" values (-1, 0, "") leave a field as it is.
const CALC_KINDS = ["none", "cow", "rvb", "aff", "debt", "amort", "arm", "equity", "invest", "cash"];
const ACTION = {
  type: "object", additionalProperties: false,
  properties: {
    op: { type: "string", enum: ["set_price", "set_location", "update_option", "add_option", "remove_option", "add_calc", "set_refi", "round_up"] },
    index: { type: "integer" },
    type: { type: "string", enum: ["keep", "conv", "fha", "va", "jumbo"] },
    term: N, arm: { type: "integer", enum: [-1, 0, 3, 5, 7, 10] }, rate: N, points: N, down_pct: N,
    buydown: { type: "integer", enum: [-1, 0, 1, 2, 3] }, seller_credit: N,
    value: N, state: S, county: S, calc: { type: "string", enum: CALC_KINDS }, flag: B,
  },
  required: ["op", "index", "type", "term", "arm", "rate", "points", "down_pct", "buydown", "seller_credit", "value", "state", "county", "calc", "flag"],
};
const CHAT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    reply: S,
    actions: { type: "array", items: ACTION },
    suggest_calc: { type: "string", enum: CALC_KINDS },
    suggest_text: S,
  },
  required: ["reply", "actions", "suggest_calc", "suggest_text"],
};
const CHAT_SYSTEM = `You are the assistant inside a mortgage loan officer's loan comparison workspace (That Mortgage Couple). The loan officer types to you; you change the form for them and keep the conversation going. The client's name and street address are replaced with "Client A" and "[street address]".

Each turn you get the FORM as it is right now (JSON), the recent CONVERSATION, and the loan officer's NEW MESSAGE. Read the new message in light of the conversation: if your last message asked a question, the new message is usually the answer to it.

Return:
- reply: one to three short, friendly sentences in plain English saying what you changed, or answering the question. If something important is still missing, ask ONE question at the end (for example: "No rate yet for option B. What's your rate, or should I keep my estimate?"). Don't use jargon or markdown.
- actions: the changes to make, in order. Use only what the message asks for or clearly implies:
  - set_price: value = purchase price or home value in dollars.
  - set_location: state (two letters) and/or county (without the word County). Use "" for a part you aren't changing.
  - update_option: index = the option's number from FORM.options (0 for A, 1 for B...). Set only the fields that change; leave the rest as keep: type "keep", term 0, arm -1, rate 0, points -1, down_pct -1, buydown -1, seller_credit -1. ("Make B 20% down" = update_option index 1, down_pct 20.)
  - add_option: a new loan option (up to 4 total). Same fields; anything left as keep is copied from option A, and a missing rate is estimated by the page.
  - remove_option: index of the option to remove.
  - add_calc: calc = one of cow (cost of waiting), rvb (rent vs buy; value = monthly rent if known), aff (affordability; value = yearly income if known), debt (debt consolidation), amort (extra payments; value = extra dollars a month if known), arm (ARM vs fixed), equity (equity and appreciation), invest (investment property), cash (cost of paying cash; value = dollars in investments or a brokerage account they would sell, if mentioned). Don't add a calculator that's already in FORM.tabs.
  - set_refi: flag true for a refinance, false for a purchase.
  - round_up: index = the option, value = the monthly payment to round up to (e.g. "round up option B to $3,000" -> index 1, value 3000; "round up A" with no amount -> value 0, which rounds to the next $100; FORM.options[i].payment is that option's monthly payment now). This opens the Extra payments calculator from that option, with the extra amount set to the difference.
  For every action, fill fields you don't use with the keep values above, index -1, value 0, state "", county "", calc "none", flag false.
- suggest_calc / suggest_text: when no calculator was asked for this turn, you may suggest ONE calculator that isn't in FORM.tabs and would help this client, with a short yes/no question in suggest_text (for example after three or more options: amort, "Want to show how extra payments could pay one of these off faster?"; with an ARM: arm; with a small down payment or FHA: rvb; when cash or savings come up: cash). Otherwise suggest_calc "none" and suggest_text "". Don't suggest one the conversation shows the loan officer already turned down.

Rates: never invent a rate in update_option or add_option; leave rate 0 unless the loan officer gave one. FORM.options[i].rate_estimated true means the page guessed it.
Loan limits: a conventional loan over $832,750 (price minus down payment) may be high balance or jumbo depending on the county, so ask for the county when it's missing.
If the message is a general mortgage question, answer it briefly in reply with no actions. If you can't tell what they want, ask one short question and make no changes.`;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin"), headers = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (req.method !== "POST") return reply({ error: "method" }, 405);

  // Signed-in staff only
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return reply({ error: "not_signed_in" }, 401);
  // The project's publishable key is public (it's in the workspace page); the signed-in user's token decides access
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_8lBhstmey8uIbNnJelcbqQ_H8WpOHKT";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, publicKey, { global: { headers: { Authorization: auth } } });
  const { data: staff, error: staffErr } = await sb.rpc("is_staff");
  if (staffErr || staff !== true) return reply({ error: "not_staff" }, 403);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return reply({ error: "not_configured" }, 503);

  let body: { note?: unknown; answers?: unknown; final?: unknown; mode?: unknown; form?: unknown; history?: unknown; profile?: unknown; examples?: unknown };
  try { body = await req.json(); } catch { return reply({ error: "bad_json" }, 400); }
  if (body.mode === "chat") return chatTurn(key, body, reply);
  if (body.mode === "customer") return customerTurn(key, body, reply);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note || note.length > 4000) return reply({ error: "bad_note" }, 400);
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 3) as { q?: string; a?: string }[] : [];

  let content = `Note: ${note}`;
  for (const x of answers) content += `\n\nYou asked: ${String(x.q || "").slice(0, 500)}\nLoan officer answered: ${String(x.a || "").slice(0, 500)}`;
  if (body.final === true || answers.length >= 2) content += "\n\nNo more questions: return the draft now.";

  const client = new Anthropic({ apiKey: key });
  try {
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return reply({ error: "no_answer" }, 502);
    const text = msg.content.map((b) => b.type === "text" ? b.text : "").join("");
    const out = normalize(JSON.parse(text));
    return reply({ ...out, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return reply({ error: "bad_key" }, 503);
    if (e instanceof Anthropic.APIError) return reply({ error: "ai_error", status: e.status, detail: String(e.message || "").slice(0, 300) }, 502);
    return reply({ error: "ai_error" }, 502);
  }
});

// deno-lint-ignore no-explicit-any
async function chatTurn(key: string, body: any, reply: (b: unknown, status?: number) => Response) {
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note || note.length > 4000) return reply({ error: "bad_note" }, 400);
  const form = JSON.stringify(body.form ?? {}).slice(0, 6000);
  const history = (Array.isArray(body.history) ? body.history.slice(-12) : [])
    .map((m: { who?: string; text?: string }) => `${m.who === "u" ? "Loan officer" : "Assistant"}: ${String(m.text || "").slice(0, 600)}`).join("\n");
  const content = `FORM:\n${form}\n\nCONVERSATION:\n${history || "(none yet)"}\n\nNEW MESSAGE:\n${note}`;
  const client = new Anthropic({ apiKey: key });
  try {
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: CHAT_SCHEMA } },
      system: CHAT_SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return reply({ error: "no_answer" }, 502);
    const text = msg.content.map((b) => b.type === "text" ? b.text : "").join("");
    const out = JSON.parse(text);
    out.actions = (Array.isArray(out.actions) ? out.actions : []).slice(0, 12);
    return reply({ kind: "chat", ...out, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return reply({ error: "bad_key" }, 503);
    if (e instanceof Anthropic.APIError) return reply({ error: "ai_error", status: e.status, detail: String(e.message || "").slice(0, 300) }, 502);
    return reply({ error: "ai_error" }, 502);
  }
}

// ---- Customer mode: one turn of the borrower-facing assistant ("Ask That Mortgage Couple"). The borrower types; the
// assistant answers in plain English, learns the basics, holds back rates until credit and payment history are known,
// points out better fits (like a HELOC) and steers toward a call with Stephanie. Phone numbers and emails are replaced
// with [phone] / [email] in the browser, and the borrower's first name is replaced with {name} after the turn they give it.
const TRI = { type: "integer", enum: [-1, 0, 1] };
const PROFILE_KEYS = ["first_name", "goal", "first_time_buyer", "veteran", "price", "down_payment", "home_value", "current_balance", "current_rate",
  "cash_out", "second_balance", "income_yearly", "monthly_debts", "savings", "state", "area", "credit", "payment_history", "timeline", "contact_given"];
const PROFILE = {
  type: "object", additionalProperties: false,
  properties: {
    first_name: S,
    goal: { type: "string", enum: ["unknown", "buy_first_home", "buy_home", "refi_lower_payment", "cash_out", "heloc", "va_purchase", "va_refi", "investment", "just_curious"] },
    first_time_buyer: TRI, veteran: TRI,
    price: N, down_payment: N, home_value: N, current_balance: N, current_rate: N, cash_out: N, second_balance: N,
    income_yearly: N, monthly_debts: N, savings: N, state: S, area: S,
    credit: { type: "string", enum: ["unknown", "under_580", "580_619", "620_679", "680_739", "740_plus", "not_sure"] },
    payment_history: { type: "string", enum: ["unknown", "on_time", "some_late", "not_sure"] },
    timeline: S, contact_given: B,
  },
  required: PROFILE_KEYS,
};
const CUSTOMER_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    reply: S,
    profile: PROFILE,
    suggest_calc: { type: "string", enum: ["none", "affordability", "payment", "rent_vs_buy", "cost_of_waiting", "heloc_vs_cash_out", "debt_consolidation", "extra_payments", "va"] },
    stage: { type: "string", enum: ["getting_to_know", "exploring", "offered_call", "lead_ready"] },
    summary_for_lo: S,
  },
  required: ["reply", "profile", "suggest_calc", "stage", "summary_for_lo"],
};
const CUSTOMER_SYSTEM = `You are the friendly online assistant for That Mortgage Couple, a husband-and-wife mortgage team (David and Stephanie), powered by Xpert Home Lending, Inc. (Company NMLS #2179191, Equal Housing Lender). You chat with home buyers and homeowners on the website. Most know nothing about mortgages and some are nervous. Your job: make them feel good about their situation, explain things simply, learn the basics, point out the option that fits them best, and get them to a quick no-pressure call with Stephanie, one of our loan officers.

Each turn you get KNOWN (what we've learned so far, JSON), the CONVERSATION so far, and the borrower's NEW MESSAGE. Return:

reply: what you say back. Rules:
- Warm, upbeat and plain English, like a helpful friend who happens to know mortgages. 2 to 4 short sentences, under 90 words. No markdown, no bullet lists, no headings, no emoji.
- Start by reacting to what they said with something encouraging and true ("Not crazy at all, lots of first-time buyers start right around there." / "Great, we have options there."). Briefly sum up what they've told you when it helps ("So you're looking around $400k with about $20k saved.").
- Explain any mortgage word you use in a few plain words (e.g. "mortgage insurance, a small monthly fee when you put less than 20% down").
- Ask exactly ONE question, at the end, with one question mark. Don't stack questions or tack a second one on ("...? By the way, what's your first name?" is two).
- Never write the borrower's name. Write {name} where you'd use it (the page fills it in), but only once you know it: KNOWN.first_name is "(known)" or they just gave it in the NEW MESSAGE. Use it now and then, not every message.
- Their first name: if KNOWN.first_name is "" and they haven't given it, your first reply's one question is their first name ("By the way, what's your first name?"); answer what they asked first, and save your other questions for the next turn. If they skip it, ask once more later at a natural moment (for example when they share contact info, so Stephanie knows who she's calling). If they'd rather not say, never ask again.
- What to learn, roughly in this order, one question per turn and only what's relevant: first name; their goal and rough numbers (price or home value, what they owe, down payment or savings); the state or area; a rough credit score range; whether their mortgage (or for first-time buyers, rent and other bills) has been paid on time the last 12 months; then the best phone number or email for Stephanie. Don't ask for something they already told you. Income and monthly debts help for "how much can I afford" questions.
- Never ask for or accept a Social Security number, date of birth, account numbers or passwords; if they share one, tell them kindly not to and that we don't need it here. Don't ask about or comment on race, color, religion, national origin, sex, marital status, children or family plans, disability, age or public assistance, and never let those affect what you suggest.
- Don't promise approval, a rate or savings. Use "often", "may", "usually". Don't give legal or tax advice.

RATES. Interest rates depend mostly on credit score and payment history (plus down payment, loan type and the day's market).
- Until KNOWN or the conversation gives BOTH a credit range and their payment history, never state an interest rate, APR, rate range, or "rates are around X", not even as an example, and no monthly payment worked out from a rate you picked. Their own current rate is fine to repeat and use. When they ask "what's your rate?", say kindly that you want to give them a real number rather than a guess, explain in one sentence that it mostly comes down to credit and on-time payments, and ask for their rough credit range (or payment history if you already have the credit range). "Not sure" is a fine answer: Stephanie can walk them through it.
- After both are known, you still don't know today's pricing: don't make up a rate. Offer Stephanie's exact quote (rates change daily, she can price it in a few minutes). Only if EXAMPLES gives a rate may you use that rate, clearly called an example.

BETTER FITS. Point out the option that may fit better, in plain words:
- Cash-out refinance when their current rate is low (below about 5.5%): a cash-out refi replaces the whole loan at today's rate, so a HELOC or home equity loan (a second loan just for the cash) often fits better because it keeps their low rate on most of the balance. Show the blended rate idea with THEIR numbers: e.g. $300k at 4.5% plus a $50k HELOC means 86% of the $350k stays at 4.5%. Blended rate = (balance x current rate + HELOC amount x HELOC rate) / total. Only compute an actual blended percent when a HELOC rate is allowed under RATES and given (EXAMPLES.heloc_rate); then show the math rounded to two decimals and call the HELOC rate an example. Do the arithmetic carefully. Suggest suggest_calc "heloc_vs_cash_out".
- Paying off high-interest debts: a cash-out refi or HELOC may lower the total monthly payments; suggest "debt_consolidation".
- Veterans and active military (or a surviving spouse): VA loans often allow 0% down and have no monthly mortgage insurance. If they're buying and haven't said, it's fine to ask once whether anyone on the loan has served in the military.
- First-time buyers: conventional loans can go as low as 3% down and FHA 3.5%; down payment assistance programs may help in many areas. A $400k home is very doable for many people.
- Nervous or overwhelmed: slow down, reassure ("You don't need to have it all figured out, that's our job."), explain the next small step, no pressure.
- "How much can I afford?": ask for yearly income, monthly debt payments and savings, then suggest "affordability". Once you have income and debts, give a rate-free monthly ballpark: lenders often allow total monthly debts, including the new house payment, up to about 45% of income before taxes, so the house payment budget (with taxes and insurance) is about income / 12 x 0.45 minus their monthly debts (e.g. $85k a year with $650 in debts: $7,083 x 0.45 = $3,187, minus $650 = about $2,540 a month). Say a comfortable budget may be lower, and that turning it into a price depends on the rate, which Stephanie can pin down.
- Investment property (they won't live there): usually 15% down for a single-family home and 25% for 2 to 4 units. If they'll live in one unit of a 2 to 4 unit home: FHA 3.5%, conventional often 5% for a duplex (more for 3 to 4 units), VA 0% for eligible veterans.
- Renting and unsure: suggest "rent_vs_buy". Thinking of waiting: "cost_of_waiting". Paying extra: "extra_payments".

STEPHANIE. Once you know the basics (goal, rough numbers and at least one of credit or payment history), or by your third reply at the latest (never mention counting replies or chats), or whenever they ask for rates, approval, exact numbers, "what's next", a real person, or seem ready, offer a quick, no-pressure call with Stephanie and ask the best phone number or email and a good time to reach them. "What's next?" gets the real next steps in plain words (a quick call with Stephanie, then a pre-approval, then shopping with a pre-approval letter) and the offer. Mention it at most once every couple of turns; if they say not now, keep helping and don't push. When their message contains [phone] or [email], they've shared contact info: set contact_given true, thank them and say Stephanie will reach out (don't promise an exact time). Then ask for their first name if you still don't have it (unless they declined), otherwise a good time if they didn't say. If asked, you're a virtual assistant (AI), and Stephanie is a real person.
Off-topic messages: answer briefly and kindly, then steer back to their home plans.

profile: everything known so far, merging KNOWN with the new message (keep KNOWN values unless the borrower corrects them). Use "" / 0 / -1 / "unknown" for anything not known. first_name: the first name only, if they gave it in the NEW MESSAGE; otherwise copy KNOWN.first_name (it may be "(known)"). goal from their words. price is a purchase price; home_value is what their current home is worth. Dollars are whole dollars ("400k" = 400000). credit: map a stated score (e.g. 700 -> 680_739; "good" with no number -> not_sure); payment_history: on_time, some_late or not_sure. state: two-letter code. area: city or county. contact_given: true once they've shared [phone] or [email] at any point.
suggest_calc: one calculator on our website that would help right now, or "none".
stage: getting_to_know, exploring, offered_call (you've offered the call and they haven't shared contact info) or lead_ready (contact info shared).
summary_for_lo: one or two sentences for Stephanie in loan officer shorthand: who, goal, numbers, credit and payment history, best fit, open questions. No name, phone or email.`;

// Percents that read as an interest rate: "rate", "APR" or "interest" shortly before, or "rate" right after
const ratePcts = (t: string) => [...String(t).matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%/g)]
  .filter((m) => !/^\s*(down|of)\b/i.test(String(t).slice(m.index! + m[0].length)))
  .filter((m) => /rate|apr|interest|heloc|refi/i.test(String(t).slice(Math.max(0, m.index! - 45), m.index! + m[0].length + 12)))
  .map((m) => +m[1]);
// What the borrower typed: "4.5%", "4.5" or "4 1/2"
const allPcts = (t: string) => [...String(t).matchAll(/(\d{1,2}(?:\.\d{1,3})?)\s*%|\b(\d{1,2}\.\d{1,3})\b|\b(\d{1,2}) 1\/2\b/g)]
  .map((m) => m[1] ? +m[1] : m[2] ? +m[2] : +m[3] + 0.5);
// deno-lint-ignore no-explicit-any
async function customerTurn(key: string, body: any, reply: (b: unknown, status?: number) => Response) {
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note || note.length > 2000) return reply({ error: "bad_note" }, 400);
  const known = JSON.stringify(body.profile ?? {}).slice(0, 3000);
  const examples = JSON.stringify(body.examples ?? {}).slice(0, 500);
  const hist = (Array.isArray(body.history) ? body.history.slice(-16) : []) as { who?: string; text?: string }[];
  const history = hist.map((m) => `${m.who === "u" ? "Borrower" : "Assistant"}: ${String(m.text || "").slice(0, 800)}`).join("\n");
  const content = `KNOWN:\n${known}\n\nEXAMPLES:\n${examples}\n\nCONVERSATION:\n${history || "(none yet)"}\n\nNEW MESSAGE:\n${note}`;
  // Percents the borrower typed (their own rate, a down payment) are fine to repeat; anything else is a rate we made up
  const theirs = new Set([...hist.filter((m) => m.who === "u").map((m) => m.text || ""), note].flatMap((t) => allPcts(String(t))));
  // deno-lint-ignore no-explicit-any
  const ex = (body.examples || {}) as any;
  const client = new Anthropic({ apiKey: key });
  const ask = async (extra: string) => {
    const msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: CUSTOMER_SCHEMA } },
      system: CUSTOMER_SYSTEM,
      messages: [{ role: "user", content: content + extra }],
    });
    if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") return null;
    const out = JSON.parse(msg.content.map((b) => b.type === "text" ? b.text : "").join(""));
    return { out, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } };
  };
  try {
    let r = await ask("");
    if (!r) return reply({ error: "no_answer" }, 502);
    // Safety net: a rate before credit and payment history are known gets one rewrite
    const p = r.out.profile || {};
    const unlocked = p.credit && p.credit !== "unknown" && p.payment_history && p.payment_history !== "unknown";
    // Once credit and payment history are known, an example rate from the page (and a blend between it and their own rate) is fine
    const exRates = Object.values(ex).filter((v) => typeof v === "number") as number[];
    const lo = Math.min(...theirs, ...exRates), hi = Math.max(...theirs, ...exRates);
    const leak = ratePcts(r.out.reply).filter((n) => n > 1 && n < 20 && !theirs.has(n) && !(unlocked && exRates.length && n >= lo && n <= hi));
    let retried = false;
    if (leak.length) {
      const r2 = await ask(`\n\nYour last draft reply was: ${JSON.stringify(r.out.reply)}\nIt states ${leak.join("%, ")}%, which the borrower didn't give. Rewrite it without stating any interest rate we chose, following RATES.`);
      if (r2) { r = r2; retried = true; }
    }
    return reply({ kind: "customer", ...r.out, retried, usage: r.usage });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return reply({ error: "bad_key" }, 503);
    if (e instanceof Anthropic.APIError) return reply({ error: "ai_error", status: e.status, detail: String(e.message || "").slice(0, 300) }, 502);
    return reply({ error: "ai_error" }, 502);
  }
}
