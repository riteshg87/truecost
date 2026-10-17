import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { consumeSensitiveGrant } from "./privacyGrants";
import { exportRevisionOf } from "./exportRevision";

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_PAGE_ITEMS = 50;
const MAX_ROWS_READ = 100;
const MAX_BYTES_READ = 512 * 1024;
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sessionStatus = v.union(v.literal("active"), v.literal("completed"), v.literal("aborted"), v.literal("expired"));
const sessionView = v.object({
  _id: v.id("exportSessions"),
  expectedRevision: v.number(),
  cutoffAt: v.number(),
  createdAt: v.number(),
  expiresAt: v.number(),
  status: sessionStatus,
});
const beginResult = v.object({
  status: v.union(v.literal("started"), v.literal("replayed")),
  session: sessionView,
});
const beginLimited = v.object({ status: v.literal("limited"), code: v.literal("active_export"), retryAfterMs: v.number(), message: v.string() });
const beginRateLimited = v.object({ status: v.literal("limited"), code: v.literal("rate_limited"), retryAfterMs: v.number(), message: v.string() });
const abortedResult = v.object({ status: v.literal("aborted"), code: v.union(v.literal("changed"), v.literal("expired")), message: v.string() });
const comparisonExport = v.object({
  resultId: v.string(), snapshot: v.string(), title: v.union(v.string(), v.null()), source: v.union(v.literal("guest"), v.literal("member")),
  createdAt: v.string(), calculationVersion: v.string(),
});
const feedbackExport = v.object({
  kind: v.union(v.literal("submitted"), v.literal("dismissed")), feature: v.union(v.literal("comparison"), v.literal("loan_health")),
  contextId: v.string(), contextVersion: v.string(), answer: v.union(v.literal("yes"), v.literal("no"), v.null()), comment: v.union(v.string(), v.null()), createdAt: v.number(),
});
const loanRecordExport = v.object({ lender: v.string(), original: v.number(), outstanding: v.number(), ratePct: v.number(), basis: v.union(v.literal("repo"), v.literal("tbill"), v.literal("mclr"), v.literal("fixed")), spreadPct: v.union(v.number(), v.null()), spreadProvenance: v.optional(v.union(v.literal("confirmed"), v.literal("unknown"), v.literal("legacy"))), cycle: v.union(v.literal("monthly"), v.literal("quarterly"), v.literal("half")), lastReset: v.string(), lastResetProvenance: v.optional(v.union(v.literal("confirmed"), v.literal("unknown"), v.literal("legacy"))), monthsLeft: v.number() });
const quoteExport = v.object({ newRatePct: v.number(), feePct: v.number(), legalCharges: v.number(), keepTenure: v.boolean(), newTenureMonths: v.number() });
const savedLoanExport = v.union(v.object({
  loan: loanRecordExport, quote: quoteExport, surplus: v.number(), bufferMonths: v.number(), rateResolvedAt: v.union(v.string(), v.null()), updatedAt: v.number(),
}), v.null());
const comparisonPage = v.union(v.object({ status: v.literal("ok"), expectedRevision: v.number(), result: paginationResultValidator(comparisonExport) }), abortedResult);
const feedbackPage = v.union(v.object({ status: v.literal("ok"), expectedRevision: v.number(), result: paginationResultValidator(feedbackExport) }), abortedResult);
const savedLoanResult = v.union(v.object({ status: v.literal("ok"), expectedRevision: v.number(), payload: savedLoanExport }), abortedResult);
const finalizeResult = v.union(v.object({ status: v.literal("finalized"), expectedRevision: v.number() }), abortedResult);

type AuthContext = QueryCtx | MutationCtx;
type Access = { owner: Doc<"users">; subject: string; clerkSessionId: string };

async function access(ctx: AuthContext): Promise<Access> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.tokenIdentifier || !identity.subject || typeof identity.sid !== "string" || !identity.sid) throw new Error("Export authentication unavailable");
  const owner = await ctx.db.query("users").withIndex("by_authKey", (q) => q.eq("authKey", identity.tokenIdentifier!)).unique();
  if (!owner || owner.status !== "active" || owner.clerkSubject !== identity.subject) throw new Error("Export account unavailable");
  return { owner, subject: identity.subject, clerkSessionId: identity.sid };
}

function validateRequestId(value: string): string {
  if (typeof value !== "string" || !requestIdPattern.test(value)) throw new Error("Export request ID is invalid");
  return value;
}

async function sessionAccess(ctx: MutationCtx, sessionId: Id<"exportSessions">): Promise<{ access: Access; session: Doc<"exportSessions">; revision: number } | { aborted: "changed" | "expired" }> {
  const current = await access(ctx);
  const session = await ctx.db.get(sessionId);
  const now = Date.now();
  if (!session || session.ownerId !== current.owner._id || session.clerkSessionId !== current.clerkSessionId || session.status !== "active") return { aborted: "expired" };
  if (session.expiresAt <= now) {
    await ctx.db.patch(session._id, { status: "expired" });
    return { aborted: "expired" };
  }
  const revision = exportRevisionOf(current.owner.exportRevision);
  if (revision !== session.expectedRevision) {
    // The owner and Clerk session were checked above, so close only this
    // caller's active session and let a replacement export start immediately.
    await ctx.db.patch(session._id, { status: "aborted" });
    return { aborted: "changed" };
  }
  return { access: current, session, revision };
}

function abortMessage(code: "changed" | "expired") {
  return code === "changed" ? "Account data changed while this export was running; start again." : "This export session expired; start again.";
}

export const beginExport = mutation({
  args: { grantId: v.id("sensitiveGrants"), requestId: v.string() },
  returns: v.union(beginResult, beginLimited, beginRateLimited),
  handler: async (ctx, args) => {
    const current = await access(ctx);
    const requestId = validateRequestId(args.requestId);
    const now = Date.now();
    const existing = await ctx.db.query("exportSessions").withIndex("by_owner_requestId", (q) => q.eq("ownerId", current.owner._id).eq("requestId", requestId)).unique();
    if (existing) {
      if (existing.grantId !== args.grantId || existing.clerkSessionId !== current.clerkSessionId || existing.status === "aborted" || existing.status === "expired" || existing.expiresAt <= now) throw new Error("Export request cannot be replayed");
      return { status: "replayed" as const, session: { _id: existing._id, expectedRevision: existing.expectedRevision, cutoffAt: existing.cutoffAt, createdAt: existing.createdAt, expiresAt: existing.expiresAt, status: existing.status } };
    }
    const active = await ctx.db.query("exportSessions").withIndex("by_owner_status_expiresAt", (q) => q.eq("ownerId", current.owner._id).eq("status", "active").gt("expiresAt", now)).take(1);
    if (active.length > 0) return { status: "limited" as const, code: "active_export" as const, retryAfterMs: Math.max(1, active[0].expiresAt - now), message: "An export is already running; retry after it finishes" };
    const windowStart = now - SESSION_TTL_MS;
    const recent = await ctx.db.query("exportSessions").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", current.owner._id).gte("createdAt", windowStart)).take(6);
    if (recent.length >= 5) {
      const oldest = Math.min(...recent.map((session) => session.createdAt));
      return { status: "limited" as const, code: "rate_limited" as const, retryAfterMs: Math.max(1, oldest + SESSION_TTL_MS - now), message: "Export limit reached; try again later" };
    }
    const audience = process.env.TRUECOST_PRIVACY_AUDIENCE;
    if (!audience) throw new Error("Export approval unavailable");
    // Touch the owner row to serialize concurrent begin requests for the same
    // request ID. This does not change the exported revision.
    await ctx.db.patch(current.owner._id, { updatedAt: current.owner.updatedAt });
    await consumeSensitiveGrant(ctx, args.grantId, { ownerId: current.owner._id, subject: current.subject, sessionId: current.clerkSessionId, audience, purpose: "account_export" });
    const expectedRevision = exportRevisionOf(current.owner.exportRevision);
    const sessionId = await ctx.db.insert("exportSessions", {
      ownerId: current.owner._id, requestId, clerkSessionId: current.clerkSessionId, grantId: args.grantId,
      expectedRevision, cutoffAt: now, createdAt: now, expiresAt: now + SESSION_TTL_MS, status: "active",
    });
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Export session creation failed");
    return { status: "started" as const, session: { _id: session._id, expectedRevision: session.expectedRevision, cutoffAt: session.cutoffAt, createdAt: session.createdAt, expiresAt: session.expiresAt, status: session.status } };
  },
});

function pageArgs() {
  return { sessionId: v.id("exportSessions"), paginationOpts: paginationOptsValidator };
}

export const pageComparisons = mutation({
  args: pageArgs(),
  returns: comparisonPage,
  handler: async (ctx, args) => {
    const state = await sessionAccess(ctx, args.sessionId);
    if ("aborted" in state) return { status: "aborted" as const, code: state.aborted, message: abortMessage(state.aborted) };
    const pagination = args.paginationOpts;
    if (!Number.isInteger(pagination.numItems) || pagination.numItems < 1 || pagination.numItems > MAX_PAGE_ITEMS) throw new Error("Export page size is invalid");
    const result = await ctx.db.query("comparisons").withIndex("by_owner", (q) => q.eq("ownerId", state.access.owner._id).lte("_creationTime", state.session.cutoffAt)).order("asc").paginate({ ...pagination, numItems: Math.min(pagination.numItems, MAX_PAGE_ITEMS), maximumRowsRead: MAX_ROWS_READ, maximumBytesRead: MAX_BYTES_READ });
    return { status: "ok" as const, expectedRevision: state.revision, result: { ...result, page: result.page.map((row) => ({ resultId: row.resultId, snapshot: row.snapshot, title: row.title, source: row.source, createdAt: row.createdAt, calculationVersion: row.calculationVersion })) } };
  },
});

export const pageFeedback = mutation({
  args: pageArgs(),
  returns: feedbackPage,
  handler: async (ctx, args) => {
    const state = await sessionAccess(ctx, args.sessionId);
    if ("aborted" in state) return { status: "aborted" as const, code: state.aborted, message: abortMessage(state.aborted) };
    const pagination = args.paginationOpts;
    if (!Number.isInteger(pagination.numItems) || pagination.numItems < 1 || pagination.numItems > MAX_PAGE_ITEMS) throw new Error("Export page size is invalid");
    const result = await ctx.db.query("feedback").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", state.access.owner._id).lte("createdAt", state.session.cutoffAt)).order("asc").paginate({ ...pagination, numItems: Math.min(pagination.numItems, MAX_PAGE_ITEMS), maximumRowsRead: MAX_ROWS_READ, maximumBytesRead: MAX_BYTES_READ });
    const page = result.page.map((row) => ({ kind: "submitted" as const, feature: row.feature, contextId: row.contextId, contextVersion: row.contextVersion, answer: row.answer, comment: row.comment, createdAt: row.createdAt }));
    return { status: "ok" as const, expectedRevision: state.revision, result: { ...result, page } };
  },
});

export const pageFeedbackDismissals = mutation({
  args: pageArgs(),
  returns: feedbackPage,
  handler: async (ctx, args) => {
    const state = await sessionAccess(ctx, args.sessionId);
    if ("aborted" in state) return { status: "aborted" as const, code: state.aborted, message: abortMessage(state.aborted) };
    const pagination = args.paginationOpts;
    if (!Number.isInteger(pagination.numItems) || pagination.numItems < 1 || pagination.numItems > MAX_PAGE_ITEMS) throw new Error("Export page size is invalid");
    const result = await ctx.db.query("feedbackDismissals").withIndex("by_owner_createdAt", (q) => q.eq("ownerId", state.access.owner._id).lte("createdAt", state.session.cutoffAt)).order("asc").paginate({ ...pagination, numItems: Math.min(pagination.numItems, MAX_PAGE_ITEMS), maximumRowsRead: MAX_ROWS_READ, maximumBytesRead: MAX_BYTES_READ });
    return { status: "ok" as const, expectedRevision: state.revision, result: { ...result, page: result.page.map((row) => ({ kind: "dismissed" as const, feature: row.feature, contextId: row.contextId, contextVersion: row.contextVersion, answer: null, comment: null, createdAt: row.createdAt })) } };
  },
});

export const getSavedLoan = mutation({
  args: { sessionId: v.id("exportSessions") },
  returns: savedLoanResult,
  handler: async (ctx, args) => {
    const state = await sessionAccess(ctx, args.sessionId);
    if ("aborted" in state) return { status: "aborted" as const, code: state.aborted, message: abortMessage(state.aborted) };
    const row = await ctx.db.query("savedLoans").withIndex("by_owner", (q) => q.eq("ownerId", state.access.owner._id)).unique();
    const payload = row && row.updatedAt <= state.session.cutoffAt ? { loan: row.loan, quote: row.quote, surplus: row.surplus, bufferMonths: row.bufferMonths, rateResolvedAt: row.rateResolvedAt, updatedAt: row.updatedAt } : null;
    return { status: "ok" as const, expectedRevision: state.revision, payload };
  },
});

export const finalizeExport = mutation({
  args: { sessionId: v.id("exportSessions") },
  returns: finalizeResult,
  handler: async (ctx, args) => {
    const current = await access(ctx);
    const session = await ctx.db.get(args.sessionId);
    const now = Date.now();
    if (!session || session.ownerId !== current.owner._id || session.clerkSessionId !== current.clerkSessionId) return { status: "aborted" as const, code: "expired" as const, message: abortMessage("expired") };
    const revision = exportRevisionOf(current.owner.exportRevision);
    if (session.expiresAt <= now || session.status === "expired" || session.status === "aborted") return { status: "aborted" as const, code: "expired" as const, message: abortMessage("expired") };
    if (revision !== session.expectedRevision) {
      if (session.status === "active") await ctx.db.patch(session._id, { status: "aborted" });
      return { status: "aborted" as const, code: "changed" as const, message: abortMessage("changed") };
    }
    if (session.status === "completed") return { status: "finalized" as const, expectedRevision: revision };
    await ctx.db.patch(session._id, { status: "completed" });
    return { status: "finalized" as const, expectedRevision: revision };
  },
});

export const purgeExpiredState = internalMutation({
  args: {},
  returns: v.object({ sessionsDeleted: v.number(), grantsDeleted: v.number(), continuationScheduled: v.boolean() }),
  handler: async (ctx) => {
    const cutoff = Date.now();
    const sessions = await ctx.db.query("exportSessions").withIndex("by_expiresAt", (q) => q.lte("expiresAt", cutoff)).take(100);
    // Keep expired grants through the full issuance window so cleanup cannot
    // reset the per-owner 10-minute rate limit.
    const grants = await ctx.db.query("sensitiveGrants").withIndex("by_expiresAt", (q) => q.lte("expiresAt", Math.floor(cutoff / 1000) - 600)).take(100);
    for (const session of sessions) await ctx.db.delete(session._id);
    for (const grant of grants) await ctx.db.delete(grant._id);
    const continuationScheduled = sessions.length === 100 || grants.length === 100;
    if (continuationScheduled) await ctx.scheduler.runAfter(0, internal.accountExports.purgeExpiredState, {});
    return { sessionsDeleted: sessions.length, grantsDeleted: grants.length, continuationScheduled };
  },
});
