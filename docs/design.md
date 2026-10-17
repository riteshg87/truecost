---
version: "alpha"
name: "TrueCost"
description: "A clear home-loan comparison ledger for borrowers in India."
colors:
  background-light: "#F7FAF8"
  surface-light: "#FFFFFF"
  inset-light: "#EAF0EC"
  ink-light: "#17221D"
  muted-light: "#526359"
  accent-light: "#0C6B62"
  on-accent-light: "#FFFFFF"
  accent-hover-light: "#09594F"
  focus-light: "#0C6B62"
  error-light: "#A52A3A"
  warning-light: "#805005"
  success-light: "#175E42"
  disabled-light: "#DCE5DF"
  on-disabled-light: "#4A5C50"
  background-dark: "#101613"
  surface-dark: "#19221D"
  inset-dark: "#25332B"
  ink-dark: "#EDF3EF"
  muted-dark: "#ABBDB1"
  accent-dark: "#81C3B7"
  on-accent-dark: "#102D26"
  accent-hover-dark: "#A0D2C8"
  focus-dark: "#A0D2C8"
  error-dark: "#FFADB5"
  warning-dark: "#EBC27F"
  success-dark: "#AAD3B6"
  disabled-dark: "#34463B"
  on-disabled-dark: "#BECBC2"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.15
  h1:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 650
    lineHeight: 1.25
  h2:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
  caption:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  amount:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    lineHeight: 1.3
rounded:
  control: "0.5rem"
  surface: "0.75rem"
  dialog: "1rem"
spacing:
  4: "0.25rem"
  8: "0.5rem"
  12: "0.75rem"
  16: "1rem"
  20: "1.25rem"
  24: "1.5rem"
  32: "2rem"
  48: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.on-accent-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover-light}"
    textColor: "{colors.on-accent-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
    height: "2.75rem"
  button-primary-focus:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.on-accent-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
    height: "2.75rem"
  button-primary-disabled:
    backgroundColor: "{colors.disabled-light}"
    textColor: "{colors.on-disabled-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
    height: "2.75rem"
  button-secondary:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.accent-light}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
    height: "2.75rem"
  input-default:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
    height: "2.75rem"
  input-focus:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
    height: "2.75rem"
  input-error:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.error-light}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
    height: "2.75rem"
  status-queued:
    backgroundColor: "{colors.inset-light}"
    textColor: "{colors.muted-light}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
  status-saved:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.success-light}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
  status-error:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.error-light}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    padding: "{spacing.12}"
  comparison-row:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.surface}"
    padding: "{spacing.16}"
  dialog:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.dialog}"
    padding: "{spacing.24}"
  details:
    backgroundColor: "{colors.inset-light}"
    textColor: "{colors.ink-light}"
    typography: "{typography.body}"
    rounded: "{rounded.surface}"
    padding: "{spacing.16}"
---

# TrueCost Design System

## Overview

The first release retains TrueCost's teal identity and aligned comparison table, as the user confirmed on 15 September 2026. Its signature is the real loan ledger: two or three offers share the same metric rows, with the cost difference explained beside them on wide screens and above them on phones. The interface should feel precise, calm and useful when someone checks a sanction letter on their phone. This specification is a refinement target; it does not claim the current deployment has these tokens or completed account features.

Reference inspection used the live landing, guest home, comparison form and result at truecost-lac.vercel.app, plus revolut-design-system.md and revolut-tokens.css supplied in Downloads. Unchanged reference copies are archived under docs/design-references; the later (1) copies were verified identical. Synthetic offers were ₹50,00,000 over 20 years, rates 8.5% and 8.6%, and processing fees 0.5% and 0.25%. The live result showed APR 8.58% and 8.64% and a ₹61,324 borrowing-cost gap; these are observed reference outputs, not an independent finance validation. Revolut supplies ideas about hierarchy and state clarity, not its logo, artwork, magenta palette or commercial Aeonik typeface.

## Colors

Keep the existing light-theme teal accent #0C6B62. Move the page neutrals toward the same green family, with separate light and dark values; this reduces the blue cast of the current dark panels without changing the product identity. Use ink for financial figures and text, muted only for secondary explanations, and accent for a selected action or meaningful emphasis. Error, warning and success always have words or a symbol as well as color. The tokens ending in -light define component defaults; switching theme substitutes the matching -dark token by semantic name.

The generated preview checks normal text pairs at 4.5:1 or better. Focus uses a two-pixel solid ring with a two-pixel offset and at least 3:1 against the adjacent surface. These token checks do not replace contrast testing of the actual rendered app, including disabled, hover and error states.

## Typography

Retain the existing Geist family for continuity and reserve its stronger weights for the verdict and primary amounts. Use tabular numerals for aligned money and rates, with normal character spacing; do not make all labels monospace. Body text starts at 16px, with 13px reserved for optional captions, never essential input instructions. The display role is 32px and should fit one or two deliberate lines rather than a tall headline stack.

The preview embeds the existing build's Latin Geist font and includes its SIL Open Font License. A system fallback remains available for unsupported glyphs such as the rupee symbol. The production font-loading strategy and PDF character coverage still need their own verification. No new paid font licence is required by this specification.

## Layout

Use a 4/8/12/16/20/24/32/48px rhythm, with 16px page gutters on narrow screens and 24px from 768px upward. Keep forms near 760px and full results near 1160px; the ledger should get more width than its explanation on desktop. At 320px, compare the same metric across offers in an accessible contained table or switch to a labeled stacked view with a working comparison control; never make the entire page scroll sideways. Reserve shared rows for labels, values and errors so long lender names cannot shift their neighbours.

Allow input rows to grow for validation and 200% text sizing. A bottom action bar must reserve its own space, include the device safe-area inset and stay clear of the keyboard. Use a quiet single primary action followed by text actions when several choices exist. Do not stretch the landing page with a large unexplained gap before the guest action.

## Elevation & Depth

Place the finance ledger on the surface tone and nested explanations on inset. Space and weight should separate most content; avoid an outline and drop shadow on every row or card. Reserve one tight directional shadow for an actual dialog or popover, with no glow or duplicate box behind it. This reference preview uses flat surfaces so that values and states remain the focus.

## Shapes

Use 8px corners for controls, 12px for grouped surfaces and 16px for dialogs. Keep status words, ranks and the Lowest APR label as text instead of wrapping each one in a pill. Put meaningful icons directly on the surface and preserve clear labels; decorative icon tiles are unnecessary. Any clipped or sticky region must leave live text and controls fully visible at zoom and on narrow screens.

## Components

The component entries include default, hover, focus and disabled button specimens; input default, focus and error; acknowledged, queued and failed status; the comparison row; dialog; and disclosure. A primary button changes tone on hover and remains in place. Use 120ms for color/state transitions and up to 180ms for an expanding disclosure, easing cubic-bezier(0.15,0.5,0.5,1); reduced motion disables nonessential movement. Text and controls remain visible if JavaScript or animation fails. Native or established accessible primitives should supply keyboard behavior and dialog focus.

Show errors after field interaction or a submitted attempt; an untouched empty form should not greet a person with red errors. Announce calculation and saving state politely, then show Saved to your account only after server acknowledgement. Save and Download after a guest result each explain their own sign-in requirement without covering the complete result. A sign-in outage leaves the guest result readable and retryable. Offer-three controls are available to members only.

For dialogs preserve the initiating control for focus return, contain keyboard focus and provide an explicit cancel action. Optional feedback appears below the result and can be dismissed. Treat missing, loading, offline, conflict, unavailable account, pending deletion and expired sign-in as distinct states; the detailed behavior remains in ui-spec.md. This preview demonstrates styling with local synthetic examples, never real saving or authentication.

## Do's and Don'ts

Do: keep corresponding offer rows aligned; show Indian grouping and clear units; state when data is only on this device; preserve the complete first result through sign-in; verify every real control by keyboard and pointer; keep all content visible when motion does not run.

Do not: add a generic marketing hero or decorative finance chart; use color alone for rank or errors; show success before acknowledgement; import device loans into an account automatically; animate button lift or hide text behind an entrance reveal; copy Revolut brand assets or imply independently reviewed financial accuracy.

## Implementation note: 16 September 2026

The application now maps its muted text token to the existing muted-light and muted-dark values above. Other specification tokens still require their own implementation review. See loan-ui-verification.md and evidence/text-token-contrast.json for the checked surfaces and limits.
