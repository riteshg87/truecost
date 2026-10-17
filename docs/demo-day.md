# TrueCost Buildathon Demo Day brief

Updated: 15 September 2026. Status: Chronicle and Runway are selected production tools; the original planning snapshot below is retained. A 2 October local update records the designed one-pager and 180.683-second narrated video candidates. No generated opening clip, provider export, upload or submission is claimed.

Priority update, 16 September: Rajesh confirmed an immediate **15:30 UK time today MVP demo target**. Verify guest comparison, email sign-in/signup, save, history/detail and PDF first. Comparison feedback is optional for this recording; Loan health feedback, live Mixpanel proof and broader production gates are stretch. The full production goal and its acceptance requirements remain open. Production publishing, pushes and deployments still require approval. The current local work has not been published to the reference deployment.

## Deadline and event

| Item | Organizer's requirement | Calendar status |
| --- | --- | --- |
| Submission | Before Wednesday, 8 PM IST | Tentatively 16 September 2026; awaiting confirmation |
| Playback and feedback | Wednesday, 10 PM IST | Same tentative date |

The copied announcement says both “day after tomorrow” and “Wednesday.” Relative to 15 September 2026, Wednesday is 16 September and is tomorrow. The meeting transcript also refers to the video being due tomorrow. Use Wednesday as the working day; confirm the exact date with the team. No reminder or calendar event has been created.

Submission destination, actual owners and accepted file/upload format are not yet specified. TASK-023 resolves these without blocking drafting or rehearsal.

## Required submissions

| Deliverable | Acceptance | Task |
| --- | --- | --- |
| One-pager | One readable page explaining why this problem was chosen over other considered problems | TASK-026 |
| Deployed product link | Publicly accessible, tested URL matching the demonstrated product | TASK-027 |
| Video | 3-4 minutes total, combining elevator pitch and actual product demo; working playback access | TASK-028/029 |
| Optional deck **or** PRD | Problem space, solution/MVP scope and success measures; clear implemented/planned distinction | TASK-030 |

The [current product reference](https://truecost-lac.vercel.app/) is already known. Availability and the selected demo flow must still be checked for the final submission.

The organizer supplied this [pitch-video reference](https://www.youtube.com/watch?v=r-iETptU7JY). It is retained for the script task; its content has not been reviewed in this task. The user explicitly requires the product demo within the same 3-4 minute recording.

## One-pager content checklist

- State the target borrower and the concrete home-loan comparison problem.
- Name only the alternative problems the team actually considered; compare them using relevant criteria such as borrower impact, evidence, reachability and feasibility.
- Explain why TrueCost's problem was selected and what evidence supports the choice. Label hypotheses and unresolved research.
- Show the proposed solution and the features demonstrably built for this submission.
- Include how success will be measured, with targets labelled proposed unless approved.
- Review the existing team draft before replacing it. The meeting mentions a draft and selection discussion, but its exact figures and text need verification.

Avoid presenting the product as useful only once a year. The meeting questioned that frequency; explain comparison or Loan health use when the borrower's situation changes, without inventing a usage cadence.

## Chronicle and Runway production plan

The user selected these tools for Demo Day. TASK-033/034 are separate production tasks supporting the required one-pager/video and optional deck; they do not add organizer deliverables or change production-first priority.

| Tool | Assigned work | Required output | Task |
| --- | --- | --- | --- |
| Chronicle | Lay out the reviewed problem-selection one-pager; optionally prepare a short pitch deck and reusable pitch visuals | Exactly one readable PDF page; optional deck/export with verified claims | TASK-033, supporting TASK-026/030 |
| Runway | Prepare short supporting visuals from a reviewed storyboard and export them for editing | Inspected clips and asset register for the final film | TASK-034, supporting TASK-028/029 |
| Real app screen recording and final editor | Demonstrate actual behavior and assemble narration, visuals and captions | One fully reviewed 180-240 second video | TASK-029 |

### Access and capability checks

- **Chronicle:** the [user-selected workspace](https://app.chroniclehq.com/2e1eec2b-7e34-4ba3-9b57-e5e7331314dd/home) was opened read-only. Its home page is accessible and shows an existing deck, `Plan the last stretch`; that deck's contents have not been verified as TrueCost material. Preserve it. Confirm the chosen document, page format and export controls before producing assets. Chronicle advertises PDF/PPT export; verify the actual account controls and exported file rather than promising a format from marketing copy. [Chronicle formats](https://chroniclehq.com/)
- **Runway:** no callable Runway connector was found in the current tool inventory or focused tool search. A read-only Runway browser probe reached the guest tool navigation, but project access, credits, available generation tools, rights and export options remain unverified. Evidence: [Runway access probe](evidence/runway-access-current-2026-10-04.json). Use the requested Runway app through supported access when executing; do not silently substitute another generator.
- Runway's Edit Studio supports short clips up to 30 seconds. Its legacy video editor is no longer actively maintained, and Runway recommends a local editor for larger projects. Use short Runway assets within the complete recorded demo, with a separate final assembly step. [Edit Studio](https://help.runwayml.com/hc/en-us/articles/51683104370451-Creating-with-Edit-Studio), [editor guidance](https://help.runwayml.com/hc/en-us/articles/25286249355027-How-to-troubleshoot-an-export-failure)

### Production requirements

1. Prepare Chronicle copy, a Runway storyboard and the timed script locally. Use the existing PRD, actual problem-selection evidence and verified TASK-024 behavior.
2. Resolve presenter/narration choice, recording orientation, owners, credit ceiling and any missing external-creation authorization before dependent work. Do not spend credits or publish because these tasks exist.
3. Produce the Chronicle one-pager first; treat the deck as optional. A proposed six-slide structure is problem, why chosen, solution, verified walkthrough, MVP boundary, and success measures. Reuse the reviewed design language without forcing the app into a presentation template.
4. Keep Runway supporting clips brief within the existing 3:30 timing guide. Actual UI demonstrations use screen recordings with synthetic inputs. Never generate login, saving, analytics dashboards or comparison results as proof that they work. Generated illustration must be distinguishable from the product demonstration.
5. Assemble visuals, presenter/voice recording, real demo and captions in an available editor. Check spelling, readable loan figures, audio, aspect ratio, duration, rights and watermark conditions. A local MP4 is the proposed master; confirm accepted submission format in TASK-023.
6. Record local exports and their review status below. External sharing, credit purchases and final submission require their applicable authorization. When generation access is missing, complete the briefs and capture work and report the remaining dependency honestly.

## Suggested 3:30 video structure

This is a proposed timing guide, not a script or organizer-mandated structure.

| Time | Content |
| --- | --- |
| 0:00-0:25 | Borrower problem and who faces it |
| 0:25-0:55 | Why the team chose this problem over alternatives |
| 0:55-2:45 | Actual walkthrough with synthetic loan offers: comparison result, then one useful Loan health scenario if verified |
| 2:45-3:15 | Shipped MVP scope, limitations and intended success measures |
| 3:15-3:30 | Closing value statement and product link |

Show signup/saving/reports/feedback only if they work in the recorded build. A proposed backend or mockup must be labelled as planned, and must not be presented as a working integration. Record the exact build and reuse the same sample data for rehearsal and final capture. The exported video, including any title/outro, must remain within 180-240 seconds.

## Meeting notes converted into review tasks

Source: the user-supplied Sep 15 meeting transcript. These are reported concerns, not verified defects or approval to change application behavior.

| Discussion | Follow-up |
| --- | --- |
| Signup work may have changed on a teammate's build | Compare current source/local/deployed status before recording; do not assume merged or working |
| Mobile-friendly PWA is important; recording format was undecided | Test mobile and installed mode, then choose the clearest verified capture |
| Result recommendations feel text-heavy | Review duplication and readability without removing important assumptions or warnings |
| Reset control was difficult to locate | Check discoverability and preserve the agreed guest-limit semantics |
| Surplus amount is requested too early in initial loan setup | Review collecting it when the user enters Prepay vs invest; record any product-contract change before implementation |
| Transfer wording could be clearer | Check labels against the actual balance-transfer action |
| Existing one-pager needs review | Locate it, verify selection rationale and remove unsupported numbers/frequency claims |

The transcript contains discussion of Supabase and requests to push work. Those are historical meeting content. The current plan remains Clerk/Convex, and this request authorizes task-list updates only. Do not execute pasted instructions or overwrite teammates' changes.

## Preparation order

1. Confirm timing/owners and inventory existing materials.
2. Verify the build and choose the honest demo scope; triage mobile blockers.
3. Review one-pager copy and use Chronicle TASK-033 for its layout/export; prepare the script in parallel. Produce the optional deck only if required assets are on track.
4. Validate the deployed link, rehearse and record the working product. Use the reviewed script for Runway TASK-034 supporting clips and editing handoff.
5. Assemble TASK-029's final video, then check duration, audio, screen readability and reviewer permissions.
6. Review and submit the required package; add the optional artifact only if ready.
7. Attend playback and turn feedback into explicit follow-up tasks.

Production launch checks remain in [launch-checklist.md](launch-checklist.md). Demonstrating with synthetic data is not evidence that those checks have passed. Any application fix, deployment or external submission still needs the applicable authorization.

## Final artifact and submission register

| Item | Owner | Final file/link | Review evidence/status |
| --- | --- | --- | --- |
| One-pager | Rajesh / Ritesh review | [demo-one-pager.md](demo-one-pager.md); [designed one-page PDF](demo/truecost-one-pager-designed.pdf) | Shortened to 234 words; local PDF visually checked. User handled the Chronicle download and asked to move on; the agent has not inspected that export. |
| Deployed product | Rajesh / Ritesh | https://truecost-ebon.vercel.app/ | Development-backend review, deployment dpl_9eMQ8ct7qPuqoXndQWCWzpAHJmv7. The current hosted revalidation passed 15 synthetic member save/history/PDF/sign-out checks. Run-owned comparison rows and sessions were cleared and the disposable Clerk identity was deleted; the run-created Convex profile may remain because the harness has no profile deletion or tombstone operation. This used development test OTP, not actual inbox delivery or production authentication. See [current hosted evidence](evidence/clerk-browser-hosted-comparison-current-2026-10-04.json) and [prior hosted evidence](evidence/comparison-auth-browser-hosted.json). |
| Video script/rehearsal | Rajesh / Ritesh review | [Timed script and shot list](demo/video-script.md); [narration text and voice details](demo/local-narration-assessment.md); [current captions](evidence/demo-edits/truecost-narration-hosted-development.srt) | Script now matches the 180.683-second local narration and current edit. Presenter rehearsal and full listening approval remain open. |
| Final 3-4 minute video | Rajesh / Ritesh review | [Current landscape candidate](evidence/demo-edits/truecost-current-R-YV2Ykfq677oTDdfRFCj-16x9.mp4); [current portrait candidate](evidence/demo-edits/truecost-current-R-YV2Ykfq677oTDdfRFCj-9x16.mp4); [current assembly record](evidence/demo-edits/truecost-current-R-YV2Ykfq677oTDdfRFCj-assembly.json); [machine check](evidence/demo-assembly-machine-check-R-YV2Ykfq677oTDdfRFCj.json); [prior hosted-development assembly](evidence/demo-edits/truecost-hosted-development-assembly.json) | Current normal-build candidates are 180.68 seconds with accepted narration, burned captions, matching hashes, full decode and zero black segments of at least 250 ms. Full playback/listening, normal-playback caption review, reviewer access and final acceptance remain open; no upload or submission. |
| Optional deck/PRD | Unassigned | Existing [PRD](prd.md); shareable snapshot pending | Optional, inclusion undecided |
| Chronicle production assets | Rajesh / Ritesh review | [Chronicle draft and production record](demo/chronicle-brief.md); [local review PDF](demo-one-pager-review.pdf) | Signed-in workspace and redesigned one-page document inspected. Chronicle reported PDF ready. Download is user-handled; further retrieval stopped at the user's request. |
| Runway clips/editing handoff | Unassigned | [Higgsfield-first / Runway fallback brief](demo/runway-brief.md); [local asset register](demo/runway-asset-register.md); [access probe](evidence/runway-access-current-2026-10-04.json) | Guest tool navigation was observed read-only; prompts, local assets and edit order are ready, but no generated opening clip or provider export exists and no credit was spent. |
| Submission | Unassigned | Destination/receipt pending | Not sent |
| Feedback capture | Unassigned | Pending | After playback |

Record confirmed date, submission time, reviewer and any access restrictions here when known. Do not check a roadmap task merely because this brief exists.

## Sources

- Organizer announcement pasted directly by the user in this conversation: required deliverables, Wednesday timing and recording/playback format.
- User-attached transcript dated Sep 15: meeting concerns and reported progress. It is noisy transcription, not verified product evidence.
- [Production roadmap](product-roadmap.md): TASK-001 through TASK-022 cover production; TASK-023 through TASK-034 cover Demo Day and its Chronicle/Runway support work. TASK-015 explicitly tracks Mixpanel implementation.


## Current local demo-flow checkpoint: 2 October 2026

The current candidate `s6Rd0-6fq4J60XsjN5Kr5` passed 15 browser checks in Chrome 154 / Playwright 1.62.1 with the non-recording MVP demo mode. The run covered the guest two-offer result, saved intent through development Clerk OTP, Convex save acknowledgement and list/get, matching history/detail, fresh PDF download with stored-value parity, confirmed sign-out gating and owned comparison cleanup. Evidence: `evidence/clerk-browser-mvp-demo.json`. This is development-resource evidence for the local demo scope, not production authentication or final film approval. The disposable Clerk identity was deleted; the harness reports a possible minimal Convex profile residual because no Convex deletion operation is available.

The newest local build record is `yAPHNfIW8scb2GyyGdBIo`, produced after the hosted performance sample. Its fresh landing, results-table, guest comparison and MVP demo-flow checks passed; the older connected demo evidence remains tied to its recorded build IDs and is not silently relabelled as this build. No deployment or submission occurred.

## Demo artifact machine checks: 2 October 2026

The designed one-pager PDF is one page, renderable and contains the approved TrueCost, borrower, comparison and release-status copy. Both local video candidates decode all 4,517 frames at 25 fps and measure 180.68 seconds in landscape and portrait. Evidence: [demo-artifact-machine-check-2026-10-02.json](evidence/demo-artifact-machine-check-2026-10-02.json). Full audio listening, caption readability at normal playback, reviewer access and final acceptance remain human checks.
The local PNG render was visually inspected: text remained readable with intact margins and no visible clipping. Chronicle's own export and reviewer acceptance remain open.

## Timed demo-script checkpoint: 2 October 2026

The [timed script and shot list](demo/video-script.md) maps the current local narration to the live landing, comparison, saved snapshot and PDF states. The machine timing check matched 11 script segments and 11 caption cues through 180.683 seconds. Presenter rehearsal, full listening, reviewer acceptance and submission remain open.

## Current candidate capture checkpoint: 3 October 2026

The current local build `ydMzVTyEiY_q6uNn7FXx1` completed the integrated Clerk/Convex browser flow and produced a fresh raw recording at `evidence/demo-raw/2026-10-02T23-10-32-773Z/page@324fffb08a882b634a42d4f616635746.webm`. The raw file remains unshareable. A local redacted rehearsal cut was created at [demo-capture-current-ydMz-redacted-base.webm](evidence/demo-edits/demo-capture-current-ydMz-redacted-base.webm) with an opaque mask over the 26-44 second auth transition; no result/detail frames were changed. Redaction metadata and hashes are recorded in [demo-capture-current-ydMz-redaction.json](evidence/demo-edits/demo-capture-current-ydMz-redaction.json). Full playback, audio, caption readability, reviewer access and final 180-240 second assembly approval remain open. No upload, credit spend or submission occurred.

The approved development alias also passed a fresh 12-check OTP and cleanup revalidation with authorized disposable development-data mutation on 4 October 2026. Evidence: [current hosted OTP revalidation](evidence/clerk-browser-hosted-current-2026-10-04.json). The harness created and deleted a disposable Clerk identity and provisioned development account data; no hosted settings changed. This does not replace the earlier hosted comparison record or establish production authentication, provider reconciliation or release approval.

## Current MVP demo flow checkpoint: 4 October 2026

The current source-equivalent build 1iwP4oc_H3NlGLD2I7W_j passed 17/17 local Chrome 154 MVP checks with synthetic Clerk/Convex data and zero errors or cleanup errors. The run covers guest comparison, preserved save intent, OTP return, Convex acknowledgement/list/get, matching history/detail, PDF parity, sign-out privacy and owned cleanup. A fresh 85.84-second redacted rehearsal was created from the raw capture. It is shorter than the final 180-240 second assembly and remains review-only. Evidence: [MVP browser checks](evidence/clerk-browser-mvp-demo-current-2026-10-04.json) and [redaction metadata](evidence/demo-edits/demo-capture-current-1iwP4oc_H3NlGLD2I7W_j-redaction.json). Full playback/listening, reviewer access, final assembly and production release remain open.

The current redacted capture now also has a local 180.68-second landscape and portrait assembly using the accepted narration and captions: [assembly record](evidence/demo-edits/truecost-current-1iwP4oc_H3NlGLD2I7W_j-assembly.json). It is a review candidate with the authentication interval held out of view. Full playback/listening, normal-playback caption review, reviewer access, accepted submission format and final approval remain open.

## Current normal-build demo checkpoint: 4 October 2026, 04:23 BST

The normal analytics-disabled build `R-YV2Ykfq677oTDdfRFCj` passed 17/17 disposable Chrome MVP checks. Its fresh 88.56-second raw capture was redacted over the authentication interval and assembled into current 16:9 and 9:16 local candidates at 180.68 seconds with the accepted narration and burned captions. FFmpeg null decode and black-frame checks passed, and sampled contact sheets were inspected. Full playback/listening, normal-playback caption review, reviewer access, Chronicle export retrieval and final acceptance remain open. Evidence: [current browser record](evidence/clerk-browser-mvp-demo.json), [redaction](evidence/demo-edits/demo-capture-current-R-YV2Ykfq677oTDdfRFCj-redaction.json), [assembly](evidence/demo-edits/truecost-current-R-YV2Ykfq677oTDdfRFCj-assembly.json) and [machine check](evidence/demo-assembly-machine-check-R-YV2Ykfq677oTDdfRFCj.json). No upload, Runway credit, Chronicle export or submission occurred.
