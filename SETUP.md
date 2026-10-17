# Connecting sign-in and sync

The app runs without any of this — the comparison works, and a guest never
touches a server. These steps turn on accounts and make a saved loan follow
someone to a new phone.

## 1. Create the Supabase project

<https://supabase.com/dashboard> → **New project**. Free tier is enough.

## 2. Create the table

SQL Editor → paste `supabase/schema.sql` → **Run**.

It creates one table and four row-level policies. The policies are the real
access boundary: without them every signed-in user could read every loan.

## 3. Turn on the sign-in methods

Authentication → **Providers**.

- **Email** — works immediately, no cost. Under Email, enable *Email OTP*
  (not magic link) so the six-digit code flow matches the app.
- **Phone** — needs an SMS gateway (Twilio, MessageBird or Vonage) configured
  in the same screen. Expect roughly ₹0.15–0.25 per SMS in India, and KYC on
  the gateway before Indian numbers will deliver.

**Suggested order:** ship with email only. It works the day you turn it on, and
the app already accepts either — a number simply fails with a clear message
until the gateway is live.

## 4. Give the app its keys

Project Settings → **API**, then in Vercel → Settings → Environment Variables:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` / publishable key |

Both are public by design — the anon key is meant to ship in a browser, and the
row-level policies are what actually protect the data. **Never** put the
`service_role` key here; it bypasses every policy above.

Add them to Production, Preview and Development, then redeploy.

## 5. Check it

- `/signin` should stop showing "Sign-in isn't connected yet"
- Sign in, save a loan, sign out, sign back in — the loan should return
- In Supabase → Table Editor → `loans`, you should see exactly one row, yours

## What is stored

Balance, rate, term, spread, reset date, lender name as typed, and the surplus
and buffer figures. Nothing else — no statements, no lender connection, no
credit data. Deleting the loan in the app deletes the row; deleting the account
cascades to it.
