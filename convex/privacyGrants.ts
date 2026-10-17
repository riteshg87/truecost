import { ConvexError, v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export const SENSITIVE_GRANT_MAX_AGE_SECONDS = 120;
const GRANT_ISSUANCE_WINDOW_SECONDS = 10 * 60;
const GRANT_ISSUANCE_LIMIT = 10;

export type SensitiveGrantPurpose = "account_export" | "account_delete";

export type SensitiveGrantExpectation = {
  ownerId: Id<"users">;
  subject: string;
  sessionId: string;
  audience: string;
  purpose: SensitiveGrantPurpose;
};

type GrantClaims = {
  subject: string;
  sessionId: string;
  audience: string;
  purpose: SensitiveGrantPurpose;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

const purposeValidator = v.union(v.literal("account_export"), v.literal("account_delete"));
const grantValidator = v.object({
  _id: v.id("sensitiveGrants"),
  _creationTime: v.number(),
  ownerId: v.id("users"),
  subject: v.string(),
  sessionId: v.string(),
  audience: v.string(),
  purpose: purposeValidator,
  nonce: v.string(),
  issuedAt: v.number(),
  expiresAt: v.number(),
  consumedAt: v.union(v.number(), v.null()),
});

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function requireBoundString(value: string, label: string): void {
  if (!value || value.length > 256) throw new Error(`Invalid sensitive grant ${label}`);
}

function validateClaims(claims: GrantClaims, nowSeconds: number): void {
  requireBoundString(claims.subject, "subject");
  requireBoundString(claims.sessionId, "session");
  requireBoundString(claims.audience, "audience");
  if (!isUuid(claims.nonce)) throw new Error("Invalid sensitive grant nonce");
  if (!Number.isSafeInteger(claims.issuedAt) || !Number.isSafeInteger(claims.expiresAt)) {
    throw new Error("Invalid sensitive grant timestamps");
  }
  if (claims.issuedAt < 0 || claims.expiresAt < 0 || claims.issuedAt > nowSeconds || claims.expiresAt <= nowSeconds) {
    throw new Error("Sensitive grant is expired or not yet valid");
  }
  if (claims.expiresAt <= claims.issuedAt || claims.expiresAt - claims.issuedAt > SENSITIVE_GRANT_MAX_AGE_SECONDS) {
    throw new Error("Sensitive grant lifetime is invalid");
  }
}

function sameGrant(row: Doc<"sensitiveGrants">, claims: GrantClaims, ownerId: Id<"users">): boolean {
  return row.ownerId === ownerId &&
    row.subject === claims.subject &&
    row.sessionId === claims.sessionId &&
    row.audience === claims.audience &&
    row.purpose === claims.purpose &&
    row.nonce === claims.nonce &&
    row.issuedAt === claims.issuedAt &&
    row.expiresAt === claims.expiresAt;
}

/**
 * Internal-only issuance boundary. The caller must already have verified the
 * auth key and claims; this mutation only binds them to the active profile and
 * records a replay-safe, short-lived capability.
 */
export const issueVerifiedGrant = internalMutation({
  args: {
    authKey: v.string(),
    subject: v.string(),
    sessionId: v.string(),
    audience: v.string(),
    purpose: purposeValidator,
    nonce: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
  },
  returns: grantValidator,
  handler: async (ctx, args): Promise<Doc<"sensitiveGrants">> => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    validateClaims(args, nowSeconds);

    const user = await ctx.db
      .query("users")
      .withIndex("by_authKey", (q) => q.eq("authKey", args.authKey))
      .unique();
    if (!user || user.status !== "active" || user.clerkSubject !== args.subject) {
      throw new Error("Sensitive grant owner is unavailable");
    }

    const existing = await ctx.db
      .query("sensitiveGrants")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (existing) {
      if (sameGrant(existing, args, user._id)) return existing;
      throw new Error("Sensitive grant nonce replay conflict");
    }
    const activeGrants = await ctx.db.query("sensitiveGrants").withIndex("by_owner_consumedAt_expiresAt", (q) => q.eq("ownerId", user._id).eq("consumedAt", null).gt("expiresAt", nowSeconds)).take(2);
    if (activeGrants.length >= 2) {
      throw new ConvexError({
        code: "active_grants",
        retryAfterMs: Math.max(1, Math.min(...activeGrants.map((grant) => grant.expiresAt)) - nowSeconds) * 1000,
      });
    }
    const recentGrants = await ctx.db.query("sensitiveGrants").withIndex("by_owner_issuedAt", (q) => q.eq("ownerId", user._id).gte("issuedAt", nowSeconds - GRANT_ISSUANCE_WINDOW_SECONDS)).take(GRANT_ISSUANCE_LIMIT + 1);
    if (recentGrants.length >= GRANT_ISSUANCE_LIMIT) {
      const oldest = Math.min(...recentGrants.map((grant) => grant.issuedAt));
      throw new ConvexError({
        code: "rate_limited",
        retryAfterMs: Math.max(1, oldest + GRANT_ISSUANCE_WINDOW_SECONDS - nowSeconds) * 1000,
      });
    }

    const id = await ctx.db.insert("sensitiveGrants", {
      ownerId: user._id,
      subject: args.subject,
      sessionId: args.sessionId,
      audience: args.audience,
      purpose: args.purpose,
      nonce: args.nonce,
      issuedAt: args.issuedAt,
      expiresAt: args.expiresAt,
      consumedAt: null,
    });
    const created = await ctx.db.get(id);
    if (!created) throw new Error("Sensitive grant creation failed");
    return created;
  },
});

/**
 * Consume a grant inside the caller's mutation transaction. The read and
 * patch participate in Convex OCC, so concurrent consumers cannot both win.
 * This helper is intentionally not registered as a public function.
 */
export async function consumeSensitiveGrant(
  ctx: MutationCtx,
  grantId: Id<"sensitiveGrants">,
  expected: SensitiveGrantExpectation,
): Promise<Doc<"sensitiveGrants">> {
  const grant = await ctx.db.get(grantId);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!grant) throw new Error("Sensitive grant is unavailable");
  if (grant.consumedAt !== null) throw new Error("Sensitive grant was already consumed");
  if (grant.issuedAt < 0 || grant.issuedAt > nowSeconds || grant.expiresAt <= nowSeconds) throw new Error("Sensitive grant is expired or not yet valid");
  const owner = await ctx.db.get(grant.ownerId);
  if (!owner) throw new Error("Sensitive grant owner is unavailable");
  if (owner.status !== "active") throw new Error("Sensitive grant owner is not active");
  if (
    owner.clerkSubject !== expected.subject ||
    grant.ownerId !== expected.ownerId ||
    grant.subject !== expected.subject ||
    grant.sessionId !== expected.sessionId ||
    grant.audience !== expected.audience ||
    grant.purpose !== expected.purpose
  ) {
    throw new Error("Sensitive grant binding mismatch");
  }
  await ctx.db.patch(grantId, { consumedAt: nowSeconds });
  const consumed = await ctx.db.get(grantId);
  if (!consumed) throw new Error("Sensitive grant consumption failed");
  return consumed;
}
