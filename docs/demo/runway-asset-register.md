# TrueCost video asset register

Status: local editing handoff. A read-only Runway probe reached the guest tool navigation on 4 October; no Runway or Higgsfield generation was performed, no credits were spent, and no asset was uploaded. Evidence: `docs/evidence/runway-access-current-2026-10-04.json`.

## Approved opening brief

- Duration: 15 seconds.
- Shape: fictional Indian adults at a dining table with two generic home-loan offer sheets and an unidentifiable phone.
- Dialogue: “Rate kam hai, toh loan sasta hoga?” followed by “Pata nahi. Fees aur insurance bhi dekhte hain. Chalo TrueCost mein dono offers compare karte hain.”
- Restrictions: no real-person likeness, lender marks, readable personal data, financial advice, or text overlays.
- Prompts: `docs/demo/runway-brief.md` contains the 16:9 and 9:16 handoff prompts.
- Provider state: guest tool navigation is observed, while account access, export format, rights, watermark rules and zero-cost authorization remain unverified. The generated opening remains pending.

## Verified local assets

| Asset | Use | Format and measured state | Rights / privacy note |
| --- | --- | --- | --- |
| `docs/evidence/demo-edits/truecost-hosted-development-16x9.mp4` | Primary product-demo cut | H.264/AAC, 1920×1080, 180.683 s; SHA-256 `FEFF8F220AC9E3DEA286B7104E85536AB4CB982DB52405688D47BC0A93BE5149` | Local edit of the real hosted development flow with synthetic offers. |
| `docs/evidence/demo-edits/truecost-hosted-development-9x16.mp4` | Portrait product-demo cut | H.264/AAC, 1080×1920, 180.683 s; SHA-256 `F7EAA5305EC68A2C84604FA86DE02ECDD688845F5F000362F2BBFDA4FDF6CA3F` | Same footage and privacy omissions as the landscape cut. |
| `docs/evidence/demo-edits/truecost-narration-hosted-development-en-gb-george.wav` | Voice track | PCM WAV, mono, 22,050 Hz, 16-bit, 180.683 s | Locally generated English voice. Full listening review remains open. |
| `docs/evidence/demo-edits/truecost-narration-hosted-development.srt` | Caption timing | 11 cues, final cue ends at 180.683 s | Timings match the current narration; final readability review remains open. |
| `docs/demo/truecost-one-pager-designed.pdf` | Optional opening/closing visual | One-page local PDF | Local artwork. Chronicle export retrieval and approval remain open. |

## Edit order

1. Use the approved opening only after a zero-cost provider path and rights are verified. If it remains unavailable, start with the live landing page and label the cut as the local review candidate.
2. Use the real product footage from 00:07 onward according to `docs/demo/video-script.md`. Keep the guest offers, stored snapshot and PDF controls readable.
3. Keep the sign-in, OTP, inbox, address, token and provider-console portions omitted. Generated footage cannot stand in for those product states.
4. Use the existing English narration and caption sidecars. Re-measure the final take if the opening changes the timeline.
5. Export landscape and portrait masters, then check duration (180–240 seconds), audio, caption contrast, private-data redaction, full decode and reviewer playback before any share or submission.

## Open handoff gates

- Runway/Higgsfield access and export verification.
- Zero-cost generation and rights authorization for the opening.
- Full audio listening and caption review.
- Presenter/reviewer acceptance and final playback link.
- External upload or submission approval.
