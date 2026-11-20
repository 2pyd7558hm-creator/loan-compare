# Loan comparison tool – That Mortgage Couple

Side-by-side mortgage comparisons for That Mortgage Couple, powered by Xpert Home Lending, Inc. (Company NMLS #2179191).

| File | What it is |
| --- | --- |
| `index.html` | Public calculator. Nothing is saved. Can also be pasted into a LenderHomePage custom-code page. |
| `workspace.html` | Loan officer workspace: sign in, save a client with several calculator tabs, turn on a private read-only client link (`workspace.html?c=<token>`, or `&t=<tab id>` to open one tab). |
| `calcs.js` | The hub's calculators beyond the loan comparison: cost of waiting (purchase and refinance), rent vs buy, affordability, debt consolidation (with blended rate), extra payments. Also the FHFA state home price figures. |
| `supabase/001_schema.sql` | Database tables and row-level security rules (already applied to the Supabase project). |
| `supabase/002_fee_templates.sql` | Shared closing-cost (fee) templates, with the starting templates copied from the team's existing ones. |
| `supabase/003_hub_tabs.sql` | Client link returns only the tabs marked "Borrower sees this tab". Run once in the SQL editor. |

## How it works

- Hosted free on GitHub Pages from the `main` branch.
- Saved comparisons live in Supabase (project `tmc-loan-compare`). The key in `workspace.html` is the **publishable** key, which is designed to be public; row-level security decides what each person can see.
- Only invited staff can sign in (open sign-ups are off). A new loan officer needs an invite in Supabase → Authentication → Users, then a row in the `staff` table.
- Clients never sign in. They only see a comparison while its sharing switch is on, and never see the client email or private notes.

## Branding

Colors are the CSS variables at the top of each page's `:root`. Company name, NMLS numbers, phone and address are in the `BRAND` object in the script.
