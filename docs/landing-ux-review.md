# Landing UX review

## Scope

This review compares the current TrueCost welcome screen with the read-only waitlist reference at [truecost-waitlist.vercel.app](https://truecost-waitlist.vercel.app/). The waitlist page supplied useful story beats: before borrowing, after borrowing, prepayment/investment and refinance. Its photo assets and hardcoded savings figures were not reused because their rights and evidence are unknown.

## Product decisions

| Area | Decision | Reason |
| --- | --- | --- |
| First action | **Compare two loans** calls `continueAsGuest()` and routes to `/compare`. | The product contract lets a visitor see the first comparison before asking for an account. |
| Returning state | Ready guests and members route to `/home`; auth loading never redirects. | Returning visitors keep their workspace and do not see a loading-time route jump. |
| Sign in | A plain `Sign in` link targets `/signin?next=%2Fhome`. | It remains available without competing with the guest comparison action. |
| Story | “Before you borrow” compares a headline rate with fees, GST, APR and total cost. | It explains the value without a fake calculator, lender claim or unsupported saving. |
| Saved value | The page says sign-in enables saving, history and reports. | These are real product routes and capabilities; no waitlist collection is needed while the app works. |

## Composition

The page uses one focused statement and one primary action, followed by a simple before/after term ledger, an after-borrowing section linking to Loan health, Prepay or invest, and Transfer / refinance, and a three-part path: Compare, Understand, Keep. A wide reading column works on desktop, while the ledger becomes a readable definition-list flow at 320px. The design keeps the existing teal, Geist, surface and dark-mode tokens. Content is present before any motion, and the only motion is short action feedback with reduced-motion support.

## Evidence and open checks

- The local app owns the comparison, auth, save, history and PDF behavior. The landing screen links into those flows and does not simulate them.
- The waitlist page's couple image, sample cards and ₹31.2L savings claim are reference material only, not approved product evidence.
- The deployed welcome entry is reachable, but deployed comparison/auth/save/PDF parity still needs the central browser review.
- Focused welcome tests cover auth loading, guest entry, ready-state redirects, real sign-in destination and unsupported savings copy.
