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

const num = { anyOf: [{ type: "number" }, { type: "null" }] };
const str = { anyOf: [{ type: "string" }, { type: "null" }] };
const OPTION = {
  type: "object", additionalProperties: false,
  properties: {
    type: { anyOf: [{ type: "string", enum: ["conv", "fha", "va", "jumbo"] }, { type: "null" }] },
    term: num, arm: { type: "integer", enum: [0, 3, 5, 7, 10] },
    rate: num, points: num, down_pct: num, buydown: { type: "integer", enum: [0, 1, 2, 3] },
    seller_credit: num, second_amount: num, second_rate: num,
  },
  required: ["type", "term", "arm", "rate", "points", "down_pct", "buydown", "seller_credit", "second_amount", "second_rate"],
};
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["question", "draft"] },
    question: str,
    draft: {
      anyOf: [{ type: "null" }, {
        type: "object", additionalProperties: false,
        properties: {
          refi: { type: "boolean" }, condo: { type: "boolean" }, jumbo_all: { type: "boolean" },
          price: num, state: str, county: str,
          options: { type: "array", items: OPTION },
          seller_credit_all: num, dpa_amount: num, dpa_rate: num,
          rent: num, income: num, extra_monthly: num, extra_payments_per_year: num,
          cost_of_waiting: { type: "boolean" }, debts: { type: "boolean" }, extra_payments: { type: "boolean" },
          arm_vs_fixed: { type: "boolean" }, bid_over_asking: { type: "boolean" }, equity: { type: "boolean" },
          investment: { type: "boolean" }, paying_cash: { type: "boolean" },
          assumptions: { type: "array", items: { type: "string" } },
        },
        required: ["refi", "condo", "jumbo_all", "price", "state", "county", "options", "seller_credit_all", "dpa_amount", "dpa_rate",
          "rent", "income", "extra_monthly", "extra_payments_per_year", "cost_of_waiting", "debts", "extra_payments",
          "arm_vs_fixed", "bid_over_asking", "equity", "investment", "paying_cash", "assumptions"],
      }],
    },
  },
  required: ["kind", "question", "draft"],
};

const SYSTEM = `You read short notes that mortgage loan officers type to set up a loan comparison for a client, and turn them into structured fields.

The note never contains the client's real name or street address: they appear as "Client A" and "[street address]". Ignore them.

Fill the draft like this:
- options: one entry per loan option the note describes, in the order written, at most 4. "vs", commas, "then", "and" and line breaks can all separate options; a down payment followed by a rate ("20% down, 7.375%") is ONE option. If the note says "N scenarios", return exactly N options. If the note describes no options, return an empty list.
- type: "conv" (conventional), "fha", "va" or "jumbo". null if not stated. A jumbo note with several options: every option is jumbo.
- term: loan term in years (30, 25, 20, 15, 10). For an ARM, term is the full loan term (usually 30), and arm is the fixed period: "7/6 ARM" or "7 year ARM" is arm 7; a bare "ARM" is 7. A fixed-rate loan has arm 0.
- rate: the note rate in percent, ONLY if the note states it. Never guess a rate: use null.
- points: discount points ("1 point" = 1, "no points" = 0); null if not stated.
- down_pct: down payment as a percent of price. Convert dollar down payments using the price. null if not stated.
- buydown: temporary buydown, 2 for "2-1", 3 for "3-2-1", 1 for "1-0", else 0.
- seller_credit / second_amount / second_rate per option only when the note ties them to one option; otherwise use seller_credit_all (dollars; convert percents using the price) and dpa_amount / dpa_rate (down payment assistance or a 2nd mortgage). second_rate null means deferred.
- price: purchase price or home value in dollars ("750k" = 750000, "1.5M" = 1500000).
- state: two-letter code. county: the county name without the word "County".
- refi: true for a refinance. condo: true for a condo.
- Calculators to add, true only when the note asks for or clearly implies them: cost_of_waiting ("wait", "waiting"), debts (paying off debts, consolidation), extra_payments (extra or faster payoff; also set extra_monthly in dollars or extra_payments_per_year as a count), arm_vs_fixed (an ARM compared with a fixed loan), bid_over_asking (offering over asking), equity (equity or appreciation), investment (rental or investment property), paying_cash (paying cash, an all-cash purchase or a cash offer). rent and income are monthly rent and yearly income in dollars when stated.
- assumptions: short plain-English notes about anything you had to read loosely, for the loan officer to check. Empty if none.

Ask ONE short question (kind "question", draft null) only when a missing detail would change the comparison and a sensible default would likely be wrong. The main cases:
- the loan amount (price minus down payment) is over $832,750 and the state or county is missing, because it decides conforming, high balance or jumbo: ask which state and county;
- you can't tell how many options there are or which details belong to which option;
- there is no price or home value at all.
Don't ask about rates, points, fees or anything the loan officer can easily fix on the cards. When the message says no more questions, always return a draft, using sensible defaults and listing them in assumptions.
Otherwise return kind "draft" with question null.`;

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

  let body: { note?: unknown; answers?: unknown; final?: unknown };
  try { body = await req.json(); } catch { return reply({ error: "bad_json" }, 400); }
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
    const out = JSON.parse(text);
    return reply({ ...out, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return reply({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return reply({ error: "bad_key" }, 503);
    if (e instanceof Anthropic.APIError) return reply({ error: "ai_error", status: e.status }, 502);
    return reply({ error: "ai_error" }, 502);
  }
});
