# Comparison integration verification

Checked locally on 16 September 2026. This is a development candidate, with the wider TASK-007 and TASK-010 acceptance work still open. The working tree is uncommitted on `codex/truecost-production`, based on `b9e53c00219f778294a904e9b3175a9bb5bb26c2`.

## Implemented behavior

- The first valid guest comparison contains two offers. Invalid input does not consume the allowance. The complete result is an immutable versioned snapshot; a reload does not recalculate it.
- Changed-input recalculation, New comparison and Save preserve their request before sign-in. Edited drafts and the original result survive a sign-in refresh or cancellation. The URL carries an action and request ID, with no finance fields.
- Guest APR previews are hidden while editing, so they cannot bypass the changed-input gate. Members retain live previews and may compare three offers.
- A verified member starts with account-bound state. Guest and legacy device data are not automatically adopted. The legacy `truecost.compare.v1` value is untouched.
- Member drafts and queued saves use durable account partitions. Only a matching Convex receipt with the expected snapshot hash changes the status to Saved. Offline work stays Queued; bounded retries eventually pause.
- Confirmed sign-out clears comparison work and loan work. Stay leaves both intact. Runtime checks and durable generations prevent old callbacks and stale tabs from clearing or applying newer work.
- Sign-in returns use an atomic claim and lease with a stable request ID. Terminal records cannot execute again. Expired unclaimed actions retain bounded public draft recovery for seven days.

## Evidence

| Check | Result |
| --- | --- |
| Full Vitest suite | 427/427 passed across 36 files |
| Typecheck | Passed |
| Production build | Passed, 17 static pages, Next.js 16.3.4 |
| Build ID | `rdBT1wGjLQ1OmSolKhP4p` |
| Guest Chrome check | 11/11, zero page errors; [machine record](evidence/comparison-browser-after.json) |
| Connected Clerk/Convex check | 61/61, zero errors and zero final-run cleanup errors; [separate report](comparison-auth-browser-verification.md) |

Build identity and file hashes are recorded in the [candidate manifest](evidence/comparison-integration-build-2026-09-16.json).

The test suite exercises the actual React comparison provider as well as storage/transport boundaries. It covers first-render account isolation, unchanged reload, edited-draft handoff, explicit save return, receipt-only success, duplicate clicks, cancellation recovery and the real Results screen's automatic return. A previously intermittent one-second UI wait passed in isolation, in the paired UI run and in the final full suites; a connected browser check remains the stronger integration evidence.

The private workspace checks include concurrent pumps with one network send, expired lease recovery using the original request ID, the eight-attempt retry limit, seven-day replay expiry, queue capacity, late acknowledgement after discard and a stale-tab discard with BroadcastChannel unavailable. Transport tests reject malformed or oversized snapshots before token/network access and reject mismatched receipts. Handoff checks cover wrong tab/account/epoch, expiry, cancellation, terminal cleanup and corrupt storage.

Browser verification of the earlier candidate exposed premature verification redirects and public form remounts during auth startup. Four regression assertions reproduced these defects. The corrected provider restores pending email before reporting readiness, preserves public form lifetimes, and retains account-specific private remounts. The final full suite and rebuilt artifact include those fixes. No dependency, finance-engine or Convex policy change was required by this slice.

## Visual and interaction review

The 390px [before](evidence/comparison-before-390.png) and [after](evidence/comparison-after-390.png) captures use the same synthetic two-offer inputs. Root also inspected the [320px sign-in return](evidence/comparison-signin-after-320.png). The first result, gutters and added controls remain readable without horizontal page overflow. The browser clicked calculation, edit, gated recalculation and cancellation, then verified a reload retains the edited rate and the original result.

The added status and cancellation surfaces use the existing teal tokens, body type, a stationary primary action and text secondary actions. Status is written in words and announced politely. New controls have visible focus styles and 44px minimum height. No new font, decorative icon, glow, shadow, marketing section, clipped shape or entrance animation was introduced. The approved retention of the existing identity governs this refinement; pre-existing result styling is not claimed to have received a complete redesign. The system preview already specifies these save/loading/error roles, so no token change was necessary.

## Acceptance still open

The current integrated browser refresh in `evidence/comparison-history-browser.json` passed 24 checks, including desktop and 390px warm-offline PDF download with stored-value parity, queued deletion mirrored to a second tab, cold private history locking, reconnect deletion and two-account isolation. The remaining items below describe the broader release matrix rather than a failure of that scoped run.

- A private history interface, PDF generation and the download return action.
- A user recovery path for permanently paused jobs, complete storage-quota failure UI evidence and explicit legacy import.
- Real-browser duplicate-tab identity behavior, the full concurrent account-switch matrix, cold private comparison reload checks and longer interrupted-action recovery.
- Real OTP delivery, Safari/Firefox and assistive-technology coverage.
- Identify and remove synthetic comparison rows possibly left by two earlier token-cleanup failures. Their disposable Clerk users were deleted; the final run cleaned its own rows. Preserve the failed evidence until this audit is resolved.
- Mixpanel app integration/dashboard verification, optional feedback, account export/deletion and operational recovery.
- Financial-methodology approval, domain and eligible commercial hosting under the ₹0 budget, and all production release approvals.

Cold private access depends on the auth provider withholding a verified runtime grant until online verification succeeds. This is an application access boundary, not encryption of local browser storage. A warm verified session may use its partition offline.

No commit, push, production deployment, provider-plan change or purchase was made. Synthetic development checks do not establish release readiness.

## Capacity handoff (historical; resumed 16 September 2026)

The weekly account limit reached 95% consumed during this verification wave.
The configured stay-within-limits skill pauses new features at that threshold;
the current comparison check and evidence handoff are finished. The active
goal remains incomplete. The thread heartbeat
`resume-truecost-when-usage-clears` checks hourly and stays quiet while capacity
is unchanged. Its recorded reset estimate is 19 September 2026 at 14:58:12 UTC
(15:58 BST, 20:28 IST); it must check actual limits before resuming. No reset
credit was redeemed at that checkpoint. The user subsequently explicitly
authorized the available reset credit; the first-party tool confirmed its
redemption and 0% weekly usage. Authorized work resumed and the hourly heartbeat
was paused to avoid duplicate resumptions. The earlier reset estimate is obsolete.

On resumption, read this report and the connected browser report first, resolve
any failed comparison acceptance/cleanup, then select the next dependency-ready
slice from the roadmap. Do not count this checkpoint as a production release.
