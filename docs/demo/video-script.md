# TrueCost demo script

Status: rehearsal script for the local hosted-development cut. The product footage is real and uses synthetic loan data. The cut does not claim production deployment, provider approval, lender quotes, or financial advice.

## Run sheet

| Time | Picture | Spoken copy | Operator cue |
| --- | --- | --- | --- |
| 00:00-00:07 | Landing page, then the comparison entry | “Does a lower rate mean this loan costs less? Let us compare fees and insurance in TrueCost.” | Start on the live landing page. Keep the sign-in and compare controls visible. |
| 00:07-00:23 | Landing to comparison choice | “We chose loan comparison from seven team ideas because the decision is financial. Compare two offers as a guest, then sign in to save and revisit. These measures need validation.” | Open the guest comparison. Do not imply the measures are approved targets. |
| 00:23-00:47 | Two populated offer rows | “Two ten lakh rupee, ten year offers: Guest bank A at 8.50%, Guest bank B at 8.90%. Fees, GST, insurance, and other charges use fresh draft defaults. These are synthetic figures.” | Keep both offers and their entered terms in frame. No lender mark or private data. |
| 00:47-01:05 | Full breakdown and recommendation | “See the full breakdown estimates Effective APR, Monthly EMI, Cost per lakh, and Total cost. I check the Recommendation, assumptions, and warnings.” | Expand the breakdown. Pause long enough to read each metric. |
| 01:05-01:19 | Guest result and save action | “The first comparison is available to a guest. Saving or downloading requires an account. I choose the save intent, with the result as the return target during verification.” | Select the save intent once. Do not click Save again while verification is pending. |
| 01:19-01:32 | Privacy-preserving edit | “Saving requires account verification. This edit omits the sign-in screen for privacy. Hosted evidence covers email verification; credentials stay out of view.” | Use the prepared edit. Do not show an inbox, address, token, or provider console. |
| 01:32-01:48 | Privacy-preserving OTP edit | “The OTP is private, so this edit omits the code screen. Hosted evidence records the check with synthetic data. No address, code, or inbox appears here.” | Keep the cut on the prepared transition. Do not invent a successful OTP frame. |
| 01:48-02:03 | Acknowledged save | “The original save request resumes after verification. I wait for Saved to your account. I call it saved only after server acknowledgement and do not select Save again.” | Show the saved state only after the acknowledgement in the recorded flow. |
| 02:03-02:15 | Saved comparisons list | “I open Saved comparisons and choose Saved result. This stored snapshot contains the recorded figures, fees, and warnings.” | Open the saved result. Preserve the stored snapshot wording. |
| 02:15-02:37 | Detail page and report | “The detail page shows recorded Effective APR, fees, and warnings. I generate the PDF, wait for Your report is ready, then download it. Print this result is the fallback.” | Wait for the ready state before downloading. Keep the report controls readable. |
| 02:37-03:00 | Closing landing page and limitation | “TrueCost estimates from entered terms. The offers are synthetic. This hosted development review uses development Clerk and Convex. Production pilot and operational readiness remain unproven.” | Return to the landing page. End on the product URL shown in the approved handoff, without publishing or uploading from this run. |

## Rehearsal rules

1. Use the exact sample: Guest bank A and Guest bank B, each ₹10,00,000 for 10 years, at 8.50% and 8.90%, Float, Reducing, with fresh-draft default fees.
2. Keep the email, OTP, inbox, token, address, provider console, and any private account detail out of the recording.
3. Treat the saved result as a stored snapshot. Do not describe it as a recalculation by a newer engine.
4. Use the existing 180.683-second narration and captions in `docs/evidence/demo-edits/`. The 16:9 and 9:16 exports are local review candidates; full listening and final reviewer acceptance remain open.
5. If a save acknowledgement, report-ready state, or route transition does not appear, stop the take and record the failure. Do not cover it with generated footage.

## Evidence references

- Browser flow: `docs/evidence/clerk-browser-mvp-demo.json`
- Assembly record: `docs/evidence/demo-edits/truecost-hosted-development-assembly.json`
- Narration and voice limits: `docs/demo/local-narration-assessment.md`
- One-pager: `docs/demo/truecost-one-pager-designed.pdf`

## Current source-equivalent rehearsal capture: 4 October 2026

The current MVP browser run against build 1iwP4oc_H3NlGLD2I7W_j passed 17/17 checks and produced a raw 87.982-second capture. The raw file is unshareable; the local redacted rehearsal is 85.84 seconds and masks the 26-44 second auth transition. This cut verifies the current product sequence only. It is not the final 180-240 second assembly. Evidence: docs/evidence/clerk-browser-mvp-demo-current-2026-10-04.json and docs/evidence/demo-edits/demo-capture-current-1iwP4oc_H3NlGLD2I7W_j-redaction.json.

The current redacted capture is now also assembled into local 16:9 and 9:16 candidates at 180.68 seconds with the same narration and captions. The authentication interval remains held out of view. Full playback/listening, normal-playback caption review, reviewer access and final acceptance are still open. Evidence: docs/evidence/demo-edits/truecost-current-1iwP4oc_H3NlGLD2I7W_j-assembly.json.

## Current normal source-equivalent rehearsal capture: 4 October 2026

The current normal analytics-disabled build `R-YV2Ykfq677oTDdfRFCj` passed 17/17 disposable Chrome checks and produced a new raw 88.56-second capture. The raw file is unshareable; the local redacted rehearsal masks the 26-44 second authentication interval. Evidence: `docs/evidence/clerk-browser-mvp-demo.json` and `docs/evidence/demo-edits/demo-capture-current-R-YV2Ykfq677oTDdfRFCj-redaction.json`.

The redacted capture is assembled into current local 16:9 and 9:16 candidates at 180.68 seconds with the accepted narration and burned captions. Both outputs passed null decode and black-frame checks, and sampled contact sheets show the product states above the caption band with no authentication fields in the held interval. Full playback/listening, normal-playback caption review, reviewer access and final acceptance remain open. Evidence: `docs/evidence/demo-edits/truecost-current-R-YV2Ykfq677oTDdfRFCj-assembly.json` and `docs/evidence/demo-assembly-machine-check-R-YV2Ykfq677oTDdfRFCj.json`.
