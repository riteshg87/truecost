# Explicit browser cleanup integration contract

17 September 2026. TASK-014 work in progress; this document is not acceptance evidence.

## Action and boundary

Offer a public, signed-out action named **Clear private data from this browser**. Opening it does nothing destructive. Confirming explicitly authorizes removal of member-private cached loan/comparison payloads and unsynced queues for every account on this browser. State that the guest comparison, preferences and public offline resources remain; cloud records and downloaded files are unaffected. Retain minimal deletion-request recovery metadata so authenticated recovery can still reconcile the server request.

Do not read an owner from the unsigned journal. Keep the existing authenticated receipt-bound selective recovery separate.

## Required integration

- Put progress above keyed private store trees; make the action reachable from the public page after a reload. Require loaded signed-out identity, including a live guard at confirmation and every awaited boundary. Cancel a stale confirmation after an account change.
- Before storage work, invalidate private runtime capabilities synchronously and notify other tabs through a dedicated browser-cleanup signal. This signal means lock local access, never server deletion or authenticated membership. React state changes alone must not leave an old async callback current during the next microtask.
- Loan, comparison and history workspaces must stop pumps, release private in-memory data and report URLs, and reject old callbacks. Durable per-database epochs provide writer protection when notifications are unavailable. A new explicitly verified runtime may subsequently read cloud data again.
- Dispose member analytics memory/SDK persistence locally. Do not call AnalyticsProvider.withdraw for this purpose: it writes a declined preference and may call the backend. Preserve the user's consent preference.
- Clear only named member feedback/analytics transient keys, not all localStorage/sessionStorage. Preserve guest data, preferences, PWA caches and the deletion journal.
- Clear both private databases using the reviewed removal-only API. Cross-database atomicity is unavailable: partial success remains retry, never completed. A retry is idempotent and carries no inferred account identity.
- Success text describes browser cleanup only. It must not imply server deletion, provider completion, or removal of already downloaded reports.

## Acceptance still required

Cancel and duplicate-click handling; loaded/signed-out gating; stale confirmation after account change; both databases with A and B records; migration preserving data before confirmation; late and absent-row writers; interruption between databases; blocked storage and retry; signal fallback; guest/PWA preservation; local analytics disposal without consent mutation/network; real-browser keyboard/focus and multi-tab checks.

## Review clarifications

- Preserve pending analytics withdrawal markers. They are durable privacy intent, not disposable tracking identity. Removing them before server acknowledgement could permit tracking to resume from an older accepted preference.
- The local analytics result must cover runtime/SDK disposal and namespaced storage removal together. A successful feedback-key removal alone cannot establish complete cleanup. A delayed preference read or SDK factory must remain fenced.
- Durable database epochs reject writers that captured an older epoch. An initial open delayed until after clearing additionally requires runtime invalidation; do not claim database epochs alone distinguish that old operation. Cross-tab signal availability is not an acknowledgement from every tab. Browser acceptance must test the actual receiving runtime and clearly describe notification failures.
