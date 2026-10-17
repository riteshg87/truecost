import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const userStatus = v.union(
  v.literal("active"),
  v.literal("deleting"),
  v.literal("deleted"),
);

const loanBasis = v.union(
  v.literal("repo"),
  v.literal("tbill"),
  v.literal("mclr"),
  v.literal("fixed"),
);

const resetCycle = v.union(
  v.literal("monthly"),
  v.literal("quarterly"),
  v.literal("half"),
);

const loanInputProvenance = v.union(
  v.literal("confirmed"),
  v.literal("unknown"),
  v.literal("legacy"),
);

const loanRecord = v.object({
  lender: v.string(),
  original: v.number(),
  outstanding: v.number(),
  ratePct: v.number(),
  basis: loanBasis,
  spreadPct: v.union(v.number(), v.null()),
  spreadProvenance: v.optional(loanInputProvenance),
  cycle: resetCycle,
  lastReset: v.string(),
  lastResetProvenance: v.optional(loanInputProvenance),
  monthsLeft: v.number(),
});

const transferQuote = v.object({
  newRatePct: v.number(),
  feePct: v.number(),
  legalCharges: v.number(),
  keepTenure: v.boolean(),
  newTenureMonths: v.number(),
});

const savedLoanPayload = v.object({
  loan: loanRecord,
  quote: transferQuote,
  surplus: v.number(),
  bufferMonths: v.number(),
  rateResolvedAt: v.union(v.string(), v.null()),
});

const comparisonSource = v.union(v.literal("guest"), v.literal("member"));

const analyticsConsent = v.union(
  v.literal("declined"),
  v.literal("accepted"),
);

const feedbackFeature = v.union(
  v.literal("comparison"),
  v.literal("loan_health"),
);

const feedbackAnswer = v.union(
  v.literal("yes"),
  v.literal("no"),
);

export default defineSchema({
  users: defineTable({
    authKey: v.string(),
    clerkSubject: v.string(),
    status: userStatus,
    exportRevision: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authKey", ["authKey"])
    .index("by_clerkSubject", ["clerkSubject"]),

  // A Clerk deletion event can arrive after the local profile has already
  // been purged. Keep this subject-level tombstone so a still-valid token
  // cannot provision the identity again.
  clerkDeletionTombstones: defineTable({
    clerkSubject: v.string(),
    eventId: v.string(),
    createdAt: v.number(),
  })
    .index("by_clerkSubject", ["clerkSubject"])
    .index("by_eventId", ["eventId"]),

  clerkWebhookReceipts: defineTable({
    eventId: v.string(),
    eventType: v.literal("user.deleted"),
    clerkSubject: v.string(),
    status: v.union(v.literal("processed"), v.literal("ignored")),
    jobId: v.union(v.id("accountDeletionJobs"), v.null()),
    processedAt: v.number(),
  })
    .index("by_eventId", ["eventId"])
    .index("by_clerkSubject", ["clerkSubject"]),

  savedLoans: defineTable({
    ownerId: v.id("users"),
    loan: loanRecord,
    quote: transferQuote,
    surplus: v.number(),
    bufferMonths: v.number(),
    rateResolvedAt: v.union(v.string(), v.null()),
    revision: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"]),

  operationReceipts: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    kind: v.union(v.literal("save"), v.literal("delete")),
    resourceKey: v.literal("savedLoan"),
    payloadHash: v.string(),
    expectedRevision: v.number(),
    revision: v.number(),
    status: v.union(v.literal("saved"), v.literal("deleted")),
    createdAt: v.number(),
    reviewAfter: v.number(),
  })
    .index("by_owner_requestId", ["ownerId", "requestId"])
    .index("by_reviewAfter", ["reviewAfter"]),

  recordTombstones: defineTable({
    ownerId: v.id("users"),
    entityKind: v.literal("savedLoan"),
    entityKey: v.literal("singleton"),
    revision: v.number(),
    deletedAt: v.number(),
    reviewAfter: v.number(),
  })
    .index("by_owner_entity", ["ownerId", "entityKind", "entityKey"])
    .index("by_reviewAfter", ["reviewAfter"]),

  comparisons: defineTable({
    ownerId: v.id("users"),
    resultId: v.string(),
    requestId: v.string(),
    snapshot: v.string(),
    payloadHash: v.string(),
    title: v.union(v.string(), v.null()),
    source: comparisonSource,
    createdAt: v.string(),
    calculationVersion: v.string(),
    reviewAfter: v.number(),
  })
    .index("by_owner_createdAt", ["ownerId", "createdAt"])
    .index("by_owner", ["ownerId"])
    .index("by_owner_resultId", ["ownerId", "resultId"]),

  comparisonReceipts: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    kind: v.union(v.literal("save"), v.literal("delete")),
    resultId: v.string(),
    comparisonId: v.union(v.id("comparisons"), v.null()),
    createdAt: v.string(),
    serverHash: v.string(),
    status: v.union(v.literal("saved"), v.literal("deleted")),
    reviewAfter: v.number(),
  })
    .index("by_owner_requestId", ["ownerId", "requestId"])
    .index("by_reviewAfter", ["reviewAfter"]),

  comparisonTombstones: defineTable({
    ownerId: v.id("users"),
    resultId: v.string(),
    deletedAt: v.number(),
    reviewAfter: v.number(),
  })
    .index("by_owner_resultId", ["ownerId", "resultId"])
    .index("by_reviewAfter", ["reviewAfter"]),

  comparisonRateLimits: defineTable({
    ownerId: v.id("users"),
    successfulAt: v.array(v.number()),
  }).index("by_owner", ["ownerId"]),

  analyticsPreferences: defineTable({
    ownerId: v.id("users"),
    consent: analyticsConsent,
    policyVersion: v.string(),
    revision: v.number(),
    // Retained after withdrawal only as the minimum internal key needed by a
    // later provider deletion workflow. It is never returned while declined.
    analyticsAccountId: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  // Internal, short-lived capability records for account export/deletion.
  // Issuance and consumption are deliberately kept out of the public API.
  sensitiveGrants: defineTable({
    ownerId: v.id("users"),
    subject: v.string(),
    sessionId: v.string(),
    audience: v.string(),
    purpose: v.union(v.literal("account_export"), v.literal("account_delete")),
    nonce: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    consumedAt: v.union(v.number(), v.null()),
  })
    .index("by_nonce", ["nonce"])
    .index("by_owner", ["ownerId"])
    .index("by_owner_consumedAt_expiresAt", ["ownerId", "consumedAt", "expiresAt"])
    .index("by_owner_issuedAt", ["ownerId", "issuedAt"])
    .index("by_expiresAt", ["expiresAt"]),

  feedback: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    feature: feedbackFeature,
    contextId: v.string(),
    contextVersion: v.string(),
    answer: feedbackAnswer,
    comment: v.union(v.string(), v.null()),
    payloadHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_owner_createdAt", ["ownerId", "createdAt"])
    .index("by_owner_context", ["ownerId", "feature", "contextId", "contextVersion"])
    .index("by_owner_requestId", ["ownerId", "requestId"]),

  feedbackDismissals: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    feature: feedbackFeature,
    contextId: v.string(),
    contextVersion: v.string(),
    payloadHash: v.string(),
    createdAt: v.number(),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_owner_createdAt", ["ownerId", "createdAt"])
    .index("by_owner_context", ["ownerId", "feature", "contextId", "contextVersion"])
    .index("by_owner_requestId", ["ownerId", "requestId"]),

  feedbackRateLimits: defineTable({
    ownerId: v.id("users"),
    successfulAt: v.array(v.number()),
  }).index("by_owner", ["ownerId"]),

  exportSessions: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    clerkSessionId: v.string(),
    grantId: v.id("sensitiveGrants"),
    expectedRevision: v.number(),
    cutoffAt: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("aborted"), v.literal("expired")),
  })
    .index("by_owner_requestId", ["ownerId", "requestId"])
    .index("by_owner", ["ownerId"])
    .index("by_owner_createdAt", ["ownerId", "createdAt"])
    .index("by_owner_status_expiresAt", ["ownerId", "status", "expiresAt"])
    .index("by_expiresAt", ["expiresAt"]),

  // Durable deletion state. This row is the minimum recovery record kept
  // after owner data is purged. Provider calls and Clerk identity deletion
  // are implemented in a later slice; this job must never claim completion
  // before those stages are confirmed.
  accountDeletionJobs: defineTable({
    ownerId: v.id("users"),
    requestId: v.string(),
    grantId: v.union(v.id("sensitiveGrants"), v.null()),
    subject: v.string(),
    sessionId: v.union(v.string(), v.null()),
    purpose: v.literal("account_delete"),
    analyticsAccountId: v.union(v.string(), v.null()),
    status: v.union(v.literal("app_pending"), v.literal("providers_pending"), v.literal("completed")),
    stage: v.union(v.literal("purge"), v.literal("providers")),
    purgeTable: v.union(v.string(), v.null()),
    purgeCursor: v.union(v.string(), v.null()),
    leaseUntil: v.union(v.number(), v.null()),
    attemptToken: v.union(v.string(), v.null()),
    attemptNumber: v.number(),
    // Provider coordination is optional for compatibility with foundation
    // rows written before provider orchestration was installed.
    providerStage: v.optional(v.union(
      v.literal("mixpanel_create_pending"),
      v.literal("mixpanel_create_in_flight"),
      v.literal("mixpanel_poll_pending"),
      v.literal("clerk_pending"),
      v.literal("manual_review"),
      v.literal("complete"),
    )),
    providerTrackingId: v.optional(v.union(v.string(), v.null())),
    providerLeaseUntil: v.optional(v.union(v.number(), v.null())),
    providerAttemptToken: v.optional(v.union(v.string(), v.null())),
    providerAttemptNumber: v.optional(v.number()),
    providerRetryCount: v.optional(v.union(v.number(), v.null())),
    providerPollCount: v.optional(v.union(v.number(), v.null())),
    providerPendingSince: v.optional(v.union(v.number(), v.null())),
    providerLastRetryCode: v.optional(v.union(
      v.null(),
      v.literal("timeout"),
      v.literal("network"),
      v.literal("rate_limited"),
      v.literal("server_error"),
    )),
    providerNextAttemptAt: v.optional(v.union(v.number(), v.null())),
    providerCode: v.optional(v.union(
      v.null(),
      v.literal("configuration"),
      v.literal("malformed_response"),
      v.literal("redirect_blocked"),
      v.literal("unexpected_status"),
      v.literal("provider_failure"),
      v.literal("ambiguous"),
    )),
    origin: v.optional(v.union(v.literal("user_requested"), v.literal("clerk_webhook"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_requestId", ["ownerId", "requestId"])
    .index("by_status_leaseUntil", ["status", "leaseUntil"]),
});
