# Comparison integration handoff

Status: development-verified subset, 16 September 2026. The candidate passed
427 tests, typecheck, a 17-page build, 11 guest browser checks and 61 connected
development checks. See [verification and remaining gaps](comparison-integration-verification.md).
TASK-007 and TASK-010 remain open for their wider acceptance criteria.

## Gap addressed by this slice

The previous `lib/store.tsx` automatically read and wrote `truecost.compare.v1`
for every viewer and recalculated results from mutable inputs on every visit.
The candidate preserves that legacy key, stores immutable guest results and
durable sign-in handoffs, and partitions member drafts and queued saves by
verified account. Existing Convex save/read/list/delete operations supply
acknowledgements. History and PDF screens remain follow-up work.

## Required behavior

1. Preserve `truecost.compare.v1` untouched as legacy data. Neither a guest nor
   the next member automatically adopts it. Explicit import remains TASK-008.
2. Keep an editable draft separate from the immutable displayed result. Calculate
   on an explicit successful action. A results-page refresh renders the saved
   snapshot without silently running a newer engine.
3. Guests have two offers. Commit their first valid result through the existing
   atomic guest backend. Invalid input and abandoned forms do not spend the
   allowance. An unchanged result can be reopened; edited-input recalculation
   and New comparison require sign-in after the allowance is spent. Members
   may compare three offers.
4. Preserve the selected action, original result and edited guest draft before
   going to sign-in. The guest handoff must survive a refresh during OTP entry,
   expiry, cancellation and a recoverable storage error. Warm in-memory state
   alone does not satisfy the accepted requirement. URL parameters contain only
   bounded action/request references, never finance fields.
5. Claim an intent only for the initiating tab and a currently verified account.
   Load the latest state and serialize transitions; use the existing intent
   expiry, claim lease and stable request ID. Another account, another tab or a
   late callback cannot resume the claimed action. Cancellation preserves the
   public guest result. A member does not automatically load a guest snapshot.
6. Partition private drafts, snapshots and queued comparison saves by verified
   account lifetime. Blank them immediately when that lifetime changes. Cold
   private reload requires online verification. Confirmed sign-out clears all
   private comparison work as well as the loan copy.
7. Save success means a matching Convex receipt. Queue durable account-scoped
   requests offline, replay with bounded retries and deduplication, and show
   failed local persistence honestly. Member history and PDF rendering consume
   the same immutable snapshot; they remain distinct follow-up acceptance work.

## Implementation boundaries

- State and persistence: `lib/store.tsx`, narrowly named guest handoff and
  comparison outbox modules, and focused tests. Reuse snapshot/intent validators
  and existing guest storage rather than duplicating calculation rules.
- Screens: `app/compare/page.tsx`, `app/compare/results/page.tsx`, and only the
  necessary `components/OfferGrid.tsx` actions. Retain the teal comparison table.
- Auth return/sign-out integration: coordinate changes to the auth provider and
  Account page centrally; these files must have one owner at a time.
- Keep finance math and Convex ownership policy unchanged unless a demonstrated
  integration defect requires a reviewed correction.

## Acceptance evidence

Prove first result and unchanged reload; invalid attempts; simultaneous guest
tabs; unavailable storage without a false saved claim; changed-input gating;
cancelled/expired OTP and refresh recovery; member three-offer calculation;
stale A callbacks after B signs in; direct member entry without guest adoption;
offline queued saves and receipt deduplication; and untouched legacy keys.
Use synthetic development accounts for the connected flow. Record model/file
ownership, source hashes, test outcomes and browser limits in the execution log.
Do not mark TASK-007 or TASK-010 complete from helper tests alone.
