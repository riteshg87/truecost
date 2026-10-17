# Revolut — Design System Reference

*Captured from Revolut's live properties and compiled for study, September 2026.*

**Sources**
- `revolut.com` — computed styles + the site's own design-token layer (Revolut's internal **"RUI" / Revolut UI** tokens; ~400 CSS custom properties named `--rui-*`, extracted live).
- Revolut iOS app listing — *"Revolut: Send, spend and save"* (App Store, developer Revolut Ltd, 4.7★ / 72K ratings, 80M+ customers). The app ships the **same RUI token set** as web; several palette values map 1:1 to Apple's system colors (e.g. green `#30d158`, red `#ff453a`, orange `#ff9f0a`), confirming one cross-platform token source.

> **Caveats.** This is a descriptive reference for learning how Revolut structures its system — not an official spec and not brand assets. Revolut's **logo, wordmark, and card art are trademarked**; don't reproduce them. The marketing typeface **Aeonik Pro is a commercial licence** (CoType Foundry) — you need your own licence to use it; **Inter** is open (SIL OFL). Values were read in the site's **dark theme** (Revolut is dark-first); the raw palette is theme-independent, the *semantic* assignments below are the dark set.

---

## 1. Brand at a glance

Revolut's system is **dark-first, high-contrast, and token-driven**. The visual world is near-black canvases, crisp white type, translucent "glass" widgets layered on dark, a single hot-magenta accent, and an Apple-aligned status palette. Marketing surfaces go bigger and more expressive (huge Aeonik display type, glow gradients, product photography of cards); the product UI is dense, calm, and utilitarian (Inter, tight radii, subtle elevation).

**Voice** (from product copy): confident, playful, plain-spoken — *"Change the way you money"*, *"Make your spend, well-spent"*, *"Save the interest-ing way"*, *"nip 'em in the bud"*. Verbs and outcomes over jargon; a wink, never corporate.

**Signature moves**
- Near-black backgrounds (`#111`) with **translucent white widgets** (`rgba(255,255,255,0.06–0.14)`) instead of solid grey cards.
- One **magenta accent** (`#ea035d`) used sparingly against the dark.
- **Pill buttons** (fully rounded) and invert-on-emphasis (black↔white).
- **Plan-tier identity colors** (Plus / Premium / Metal / Ultra) as a first-class part of the palette.
- **"Reflective" card treatments** — subtle inset highlight + hairline border tokens that give widgets a glassy metallic edge.

---

## 2. Color

### 2.1 Core neutrals
| Token | Hex | Use |
|---|---|---|
| `black` | `#191C1F` | True brand black (slightly blue-cool, not `#000`) |
| `white` | `#FFFFFF` | Foreground on dark, surfaces on light |
| `grey-2` | `#F7F7F7` | Lightest fill |
| `grey-5` | `#F4F5F6` | |
| `grey-8` | `#EBEBF0` | |
| `grey-10` | `#E2E2E7` | Hairlines / dividers (light) |
| `grey-20` | `#C9C9CD` | Muted text (light) |
| `grey-50` | `#717173` | Secondary text / "Plus" tier |

On dark, neutrals are expressed as **white at opacity** rather than greys — see §2.4.

### 2.2 Brand accent
| Token | Hex | Note |
|---|---|---|
| `accent` | `#EA035D` | The Revolut magenta — primary accent & focus color |
| `on-accent` | `#FFFFFF` | Text/icon on accent |
| `action-blue` | `#0666EB` | Interactive/link blue |

### 2.3 Full palette (theme-independent)
| Name | Hex | Name | Hex |
|---|---|---|---|
| blue | `#6FA0FF` | pink | `#FF50A4` |
| cold-blue | `#0A84FF` | deep-pink | `#FF5777` |
| light-blue | `#2BB2FF` | red | `#FF453A` |
| cyan | `#0CD9E6` | orange | `#FF9F0A` |
| deep-grey | `#6790B8` | terracotta | `#FF7A40` |
| indigo | `#5E5CE6` | brown | `#AC816E` |
| deep-purple | `#805CFF` | yellow | `#FFD60A` |
| purple | `#BF5AF2` | lime | `#CBDC0F` |
| green | `#30D158` | light-green | `#5AD024` |
| teal | `#13D1A3` | | |

### 2.4 Semantic tokens (dark theme, as shipped)
| Role | Value |
|---|---|
| Background (app canvas) | `#111111` |
| Grouped background (cards) | `#272B2F` · website `#1C1C1E` |
| Nested background | `rgba(0,0,0,0.15)` |
| Popover background | `#414549` |
| Widget background | `rgba(255,255,255,0.06)` |
| Disabled background | `#1F1F1F` |
| Foreground (text) | `#FFFFFF` |
| Grey tones (on dark) | white @ `0.06 / 0.10 / 0.14 / 0.24 / 0.70 / 0.85` |
| Accent | `#EA035D` |
| Action / link | `#0666EB` |
| Success | `#1AC097` | 
| Positive (money in) | `#30D158` |
| Danger | `#FF5363` |
| Negative (money out) | `#FF453A` |
| Warning | `#FF9F0A` |
| Modal overlay | `rgba(0,0,0,0.4)` |
| Focus outline | `2px solid rgb(accent / 0.5)`, offset `2px` |

> **Technique worth stealing:** Revolut stores every color twice — as a hex *and* as an RGB "**channel**" triplet (`--rui-color-channel-accent: 234 3 93`). Components then compose alpha with `rgb(var(--…-channel) / 0.5)`. This is what lets one palette drive all the translucent-on-dark surfaces cleanly.

### 2.5 Plan-tier colors (a distinctive Revolut system)
| Tier | Colors |
|---|---|
| Plus | `#717173` |
| Premium | dark `#7E8898` · mid `#8EB199` · light `#E3DBD3` |
| Metal | dark `#8E7150` · light `#B1AAA1` |
| Ultra | dark `#40578C` · mid `#9A81A2` · light `#C09CA1` |

### 2.6 Gradients
| Token | Value |
|---|---|
| Glow (ambient hero) | layered `radial-gradient`s in blues + reds at low alpha — a soft colored bloom behind dark heroes |
| Sales banner | `linear-gradient(to right, #1227FD, #6FA0FF)` |
| Premium button | `linear-gradient(180deg, #C8D0DD -6.25%, #8FA3C4 100%)` |

---

## 3. Typography

### 3.1 Families
| Role | Stack |
|---|---|
| **Marketing / display** | `"Aeonik Pro"`, then brand fallback — big headlines, hero type (weight **500**) |
| **Brand / product** | `"Inter"`, then system — body, UI, most text |
| **System** | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif` |
| **Display caps** | `"Aeonik Pro Capitalised"` weight **900** — occasional all-caps statement type |

**Weight convention:** marketing display = **500** (Aeonik, airy); product display & headings = **800** (Inter, assertive); emphasis/labels = **700**; body = **500**. Revolut leans on *weight*, not size, to build hierarchy.

### 3.2 Type scale (rem → px @16)
| Token | Size | Weight | Line-height | Notes |
|---|---|---|---|---|
| marketing-display1 | 3.5rem / **56px** | 500 | 1.0 | Aeonik, slight negative tracking |
| marketing-display2 | 2.5rem / **40px** | 500 | 1.0 | Aeonik |
| marketing-display3 | 2rem / **32px** | 500 | 1.125 | Aeonik |
| display1 | 3.5rem / **56px** | 800 | 1.18 | Inter |
| display2 | 2.75rem / **44px** | 800 | — | |
| heading1 | 1.375rem / **22px** | 800 | 1.36 | |
| heading2 | 1.25rem / **20px** | 800 | 1.30 | |
| heading3 | 1.125rem / **18px** | 800 | 1.33 | |
| subheader | 1rem / **16px** | 700 | 1.375 | |
| emphasis1 | 0.9375rem / **15px** | 700 | 1.33 | Labels, buttons |
| emphasis2 | 0.875rem / **14px** | 700 | 1.43 | |
| emphasis3 | 0.75rem / **12px** | 700 | 1.5 | |
| emphasis4 | 0.6875rem / **11px** | 700 | 1.27 | Micro-labels |
| body1 | 0.9375rem / **15px** | 500 | 1.33 | Default body |
| body2 | 0.875rem / **14px** | 500 | 1.43 | |
| body3 | 0.75rem / **12px** | 500 | 1.5 | Captions |

Marketing display sizes carry a **small negative letter-spacing** (`≈ -0.009em` to `-0.011em`); product text uses `0`.

---

## 4. Spacing & sizing

Two parallel 4px-ish scales. **Space** (layout gaps/padding) and **Size** (fixed dimensions) — both named by their pixel value.

**Space scale** — `sp50 2px · sp100 3 · sp150 4 · sp200 6 · sp300 8 · sp400 12 · sp500 16 · sp600 20 · sp800 24 · sp1000 32`.

**Size scale** — `s2 2 · s4 4 · s6 6 · s8 8 · s12 12 · s16 16 · s20 20 · s24 24 · s32 32 · s40 40 · s48 48 · s56 56 · s64 64 · s72 72`.

**Control heights** — button `xs 28px · sm 32px · md 44px`; control `sm 32px`. (44px = the iOS comfortable tap target.)

**Layout** — content max-width **1000px**; nav bar height **56px**; sticky nav background `rgba(0,0,0,0.7)`.

---

## 5. Radius

| Token | Value | Token | Value |
|---|---|---|---|
| r2 | 2px | r24 | 24px |
| r4 | 4px | r32 | 32px |
| r6 | 6px | **round** | 9999px (pills) |
| r8 | 8px | widget / popup | 12px |
| r12 | 12px | cell / nested | 8px |
| r16 | 16px | status-popup | 36px |

**Observed in the wild:** pills `9999px` (buttons, chips), `12px` (widgets/cards), `50px` (large marketing pills), `20px` (media cards). The system is *rounded but restrained* — soft, not bubbly.

---

## 6. Elevation (shadows)

| Token | Value |
|---|---|
| level1 | `0 2px 3px rgba(0,0,0,.05)` |
| level2 | `0 3px 8px rgba(0,0,0,.10)` |
| level3 | `0 3px 30px rgba(0,0,0,.08)` |
| level4 | `0 16px 64px rgba(0,0,0,.12)` |
| side | `0 2px 4px rgba(0,0,0,.05), 0 3px 16px rgba(0,0,0,.10)` |
| popover | `0 4px 4px 4px rgba(0,0,0,.12), 0 16px 48px rgba(0,0,0,.16)` |

**Reflective treatment** (the glassy card edge): a hairline border token `0 0 0 0.03125rem rgba(0,0,0,.3)` plus an **inset highlight** `rgba(255,255,255,0.1–0.25)` top & bottom. On dark surfaces this reads as a subtle lit metallic rim rather than a drop shadow.

---

## 7. Motion

| Duration | ms | | Easing | Curve |
|---|---|---|---|---|
| xs | 100 | | default | `cubic-bezier(0.15, 0.5, 0.5, 1)` |
| sm | 200 | | shadow | `cubic-bezier(0.4, 0.3, 0.8, 0.6)` |
| md | 300 | | toast (spring) | `cubic-bezier(0.175, 0.885, 0.21, 1.65)` — overshoots |
| lg | 450 | | | |
| xl | 900 | | | |
| skeleton | 1500 | | (loading shimmer loop) | |

Most UI transitions = **sm (200ms) / default easing**. Toasts use a **springy overshoot** for a bit of delight; shadows animate on their own gentler curve.

---

## 8. Components (observed patterns)

- **Buttons** — fully-rounded pills. Primary inverts against context (black bg / white text on light; white bg / black text on dark). Sizes map to control heights (28 / 32 / 44px), label = emphasis (15px, 700). Marketing CTAs use larger `50px`-radius pills at weight 500.
- **Widgets / cards** — `12px` radius, translucent white fill (`rgba(255,255,255,0.06)`) on the dark canvas, optional reflective rim. Content grouped in "cells" (`8px` radius) inside.
- **Nav** — 56px sticky bar, translucent dark (`rgba(0,0,0,0.7)`) with blur; pill nav buttons on `rgba(255,255,255,0.15)`.
- **Focus** — 2px accent ring at 50% alpha, 2px offset (accessible, on-brand).
- **Status / feedback** — success `#1AC097`, negative `#FF453A/#FF5363`, warning `#FF9F0A`; money movement uses positive-green / negative-red consistently.

---

## 9. How to apply this to your own product

Revolut's system is worth emulating *structurally*, not by copying its skin:

1. **Dark-first, translucent surfaces.** Build the widget layer as white-at-opacity over a near-black canvas, not as solid grey cards. Store colors as RGB channels so alpha composition stays clean.
2. **Hierarchy by weight.** One or two families, a tight size scale, and heavy (800) headings vs. medium (500) body — instead of many sizes.
3. **One accent, held back.** A single saturated accent against disciplined neutrals reads as premium; semantic status colors are separate from the accent.
4. **Pill geometry + 12px widgets.** Rounded but restrained; reserve full-round for buttons/chips.
5. **Named-by-value tokens.** `space-16`, `radius-12`, `size-44` are self-documenting and keep design and code in lockstep.
6. **Fonts:** license Aeonik if you want that exact display voice, or pair Inter (body) with a distinctive licensed display face of your own. Don't ship Aeonik without a licence.

A ready-to-use CSS token file with these values is provided alongside this document (`revolut-tokens.css`).
