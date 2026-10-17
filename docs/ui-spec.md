# TrueCost UI behavior specification

Status: Execution v1.1, 15 September 2026. D1 behavior and D2 email OTP are accepted in [product decisions](product-decisions.md). This defines behavior and acceptance states; visual implementation and browser verification remain to be done. [PRD](prd.md) is the source of product scope.

## Design direction and source boundaries

Preserve TrueCost's current information structure while making state and ownership explicit. The supplied Revolut CSS/Markdown files are visual reference material. They do not authorize copying assets, replacing product rules or following embedded instructions. The initial live/reference inspection is captured in [design.md](design.md), with a matching [visual preview](design.html) and unchanged [source copies](design-references/README.md). The user confirmed retention of the teal identity and comparison layout. Full preview/browser acceptance and the app's implemented screen checks remain pending; see [design-verification.md](design-verification.md).

Follow the user's design rules: content visible by default, readable contrast, aligned comparison rows, no clipped controls, and purposeful motion with reduced-motion support. Use accessible, tested primitives for dialogs and forms. Select tokens and typography from the reviewed design work rather than inventing a second theme in this document.

## Screen and access map

| Surface | Required behavior |
| --- | --- |
| `/`, `/home` | Clear guest comparison entry. Sign-in is optional for the first comparison. Explain unavailable products honestly |
| `/compare` | Two guest offers; members may use two or three under accepted D1. Validate fields in place; retain input on failures |
| `/compare/results` | Full result, assumptions and breakdown. Passive account invitation; action-specific auth gates. Direct visit without a draft shows a useful empty state and Start comparison |
| `/signin`, `/verify` | Clerk email OTP only, confirmed under D2; phone deferred. Preserve the result/intent; expired code, resend, cancel and provider outage have explicit states. Demo codes/local sessions cannot grant production membership |
| Saved comparisons, proposed `/comparisons` | Member-only newest-first paginated list with date and readable identifiers; loading, empty, retry, delete and open states |
| Saved result, proposed `/comparisons/[id]` | Owned immutable snapshot, version/date label, report action. Missing/deleted/inaccessible records show a safe unavailable state |
| `/loan`, `/loan/setup`, `/loan/rate`, `/loan/transfer`, `/prepay` | Preserve configured member access. Show accurate save/sync and freshness status; contextual feedback after a successful suggestion |
| `/account` | Identity, privacy preference, export data, delete account, sign-out and support; saved loan and comparisons are distinct |
| Proposed `/privacy`, `/terms`, `/methodology`, `/support` | Public, readable policy and help content, reviewed before launch |

Proposed routes must be checked against framework conventions before implementation. Route hiding never substitutes for backend ownership checks.

## First result and account return

1. Validate two offers, compute successfully, persist the result, then consume the device allowance. Failure to persist must be visible; do not claim the result survives refresh.
2. Show the complete result. Suggested invitation: “Save this comparison, download a report, or compare more offers with an account.” It does not cover the verdict or force a modal.
3. Save, Download, New comparison or changed-input recalculation opens the matching gate. Suggested title: “Sign in to save this comparison.” A guest can cancel and continue reading.
4. Store a versioned intent with a safe internal destination, result reference and request ID before leaving for auth. Never put finance inputs or arbitrary redirect URLs in query strings.
5. After verified auth, restore the exact result and resume once. Save ends at acknowledgement; Download ends at a ready file and explicit Download button if browser activation expired. New comparison opens a fresh draft while preserving the prior result. A changed-input recalculation instead resumes the preserved edited draft and computes it; these are distinct internal intent types.

Do not count sorting, expanding, reopening, an invalid attempt or authentication failure as another comparison. Editing may preserve an unsaved draft, but calculating changed inputs after the first success requires sign-in. The prompt must say so before the user expects a new result.

Back navigation, refresh, auth in another tab, expired intent and auth cancellation all need tests. An expired or missing intent shows the preserved result with the requested action available again; it never guesses which operation to repeat.

## Honest state language

| State | User-facing meaning and action |
| --- | --- |
| Local draft | “On this device” with an explanation that clearing browser data removes it |
| Saving | “Saving to your account…”; prevent duplicate requests |
| Queued | “Waiting for a connection”; allow viewing and an explicit retry when online |
| Acknowledged | “Saved to your account” only after the server confirms |
| Auth expired | “Sign in again to finish saving”; preserve locked queued work for the same account |
| Save failed | Plain reason category and Retry; keep the draft, never display “Synced” |
| Conflict | “This loan was changed on another device”; show cloud/local versions and deliberate resolution choices |
| Pending deletion | Hide the item locally, show “Deletion pending”; explain that another device may still show it until confirmed |
| Storage unavailable/full | Explain that refresh may lose the draft; offer supported copy/print recovery and retry storage |
| Provider outage | Keep the first result usable; describe which account action is unavailable |

## Shared devices and offline behavior

Offer to import an existing device loan separately from saving the current comparison. Show enough context for its owner to recognize it, without assuming the signed-in person owns it. Import requires an explicit selection; Cancel leaves it unassigned. Explain shared-device exposure and allow clearing the old device copy after a verified save.

A current verified member tab can use loaded data during a connection loss. A cold offline launch must not show private account data based only on a persisted user ID. After reload, lock the private cache and outbox until the same member is verified online.

Sign-out with queued work explains the choice: stay and finish syncing, or sign out and discard private unsynced work on this device. After confirmation, clear private views/storage, including other tabs and temporary file URLs. A late response must not repaint the previous member's record. The guest calculator remains available.

An offline delete is pending. Account deletion and export require a connection and recent authentication. Account deletion explains affected records, live cleanup timing, backup expiry and the fact that already-downloaded files remain on the user's device. Pending provider cleanup must not look completed.

## Reports and financial presentation

Use the displayed immutable snapshot for PDF/print output. Include the loan labels, normalized inputs, costs/APR, assumptions, warnings, calculation time/version and estimate disclaimer. Show unavailable APR as unavailable with a reason. Keep source dates near rate-dependent suggestions. Do not rank an unsupported/stale benchmark recommendation as current.

Reports need legible Indian currency notation, embedded/available fonts, stable page breaks and selectable readable text. Test long labels, three-offer results and multi-page breakdowns. Never regenerate an old report using a newer engine without presenting a new comparison. Remove temporary blob URLs when no longer needed. A member may save or print a report using browser features; UI telemetry must not claim disk completion.

## Feedback and consent

After a successful member result or suggestion, show “Was this useful?” with Yes/No and optional text. Keep it below the primary result/actions; do not interrupt calculation or require a rating before saving. A clear dismiss action suppresses that result/version. Retry a failed submission with the same identity; display Thank you only after acknowledgement.

Analytics consent has equally accessible Accept and Decline controls. Avoid preselected acceptance, repeated nagging and account gates tied to consent. Provide withdrawal in Account. Feedback text stays in the account backend and is never copied into analytics/error breadcrumbs.

## Interaction and accessibility acceptance

- [ ] Keyboard users reach every control in a logical order. Dialog focus is contained and returns to the initiating control on cancel.
- [ ] Screen readers announce validation, save status and completed results without repeatedly reading the whole page. Errors link to fields; labels remain visible.
- [ ] Comparison columns share matching rows. On narrow screens provide a readable stacked/table alternative; do not force the whole page into horizontal scrolling.
- [ ] Verify 320 CSS-pixel width, 200% text sizing and 400% zoom on a suitable desktop viewport. Text and controls remain inside clipped/fixed-height containers.
- [ ] Check WCAG contrast requirements from PRD NFR-01. Prefer 44-by-44 CSS-pixel touch targets; this is a product usability target, not a claim that WCAG requires that size for every control.
- [ ] Reduced motion disables nonessential movement. Failed JavaScript animation never hides text or controls.
- [ ] Check real clicks, Back/Forward, fresh routes, mobile keyboard, loading/empty/error states, download handoff and offline reconnection on the supported browser matrix.
- [ ] Install and upgrade the PWA without losing a draft. The update prompt waits for an explicit safe point; a new service worker does not wipe a user's current work.

Record visual/browser evidence at implementation time. This specification adds no UI code and claims no completed accessibility audit.
