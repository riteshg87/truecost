# Private loan screen integration

Status: local integration and the 56-check development browser flow passed. Source is the authorized dirty working tree on `codex/truecost-production`, based on `b9e53c00219f778294a904e9b3175a9bb5bb26c2`, BUILD_ID `Fy3lhWuXWc1vX28Biuvum`. Production acceptance remains open.

## Behaviour

- Loan Health and Account show the controller's queued, sending, confirmed, locked and failure states. An enqueue does not produce a confirmed-save claim.
- Loan setup sends the loan, surplus and emergency buffer in one durable operation. A failed write retains the form. A completed write cannot navigate after the page has unmounted.
- Transfer inputs remain a local draft until Save quote. The rate-resolution action waits for its durable operation and uses the canonical UTC timestamp required by the saved-loan contract.
- Loan deletion requires an explicit choice and keeps the sync status on screen. Sign-out offers Stay and warns about losing queued changes and unsaved quote edits before clearing the private browser copy. Failure to clear storage leaves the session open with recovery copy.
- Private page drafts remount when the verified profile/session/epoch or grant object changes. Prepayment scenarios use the current session only; the old `truecost.prepay.v1` record is neither loaded nor overwritten. Explicit legacy adoption remains TASK-008.
- Connection failures offer Retry connection. Storage failures offer a reload with a warning that unsaved form edits will be lost; durable queued changes remain in storage.

## Observed local checks

`npx vitest run tests/loan-ui.test.tsx`: **13/13 passed**, 16 September 2026. These are mounted component checks using mocked auth and loan state, with the actual timestamp validator. They do not establish real Clerk, Convex or browser-storage behaviour.

The rate-resolution test first failed at 03:13 BST: the screen submitted a date-only string, the contract rejected it, and navigation did not occur. After changing the action to a canonical timestamp, the same test passed. Other checks cover cancelled and confirmed sign-out, storage failure, deletion confirmation, atomic setup payloads, late page completion, account-switch draft clearing and untouched legacy prepayment storage.

A same-account replacement-grant test first failed with the previous draft still
visible. RouteGuard now includes the runtime grant generation in its remount key.
Sign-out controls wait for private storage hydration, with an Opening status,
before accepting confirmation. This covers the early-click path that can return
a locked result before storage opens; the compiled browser rerun passed sign-out.

The expanded browser flow passed **56/56 checks** with no run or cleanup errors.
It exercised synthetic email OTP, account binding, signup, confirmed loan save,
reload, explicit quote save, offline quote queueing, reconnect acknowledgement,
cold offline reload privacy, online restoration, deletion and confirmed sign-out.
The cold reload reached the public fallback without a navigation error and did
not show the private lender. Source/build and provider details are in
[browser evidence](clerk-browser-verification.md). This uses Clerk test email
identifiers, so real mailbox delivery remains unverified.

The initial offline run queued the quote but failed to reconnect. A hook test
reproduced a null token before React processed its online-state update. Consulting
live browser connectivity before and after token acquisition corrected that race;
the later browser run acknowledged the queued 7.8% quote and retained it on reload.

## Design review

Design Better priorities: visible system status (H17/H28), safe cancellation (H21), recovery copy (H32), associated labels (H40), and grouped actions (Law of Proximity). The changes use the existing teal/ink/surface tokens and control spacing. They add no entrance animation, new font, decorative icon, gradient or motion dependency. Loan setup's lender input now has an associated label.

Root inspected the 320px and 390px Account and Loan Health captures from the
44-check run. There was no page overflow, but long account emails were truncated.
Account labels now sit above wrapping values so the full address can be read.
The expanded browser run captured those states after the correction and proved
the full email was present without ellipsis or page overflow at both widths.
Root inspected the updated captures. Keyboard Tab reached the Account sign-out
button. Loan summary styling remains under the existing design.

The existing muted text token failed the normal-text contrast target: 3.62:1
against the light page and 4.15:1 against a dark secondary surface. The app now
uses the already-specified `muted-light` and `muted-dark` design tokens for
`--ink-3`, including both automatic and explicit dark modes. Source-derived
checks pass for all 36 combinations of the three ink tokens and four base
surfaces across the three theme definitions, with a minimum of 5.34:1. See
[contrast evidence](evidence/text-token-contrast.json). This does not establish
contrast for opacity modifiers, gradients, or every other colour pairing.

The changed controls retain the existing palette, type and spacing, keep text
visible without animation, and add no decorative graphics, glows or moving
buttons. Actual browser clicks verified sign-out confirmation, Stay, durable
save, quote save and deletion. Full keyboard, zoom, screen-reader, remaining
screen and dark-render acceptance remain part of the accessibility work; one
successful keyboard target is not complete keyboard-flow acceptance.
No images or evidence have been uploaded.

## Remaining limits

Global comparison storage still needs its own guest/member and resumable-intent integration. Independent finance issues, explicit legacy import, account deletion/export and full cross-tab/cold-offline browser proof remain open. This slice does not establish production readiness or change the deployed reference.
