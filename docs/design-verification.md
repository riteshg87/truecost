# Design specification verification

Date: 15 September 2026. Scope: TASK-004 reference analysis and local specification preview, not an app redesign or release audit.

## Evidence

- User accepted retaining TrueCost's teal identity and comparison-table layout, with contrast, spacing, sign-in-state and restrained-motion improvements.
- Inspected live landing, guest home, comparison form and result using two synthetic ₹50 lakh offers. The form currently shows untouched-field errors and allows a guest third offer; the result lacks the planned save/download actions. These are implementation work, not repaired by this document.
- Read both supplied Revolut reference files. SHA-256 checks showed the later `(1)` copies were byte-identical. [Source copies and hashes](design-references/README.md) are retained unchanged.
- Wrote [design.md](design.md) with 28 color tokens, seven type levels, three radii, eight spacing steps, 14 component/state entries and eight canonical sections. Generated [design.html](design.html) from the written token block; token serialization round-trip passed.
- Checked 22 text/background token pairs; minimum ratio 5.53:1. Corrected the color-swatch labels; all 28 swatches now use readable foreground pairings, minimum 6.37:1. These measurements do not establish app-wide WCAG compliance.
- Preview includes the existing build's Latin Geist font and the upstream SIL Open Font License. No Revolut font or brand asset was embedded.
- Opened the local preview at `http://127.0.0.1:8473/design.html`. Inspected the light component view. Four enabled button variants updated the explicit local preview message; two editable input specimens accepted input. The disabled button was exposed as disabled. Corrected an invalid-input specimen that had mistakenly shown a valid amount.

## Follow-up browser checks

A fresh tab on the same Chrome connection recovered control. The sign-in specimen updated its explicit preview-only message. Both the APR explanation and font licence disclosures opened; pressing Enter closed the focused licence disclosure. Selecting Dark changed the preview appearance, and its lower component area remained legible in the inspected screenshot.

At a 320 by 800 viewport, the opening screen retained readable text and gutters. DOM measurements reported a 305px page content width, with no page-level horizontal overflow, and all 11 button/input/select/disclosure controls measured at least 44px high and stayed within the viewport. A later narrow-screen component capture rendered at an unusably small scale, so these measurements are not a complete visual inspection of the mobile page. Restored the normal viewport and Light appearance afterward.

## Remaining acceptance

A further 320px browser pass produced usable light and dark screenshots of the comparison row, dialog specimen and disclosure. Corresponding APR values stayed aligned; the inspected text and controls had visible gutters and no cropped edges. Tab followed by Enter collapsed the APR disclosure. All four enabled Save comparison specimens responded to pointer activation. Browser zoom shortcuts did not produce a verifiable 200% state, so no zoom pass is claimed. Reset the viewport and returned to Light after inspection.

Keyboard follow-up: starting from the primary action, Tab moved through the next enabled buttons, skipped the disabled specimen, reached the three labelled inputs, the sign-in specimen and both disclosures in document order. All these focused controls had a visible two-pixel teal outline with a two-pixel offset. Buttons/disclosures measured at least 44px high; inputs were 50px and the sign-in specimen 48px. This verifies that section's traversal, not a screen-reader or whole-app audit.

The opening documentation link and appearance selector were also reachable by Tab. Down/Enter selected Dark; Up/Enter restored Light. The focused dark-theme selector used the specified two-pixel light-teal outline. The preview remains in its normal viewport and Light appearance.

16 September follow-up: at 320 by 740, a document-wide bounds check found no element extending beyond the viewport in either Light or Dark (305px document content width). Additional screenshots showed the reference prose, color swatches, final component specimens and footer with readable gutters. This extends the inspected mobile coverage; it does not establish text zoom or reduced-motion behavior. The normal viewport and Light appearance were restored.

Complete mobile visual inspection, 200% zoom and reduced-motion verification remain pending. The dialog specimen demonstrates styling and an explicitly simulated action; it is not evidence of a working modal focus trap. No complete responsive, accessibility or design-rule pass is claimed. TASK-004 remains open until those checks and the required screen/state review are finished.

The existing app's rendering, provider integration, live financial caveats and accessibility require separate implementation evidence. The preview is a style reference; its buttons explicitly simulate an action and never save or sign in.

## Current source-equivalent browser evidence: 4 October 2026

The current checkout passed 13 landing checks and 7 guest-results checks in Chrome 154 / Playwright 1.62.1. The checks cover desktop/mobile geometry, theme persistence, keyboard paths, reduced-motion timing, semantic table headers, numeric cell completeness and keyboard horizontal scrolling. This is acceptance evidence for behavior and layout; visual owner review, authenticated coverage, device coverage and production acceptance remain open.
