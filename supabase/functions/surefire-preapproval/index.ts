// Supabase Edge Function: surefire-preapproval
// Receives Surefire's outbound contact webhook (CRM Settings > Webhooks) and adds or updates that borrower
// on the pre-approval letter desk (preapproval.html). Imported borrowers always arrive as "confirm limits":
// staff must check the numbers and the expiration date before any letter can be made for them.
//
// Deploy without JWT checks (Surefire can't sign in):  supabase functions deploy surefire-preapproval --no-verify-jwt
// Secret:  SUREFIRE_WEBHOOK_TOKEN  (any long random string; paste the same value into Surefire's webhook screen)
// Surefire can send it as a query token (?token=...), a request header token (any header), or Basic auth password.
import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const TOKEN = Deno.env.get("SUREFIRE_WEBHOOK_TOKEN") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function authorized(req: Request): boolean {
  if (!TOKEN) return false;
  const url = new URL(req.url);
  const candidates = [url.searchParams.get("token") ?? ""];
  for (const [k, v] of req.headers) {
    if (k === "authorization") {
      const [scheme, val = ""] = v.split(" ");
      if (/^bearer$/i.test(scheme)) candidates.push(val);
      if (/^basic$/i.test(scheme)) { try { candidates.push(atob(val).split(":").slice(1).join(":")) } catch { /* ignore */ } }
    } else candidates.push(v);
  }
  return candidates.some((c) => safeEqual(c.trim(), TOKEN));
}

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[$,%\s]/g, "")); return isFinite(n) && n > 0 ? n : null; };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// "Jane Doe" + co-borrower "John Doe" -> "Jane & John Doe"; different last names -> "Jane Doe & John Smith"
function borrowerName(c: Record<string, unknown>) {
  const f = str(c.firstName), l = str(c.lastName), cf = str(c.loanCoborrowerFirstName), cl = str(c.loanCoborrowerLastName);
  const main = [f, l].filter(Boolean).join(" ") || str(c.fullName);
  if (!cf) return main;
  if (!cl || cl.toLowerCase() === l.toLowerCase()) return [f, "&", cf, l].filter(Boolean).join(" ");
  return `${main} & ${cf} ${cl}`;
}
function loanType(raw: string) {
  const t = raw.toLowerCase();
  if (t.includes("fha")) return "FHA";
  if (/\bva\b/.test(t) || t.includes("veteran")) return "VA";
  if (t.includes("usda") || t.includes("rural")) return "USDA";
  if (t.includes("jumbo")) return "Jumbo";
  if (t.includes("non-qm") || t.includes("nonqm") || t.includes("non qm")) return "Non-QM";
  if (t.includes("conv")) return "Conventional";
  return raw || "Conventional";
}
function term(c: Record<string, unknown>) {
  const m = num(c.loanTermMonths);
  const arm = /arm|adjust/i.test(str(c.loanAmortizationType)) || !!str(c.loanARMProgram);
  if (!m) return "30 Year Fixed";
  const yrs = Math.round(m / 12);
  return arm ? `${yrs} Year ARM${str(c.loanARMProgram) ? " (" + str(c.loanARMProgram) + ")" : ""}` : `${yrs} Year Fixed`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  if (!authorized(req)) return reply(401, { error: "unauthorized" });
  let body: unknown;
  try { body = await req.json(); } catch { return reply(400, { error: "body is not JSON" }); }
  // Surefire may send one contact or a list of them
  const contacts = (Array.isArray(body) ? body : [body]).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  const results = [];
  for (const c of contacts) {
    const surefireId = str(c.id) || String(c.id ?? "");
    if (!surefireId) { results.push({ skipped: "no contact id" }); continue; }
    const price = num(c.loanPurchasePrice) ?? num(c.loanPropertyValue);
    const loan = num(c.loanAmount);
    let ltv = num(c.loanLTV);
    if (ltv && ltv <= 1.5) ltv = Math.round(ltv * 10000) / 100;              // 0.965 -> 96.5
    if (!ltv && price && loan) ltv = Math.round((loan / price) * 10000) / 100;
    const today = new Date();
    const { data: existing } = await sb.from("preapproval_borrowers").select("id,data").eq("surefire_id", surefireId).maybeSingle();
    const prev = (existing?.data ?? {}) as Record<string, unknown>;
    const data = {
      ...prev,
      name: borrowerName(c),
      loanType: loanType(str(c.loanType) || str(c.loanProduct)),
      maxPrice: price, maxLoan: loan, maxLtv: ltv,
      term: term(c),
      rate: prev.rate || "Floating",
      approvedOn: prev.approvedOn || isoDay(today),
      expiresOn: prev.expiresOn || isoDay(new Date(today.getTime() + 90 * 864e5)),
      loanNumber: str(c.loanFileNumber) || prev.loanNumber || "",
      verified: prev.verified ?? [0, 1, 2, 3, 4],
      need: prev.need ?? [5, 6],
      source: "surefire",
      surefireId,
      surefire: {                                              // what Surefire sent, shown to staff while they confirm
        receivedAt: today.toISOString(),
        loanStatus: str(c.loanStatus), preApproval: c.loanPreApproval ?? null,
        loanAmount: loan, purchasePrice: price, ltv, loanType: str(c.loanType), loanProduct: str(c.loanProduct),
        buyingAgent: str(c.loanBuyingAgentFullName), buyingAgentEmail: str(c.loanBuyingAgentEmail),
        owner: str((c.user as Record<string, unknown> | undefined)?.fullName),
      },
      needsReview: true,                                       // every import (and every change) must be confirmed by staff
      updatedAt: today.toISOString(),
    };
    const row = { name: data.name, data, surefire_id: surefireId };
    const { error } = existing
      ? await sb.from("preapproval_borrowers").update(row).eq("id", existing.id)
      : await sb.from("preapproval_borrowers").insert(row);
    results.push(error ? { surefireId, error: error.message } : { surefireId, ok: true, updated: !!existing });
  }
  const failed = results.some((r) => "error" in r);
  return reply(failed ? 500 : 200, { results });
});
