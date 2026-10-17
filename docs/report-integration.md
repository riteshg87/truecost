# Report integration verification

## Scope

`ComparisonReportActions` is the member-facing report action for a validated
comparison snapshot. It accepts `source: "current" | "saved"` and an optional
verified `PrivateSessionAccess`. It does not save a PDF, upload finance data,
open a popup, or recalculate the comparison.

The user must press **Generate PDF**. Rendering happens in the browser and the
result becomes a temporary object URL only after the renderer returns a Blob.
The ready state exposes a normal download link. A renderer failure keeps the
validated result visible and offers a print action containing the stored
figures, fee inputs, assumptions, warnings, versions and disclaimer.

## Privacy and lifecycle rules

- A missing or stale private grant is locked before rendering. The locked view
  does not render the private HTML fallback or a print action.
- The hook rechecks the grant after the asynchronous renderer boundary and at
  the download click. A late Blob from an old account, snapshot, request, or
  unmounted component is discarded.
- Each generate request has its own request fence, so an older completion
  cannot replace a newer PDF.
- Print fallback is scoped to the grant and snapshot that produced the error;
  the print click rechecks the grant and removes the fallback if it has gone
  stale.
- Object URLs are revoked on snapshot or grant replacement, unmount, and
  invalidation. A URL is returned to the component only while both its snapshot
  and grant identity match.
- No report bytes are persisted in browser storage or sent through a service
  worker or Convex.

## Automated evidence

Command: `npx vitest run tests/report-lifecycle.test.tsx`

Observed: **10 tests passed**, root rerun at 10:45 on 16 September 2026. The tests cover explicit generation, ready URL
creation, snapshot replacement and revocation, late account invalidation,
cold-reload lock behavior, renderer failure with printable fallback, grant
scoping, print denial after grant invalidation, and unmount cancellation. The
fallback assertion checks lender text from the real snapshot model rather than
a mocked status alone. Root review additionally found that the fallback text used
the error status alone, while its print button used the current grant. Both now
use the grant-scoped eligibility check. A regression verifies that an invalid
grant hides lender figures on the next render without waiting for the timer or
requiring a print click. Further tests dispatch a real cancelable download click
after grant expiry and resolve two render requests out of order. The expired
click is prevented and its URL revoked; only the newer request creates a URL.

TypeScript validation should be run with `npx tsc --noEmit --pretty false` as
part of the integrated candidate check.

## Integration limits

The existing disposable-account history browser harness now accepts
`TRUECOST_CHECK_REPORTS=1`. With its required reviewed build ID, this invokes
`scripts/check-report-download.mjs`: it clicks Generate, waits for the separate
Download action, captures the actual PDF, and checks selectable lender text and
EMI/repayment against the server snapshot. It records bytes, SHA-256, page count
and a single desktop generation duration. The current integrated browser run is
recorded below.
This check does not establish complete report parity, mobile timing or visual
page-break quality.

This slice proves the mounted member action and hook lifecycle with a deferred
renderer. Browser acceptance of the final integrated routes, mobile download
activation, print layout, offline font cache behavior, and report generation
analytics remains an integration task. The PDF core's parser and visual
evidence are recorded in [pdf-core-verification.md](pdf-core-verification.md).

## Development browser checkpoint, 16 September 2026

Build `Rr-zOTtAaJ1_44wPrp-yX` passed production compilation and TypeScript. Analytics remained disabled. The history/report browser harness passed 22 checks using two disposable Clerk accounts and the existing Convex development target; owned comparison rows and identities were cleaned up with no reported cleanup errors.

A fresh Generate PDF action followed by a separate Download PDF click produced `docs/evidence/report-browser-saved.pdf`: 32,850 bytes, two pages, SHA-256 `b33f6cc61aa9b4c303fb91085ab8ad3f5060a6918d478e5fb19632fce82e845f`. PDF text matched the stored lenders, EMI and total repayments. Generation took 2,124 ms in this desktop Chrome sample, not a mobile percentile measurement.

Root rendered and inspected both actual downloaded pages (`report-browser-saved-1.png` and `report-browser-saved-2.png`). Values, rupee glyphs and text were legible with no observed clipping. The disclaimer occupies a sparse second page; pagination polish remains desirable. The financial-warning wording still requires the separate methodology review.

Evidence: `docs/evidence/comparison-history-browser.json`. Build and browser evidence apply to this checkpoint; analytics and feedback edits continue afterward. Mobile report downloads, cold/warm offline font availability, print fallback layout and browser failure recovery remain open. TASK-012 is not complete.

## Narrow viewport and warm offline checkpoint

The extended run at 10:38 UTC passed 24 checks on the same build. After online report generation, client-side navigation preserved loaded report modules/fonts; a verified tab at 390 x 844 then generated and downloaded its saved report offline. Stored lender/EMI/repayment parity passed. Root inspected `report-browser-390px-warm-offline.png`: the download control and status were visible without clipping. Offline PDF: 32,851 bytes, two pages, SHA-256 `0da44cafa5f61c7d9dbeb78b1273d2684e3f8251ffbc70344c309c50c402c8cc`, 647 ms sample generation. This is desktop Chrome viewport emulation, not a physical phone or percentile claim.

The earlier full-navigation variant failed to reach a ready PDF; its evidence remains `report-offline-after-navigation-failed-20260916.json`. It did not prove asset availability or capture the underlying error, so it establishes a pending cold-asset/fallback case, not a verified diagnosis. The successful warm case does not erase this gap. The checker now captures report status and a screenshot on failure. Original desktop evidence/PDF are preserved as `report-desktop-browser-20260916.json` and `.pdf`; the live report-browser-saved.pdf is from the latest run.

## Current integrated report refresh, 3 October 2026

With `TRUECOST_CHECK_REPORTS=1`, the current candidate `ydMzVTyEiY_q6uNn7FXx1` passed 24 checks at `2026-10-03T00:55:32.776Z` in Chrome 154 / Playwright 1.62.1. The run downloaded a saved report through a fresh click on desktop and at 390px warm offline, verified stored lender and EMI/repayment text parity in both two-page PDFs, kept the warm-offline download control inside the viewport, and completed the existing history, multi-tab, two-account isolation and cleanup checks. The desktop sample took 614 ms (32,914 bytes) and the warm-offline sample took 245 ms (32,921 bytes). Evidence: `docs/evidence/comparison-history-browser.json`. This closes the tested report/browser slice. Cold private report reload, print layout, physical-device performance and the wider PWA/accessibility matrix remain open. The normal analytics-disabled configuration was preserved; no deployment, commit or push occurred.
