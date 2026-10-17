# TASK-012 PDF core verification

## Scope

The report core accepts a validated `ComparisonSnapshot`, maps the stored input and derived values into a report model, and exposes an asynchronous browser API that returns a `Blob`. It does not call the finance engine or create a report object in Convex. The renderer is loaded only when `renderComparisonReport` is called.

The report includes two or three offers, Indian grouped INR values, quoted rate and structure, processing fee, GST, insurance and funding mode, other fees, upfront fees, EMI, repayment, interest, total borrowing cost, cost per lakh, APR, row warnings, comparison assumptions, calculation and snapshot versions, source and generated timestamps, and a lender-facing disclaimer. React-pdf page wrapping carries long content onto later A4 pages. Text remains selectable in the generated PDF.

## Renderer and font decision

On 16 September 2026, the official React-pdf v4 documentation was checked before installation:

- [On-the-fly rendering](https://react-pdf.org/docs/v4/advanced/on-the-fly-rendering) documents the imperative `pdf(document).toBlob()` browser API.
- [Fonts](https://react-pdf.org/docs/v4/fonts) documents TTF and WOFF support and warns that variable fonts are unsuitable. The implementation uses static WOFF files.
- npm metadata for `@react-pdf/renderer@4.9.0` declares MIT licensing and a peer range including React 19 (`^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0`). The app uses React 19.2.8.

The bundled font files are Noto Sans 5.2.5 WOFF subsets from `@fontsource/noto-sans`, distributed under the included SIL Open Font License text. The basic Latin subset is registered for ASCII text, the Latin extended subset is used for the INR rupee sign, and Devanagari is registered as a separate family. Mixed lender and fee labels are split into script runs. The report model claims only ASCII, Devanagari and `₹` coverage for user-entered labels. It records unsupported lender or fee-label characters and rendering fails with `unsupported_report_glyph` rather than silently substituting a missing glyph. Other scripts remain an explicit limitation.

## Automated evidence

Command: `npx vitest run tests/report-core.test.ts`

Observed: **7 tests passed**. The tests parse the generated PDF with `pdfjs-dist`, then assert page count, selectable title and lender text, Hindi text, INR grouping, stored figures and fee inputs, and report sections. The three-offer 20-year fixture generated a two-page PDF in approximately 1.8 seconds on the recorded workstation during the first uncached run (subsequent Vitest runs were approximately 6.7 seconds including test startup). The parser-inspected artifact is [report-core-sample.pdf](evidence/report-core-sample.pdf).

Covered cases:

1. The report model preserves result ID, timestamps, calculation version, and stored EMI without recalculation.
2. Three offers, a long lender label, Devanagari text, selectable text, rupee grouping, warnings, and pagination.
3. A stored null APR remains `Unavailable` and includes an honest reason.
4. A Tamil lender name and Tamil fee label are rejected because this bundled font set does not claim Tamil coverage.
5. The maximum warning payload spans twelve pages and retains the final warning, rather than clipping the report.
6. Static font families are used for basic Latin, extended currency and Devanagari runs, so ordinary text does not fall back to an unbundled standard font.
7. The generated sample is written and parsed back as a PDF artifact for inspection.

TypeScript validation: `npx tsc --noEmit --pretty false` passed after the report test parser was adjusted to the current `pdfjs-dist` type declaration.

## Limits and follow-up

Root verification on 16 September at 10:21:23 passed seven report tests. The representative three-offer fixture rendered in 1,453 ms on this workstation. Root rendered and visually inspected both sample pages with PDF.js standard-font assets configured: all three offers, fees, rupee figures, versions, assumptions and disclaimer were present without clipping. Evidence images: `evidence/report-core-verified-1.png` and `evidence/report-core-verified-2.png`. The inspected PDF SHA-256 was `4417296a8e925f95d25a7103c99cd88ffe827aa2293015af5536b98601da58db`. This one sample and timing do not prove the mobile performance target or all supported text/layout cases.

This slice does not wire authentication, download gestures, object URL lifecycle, service-worker caching, or report generation analytics. Browser acceptance on mobile, offline cached font loading, download activation, and late lifecycle cancellation remain for the integration slice. No production build or provider action was run while the analytics changes were still active.
