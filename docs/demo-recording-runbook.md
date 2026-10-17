# TrueCost MVP demo recording runbook

**Target:** 210 seconds (within the required 180–240 seconds)  
**Audience:** an Indian home-loan borrower comparing two sanction-letter offers  
**Recording target:** 15:30 UK, 16 September 2026  
**Status:** rehearsal script only. The recording, Chronicle export and Runway assets have not been completed or submitted.

This is a real-product walkthrough with a short fictional couple opening. Use the current local development build and synthetic offer figures. Read values that the product calculates on screen; do not pre-record or fabricate a result, saved record, account, or PDF. The couple scene is a direction only; no generated media exists.

## The one-line pitch

“TrueCost helps a borrower compare the estimated real cost of two home-loan offers, including the terms that sit behind the headline rate.”

The team selected this loan-optimizer direction from seven internally discussed ideas because it combines a high-stakes decision with computable EMI, amortisation and total-cost estimates. That is team rationale, not market validation; see the [one-pager](demo-one-pager.md) for the alternatives and evidence gaps.

## Demo data

Use the same two synthetic offers during rehearsal and the final take. Enter the fields in the comparison grid; the labels below match the current UI.

| Field | Offer 1 | Offer 2 |
| --- | ---: | ---: |
| Lender name | Guest bank A | Guest bank B |
| Loan amount | ₹10,00,000 | ₹10,00,000 |
| Interest rate | 8.50% | 8.90% |
| Rate basis | Float | Float |
| Rate type | Reducing | Reducing |
| Tenure / Counted in | 10 / Yrs | 10 / Yrs |
| Processing fee / Charged as | 0% / % (default) | 0% / % (default) |
| GST on fee | 18% | 18% |
| Insurance / Premium paid | ₹0 / Added (default) | ₹0 / Added (default) |
| Other charges | None (default) | None (default) |

These are invented demonstration values, matching the planned browser fixture, not lender quotes or advice. Do not claim that either lender exists, that the result is a market ranking, or that the product guarantees a saving.

## 210-second shot list and narration

| Time | Screen and action | Voice track |
| --- | --- | --- |
| 0:00–0:15 (15s) | Fictional couple opening: two adults discuss two generic home-loan offers in a contemporary Indian home. Cut to the real home screen. Keep this scene clearly separate from product evidence. | Hinglish couple dialogue: “Rate kam hai, toh loan sasta hoga?” / “Pata nahi. Fees aur insurance bhi dekhte hain. Chalo TrueCost mein dono offers compare karte hain.” |
| 0:15–0:52 (37s) | Real UI voiceover. On **True cost comparison**, leave **Home loan** selected. Enter the exact Guest bank A/B fixture values and leave fresh-draft defaults in place. Keep the two columns in the same shot. | Hinglish UI voiceover: “Main do ₹10 lakh, 10-year offers compare kar raha hoon. Guest bank A ka rate 8.50% hai, Guest bank B ka 8.90%. Grid mein amount, rate aur tenure ek saath dikhte hain. Baaki fees abhi default par hain; yeh demo figures hain.” |
| 0:52–1:18 (26s) | Real UI voiceover. Confirm **See the full breakdown**, activate it, then pause on **Effective APR**, **Monthly EMI**, **Cost per lakh** and **Total cost**. Show **Recommendation** and an assumption/warning if present. | “Ab result headline rate ko repeat nahi karta; entered cash flows ko estimate karta hai. Main Effective APR, Monthly EMI, Cost per lakh aur Total cost par ruk raha hoon. Recommendation ke saath assumptions aur warnings bhi visible hain.” |
| 1:18–1:38 (20s) | Real UI voiceover. Show the guest action area and choose save. Keep the preserved result visible as the return target. | “Pehla two-offer comparison guest ke liye available hai. Is result ko save karne par TrueCost account maangta hai, lekin current result screen par bana rehta hai.” |
| 1:38–1:58 (20s) | Real UI voiceover. On **Sign in**, show **Your email**, **Email address** and **Send code**. Use the prepared development account only if the verified flow is ready. | “Sign-in email verification se hota hai: password yaad rakhne ki zaroorat nahi. Screen par **Send code** select karunga.” |
| 1:58–2:13 (15s) | Real UI voiceover plus safe OTP cutaway. Show **Enter code**, **Six digits** and an empty or covered **Six digit code** field. Never show an address, code, inbox, token or provider console. | “OTP private hota hai, isliye code ko cover karke sirf verification step dikha raha hoon. Verification ke baad wahi comparison wapas aata hai.” |
| 2:13–2:31 (18s) | Real UI voiceover. The original save intent resumes automatically. Wait for **Sending your comparison. Waiting for confirmation.**, then **Saved to your account.** Do not click **Save comparison** again. | “Original save request verification ke baad khud resume hota hai. Main server acknowledgement ka wait karunga. **Saved to your account.** dikhne ke baad hi ise saved bolunga.” |
| 2:31–2:50 (19s) | Real UI voiceover. Open **Saved comparisons**, show **Your saved results, newest first.**, then open the row and show **Saved result**. | “Ab saved result account history mein hai, newest first. Main isi stored snapshot ko open kar raha hoon; ise dobara calculate nahi kiya ja raha.” |
| 2:50–3:30 (40s) | Real UI voiceover. On detail, show stored figures, fees and warnings. Choose **Generate PDF**, wait for **Your report is ready.**, then click **Download PDF**. If generation fails, show **Print this result** only as fallback and say the PDF attempt failed. | “Detail page mein comparison ke waqt record kiye gaye figures hain. Report isi validated snapshot se browser mein banti hai. **Download PDF** fresh user action hai. Agar PDF fail ho, toh **Print this result** fallback hai; main failed PDF ko successful nahi bolunga.” |

**Total:** 15 + 37 + 26 + 20 + 20 + 15 + 18 + 19 + 40 = **210 seconds**.

## Canonical Hinglish spoken script

This is the master Hinglish track: a fictional couple opens for 15 seconds, then voiceover follows the real product. English captions are in [demo-captions-en.srt](demo-captions-en.srt); timings are unmeasured draft timings.

**0:00–0:15, fictional couple:**  “Rate kam hai, toh loan sasta hoga?” “Pata nahi. Fees aur insurance bhi dekhte hain. Chalo TrueCost mein dono offers compare karte hain.” Cut from the couple to the actual app. The couple, home and offer papers are fictional direction only, not product evidence.

**0:15–0:52, real UI:** “Main do ₹10 lakh, 10-year offers compare kar raha hoon. Guest bank A ka rate 8.50% hai, Guest bank B ka 8.90%. Grid mein amount, rate aur tenure ek saath dikhte hain. Processing fee, GST, insurance aur other charges fresh-draft defaults par hain. Yeh figures synthetic hain, lender quotes nahi.”

**0:52–1:18, real UI:** “Ab **See the full breakdown** select karte hain. Result headline rate ko repeat nahi karta; entered cash flows se estimated Effective APR, Monthly EMI, Cost per lakh aur Total cost dikhata hai. Main Recommendation ke saath assumptions aur warnings bhi check kar raha hoon.”

**1:18–1:38, real UI:** “Pehla two-offer comparison guest ke liye available hai. Save karne ya report download karne par account chahiye, lekin current result screen par bana rehta hai. Is demo mein main save intent choose kar raha hoon.”

**1:38–1:58, real UI:** “Sign-in email verification se hota hai. **Your email**, **Email address** aur **Send code** yahan dikh rahe hain. Password yaad rakhne ki zaroorat nahi.”

**1:58–2:13, real UI and safe cutaway:** “OTP private hota hai, isliye actual code, email aur inbox record mein nahi dikhenge. Sirf **Enter code**, **Six digits** aur covered **Six digit code** field dikh raha hai. Verification ke baad wahi preserved comparison resume hota hai.”

**2:13–2:31, real UI:** “Original save request verification ke baad khud resume hota hai. Main **Sending your comparison. Waiting for confirmation.** se **Saved to your account.** tak wait karunga. Server acknowledgement ke bina ise saved nahi bolunga, aur **Save comparison** dobara click nahi karunga.”

**2:31–2:50, real UI:** “Ab **Saved comparisons** open karte hain. Results newest first hain. Main **Saved result** khol raha hoon. Yeh stored snapshot hai, aaj ke engine se dobara calculate kiya hua answer nahi.”

**2:50–3:30, real UI:** “Detail page par saved Effective APR, fees aur warnings wahi hain jo comparison ke waqt record hue the. **Report** mein **Generate PDF** select karunga, **Your report is ready.** ka wait karunga, phir fresh action se **Download PDF** karunga. PDF browser mein isi validated snapshot se banti hai. Agar generation fail hoti hai, **Print this result** fallback dikhayenge aur failure ko success nahi bolenge. TrueCost estimate deta hai; lender approval, guaranteed saving ya financial advice nahi.”

## Exact live labels to capture

### Comparison and result

- **True cost comparison**
- **Home loan**
- **Loan amount**, **Interest rate**, **Rate basis**, **Rate type**, **Tenure**, **Counted in**
- **Processing fee**, **Charged as**, **＋ GST, insurance and other charges**
- **GST on fee**, **Insurance**, **Premium paid**, **Other charges**
- **See the full breakdown**
- **Results**, **Recommendation**, **Effective APR**, **Monthly EMI**, **Cost per lakh**, **Total cost**

### Authentication and persistence

- **Sign in**, **Your email**, **Email address**, **Send code**
- **Enter code**, **Six digits**, **Six digit code**, **Verify**
- **Sign in to save comparison**, **Save comparison**, **Sending your comparison. Waiting for confirmation.**, **Saved to your account.**
- **Saved comparisons**, **Your saved results, newest first.**, **Saved result**

### Report

- **Report**, **Generate PDF**, **Preparing PDF…**, **Your report is ready.**
- **Download PDF**, **Print this result**
- If blocked: **Verify your account online before generating a private report.**

## Capture setup and shot discipline

1. Use a clean 16:9 desktop capture or a phone-width capture that keeps text readable. Record the browser chrome only if it helps establish the real app; hide personal tabs and notifications.
2. Use a fresh guest browser profile for the first comparison. Clear only the demo profile before rehearsal if the one-comparison allowance has already been spent. Do not clear a real personal profile.
3. Set the browser clock and locale consistently with the development environment. The UI reports saved dates in **IST**; do not describe a date unless it is visible.
4. Keep the cursor still while reading results. Hold each important result for at least two seconds. Avoid rapid edits that could make the calculated figures unreadable.
5. For OTP, use a prepared test account and a real development verification flow. Cover the code field and email address in the edit, or cut to the empty **Six digit code** field. Never put an OTP, session token, auth key, inbox, or personal email in the recording.
6. Wait for the actual save acknowledgement and the actual PDF readiness state. A jump cut may remove dead time, but it must not imply that an unacknowledged queue is already in the account.
7. If a step fails, keep the result visible and use the product’s own fallback copy. A print view can document the fallback, but it does not replace required PDF evidence. Do not replace either with a generated screenshot or a narrated claim that it worked.

## Prerequisite checks before recording

- [ ] The exact development build opens at `/compare` and the guest allowance is unused.
- [ ] Both sample offers validate and **See the full breakdown** becomes enabled.
- [ ] The result shows the comparison table, recommendation/assumptions and breakdown without clipping at the chosen capture width.
- [ ] The approved email OTP development account can complete **Send code** → **Verify**. Record only the post-verification state.
- [ ] The member session can save the preserved result and display **Saved to your account.** after server acknowledgement.
- [ ] `/comparisons` loads the saved row and its detail route opens the immutable snapshot.
- [ ] **Generate PDF** completes within the report target and the exported PDF passes the required content, rupee-glyph and lender-name review. **Print this result** may be checked separately as a fallback, but it does not replace the required PDF evidence.
- [ ] Analytics remains disabled for the demo environment unless separately approved; no live Mixpanel request is needed for this recording.
- [ ] Browser notifications, passwords, bookmarks, unrelated tabs and personal account details are hidden.
- [ ] The final edit has a visible duration between 180 and 240 seconds, readable captions, clear audio, and no provider secrets.

## Truthful boundaries for narration

Say that the offers are synthetic and that the calculation is an estimate from entered terms. Say **saved to your account** only after the UI shows the acknowledgement. The product does not provide live lender quotes, lender approval, a credit check, a guaranteed saving, regulatory certification, or financial advice. The report is generated in the browser from the validated snapshot; the recording does not prove production deployment or operational readiness.

Do not show or claim live analytics, a real lender integration, a generated Runway scene as product evidence, or a Chronicle page as the application. Generated supporting visuals, if later approved, must be labelled as supporting visuals and kept separate from the real UI capture.

## Chronicle and Runway handoff gaps

### Chronicle

- Earlier notes recorded access to a Chronicle workspace containing an existing deck named **Plan the last stretch**. Current access and its contents are unverified; preserve it and recheck before use.
- A reviewed TrueCost one-pager still needs to be laid out and exported. Verify the chosen page, export control, PDF, readability and claims before using it in the film.
- If a one-pager appears in the video, show the reviewed export briefly as a supporting visual. Do not use it to stand in for the live product walkthrough.

### Runway

- No callable Runway connector or verified project/export access is available in this workspace. Do not spend credits or substitute another generator silently.
- Runway assets are optional support for the 210-second recording. The compare, auth, save, history, detail and PDF sections must come from screen capture of the real build.
- If Runway access is approved later, prepare only short, clearly labelled transitions or problem illustrations, inspect each export, and record its owner, rights, watermark status and duration.

### Actual recording

- The final presenter, editor, capture orientation, development URL/build identifier, and accepted upload format remain to be confirmed.
- The runbook is ready for rehearsal. The final MP4, playback review, duration evidence, captions and submission receipt do not yet exist.

## Source notes

- Current comparison labels: `app/compare/page.tsx`, `components/OfferGrid.tsx`, `components/ComparisonStatus.tsx`.
- Current authentication labels: `app/signin/page.tsx`, `app/verify/page.tsx`.
- Current history/detail labels: `app/comparisons/page.tsx`, `app/comparisons/[id]/page.tsx`.
- Current report labels and fallback: `components/ComparisonReportActions.tsx`.
- Product boundaries and acceptance requirements: [PRD](prd.md), [UI specification](ui-spec.md), [PDF core verification](pdf-core-verification.md), and [Demo Day brief](demo-day.md).

## Local asset checkpoint, 2 October 2026

Existing 16:9 and 9:16 local outputs are recorded at 180.683 seconds with captions ending at the same time. The local evidence is `docs/evidence/demo-assets-local-check-2026-10-02.json`. Full listening, Chronicle export inspection and final publication remain open.
