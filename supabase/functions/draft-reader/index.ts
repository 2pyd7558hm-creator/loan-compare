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
  "arm_vs_fixed", "bid_over_asking", "equity", "investment", "paying_cash", "assumptions"];
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
function normalize(out: any) {
  if (out.kind === "question" && txt(out.question)) return { kind: "question", question: txt(out.question), draft: null };
  const d = out.draft || {};
  return {
    kind: "draft", question: null,
    draft: {
      ...d, price: pos(d.price), state: txt(d.state), county: txt(d.county),
      seller_credit_all: pos(d.seller_credit_all), dpa_amount: pos(d.dpa_amount), dpa_rate: pos(d.dpa_rate), rent: pos(d.rent), income: pos(d.income),
      extra_monthly: pos(d.extra_monthly), extra_payments_per_year: pos(d.extra_payments_per_year), assumptions: Array.isArray(d.assumptions) ? d.assumptions : [],
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
    op: { type: "string", enum: ["set_price", "set_location", "update_option", "add_option", "remove_option", "add_calc", "set_refi"] },
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
  - add_calc: calc = one of cow (cost of waiting), rvb (rent vs buy; value = monthly rent if known), aff (affordability; value = yearly income if known), debt (debt consolidation), amort (extra payments; value = extra dollars a month if known), arm (ARM vs fixed), equity (equity and appreciation), invest (investment property), cash (cost of paying cash). Don't add a calculator that's already in FORM.tabs.
  - set_refi: flag true for a refinance, false for a purchase.
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

  let body: { note?: unknown; answers?: unknown; final?: unknown; mode?: unknown; form?: unknown; history?: unknown };
  try { body = await req.json(); } catch { return reply({ error: "bad_json" }, 400); }
  if (body.mode === "chat") return chatTurn(key, body, reply);
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
