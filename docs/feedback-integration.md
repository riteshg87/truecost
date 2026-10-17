# Feedback integration (TASK-013B)

This slice supplies the member feedback context, session-bound transport, and
prompt component. Root integrated MemberComparisonFeedback into current and
saved comparison result routes. Loan health integration and live development
provider verification remain open.

## Contexts

Comparison feedback uses the existing immutable comparison `resultId` as its
context UUID:

```ts
comparisonFeedbackContext(resultId)
```

Loan Health feedback accepts a caller-issued opaque UUID:

```ts
loanHealthFeedbackContext(suggestionId)
```

The caller must issue a new suggestion identity when the suggestion changes.
The current v1 client does not claim that an arbitrary client UUID proves a
calculation happened. The later Loan Health integration should derive a stable
opaque suggestion context from the account-owned loan revision plus methodology
version, without sending finance values or a finance hash. This keeps an
unsaved suggestion eligible for feedback while giving changed suggestions a
new context.

The Loan Health provider now exposes `loanHealthSuggestionId`. A queued save's
opaque outbox request ID is surfaced as `sync.pendingRequestId` and is used to
find the account-scoped context mapping across a reload. The provider carries
that mapping from the queued save to its acknowledged revision, so an
acknowledgement does not create a second prompt. A dirty unsaved draft receives
an in-memory opaque ID that rotates with the draft version; once the draft is
acknowledged, the same ID is retained for that suggestion. The saved fallback
uses the account revision slot. None of these slots contain loan values.

`rememberFeedbackContext` and `readRememberedFeedbackContext` store only
`feature`, `contextId`, and `contextVersion` in account-namespaced
`sessionStorage`. They support an ordinary reload in the same tab. Answers,
comments, snapshots, loan values, and tokens are never stored. The integration
must call `forgetRememberedFeedbackContext` after confirmed sign-out or account
switch; ordinary component unmount does not clear the metadata.

## Transport contract

`createSessionBoundFeedbackTransport` captures the private session identity and
requires a current grant before token access, before the Convex request, and
after its response. It validates the token subject, session, audience, and
expiry, sends no cookies, and uses no-store requests. A late callback after
sign-out or account switch is rejected as `unauthorized`.

`submit` and `dismiss` take a caller-owned stable UUID request ID. The prompt
keeps that ID and its comment only in memory after a failed request, so a user
can retry a possible lost acknowledgement with the identical payload. A
changed answer or comment starts a new request ID. There is no automatic retry.
The server's submitted/dismissed status is terminal, so a later status check
removes the prompt instead of showing it again.

## Prompt behavior

`FeedbackPrompt` renders after a status check reports `available`. It renders
no feedback prompt for `submitted` or `dismissed`. It requires an explicit Yes
or No action, accepts an optional comment up to 1,000 characters, and performs
network work only after the corresponding button gesture. React text rendering
keeps comment content as text; no HTML is interpreted.

The component does not persist feedback or finance data and does not clear a
context during an ordinary unmount. A session-bound transport supplies the
account/sign-out boundary; route wiring should discard the old component when
the grant or account changes.

## Verification and limits

The dedicated tests cover contract-only requests, token/session binding, stale
callbacks, lost-acknowledgement retries with one stable request ID, terminal
status suppression, comment retention, and prompt replacement after a context
change. The combined root run passed 30 tests across backend, transport, prompt
and comparison account-boundary suites; TypeScript passed. Browser/provider
verification and Loan health route wiring remain pending.

The installed Convex CLI's codegen path was inspected read-only in
`node_modules/convex/dist/cli.bundle.cjs`: it starts a deployment push to
upload the bundle/schema for analysis and generated bindings, while the normal
deploy path separately finishes the push. That source does not establish
retention or activation semantics, so this frontend slice does not run codegen
or deploy anything.
