import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { verifySensitiveProof, type SensitiveProofClaims } from "../lib/privacy/sensitive-proof";

const issueGrant = makeFunctionReference<"mutation", Omit<SensitiveProofClaims, "v" | "kid"> & { authKey: string }, Doc<"sensitiveGrants">>("privacyGrants:issueVerifiedGrant");
const approvalResult = v.union(
  v.object({ grantId: v.id("sensitiveGrants"), expiresAt: v.number() }),
  v.object({ status: v.literal("limited"), code: v.literal("active_grants"), retryAfterMs: v.number(), message: v.string() }),
  v.object({ status: v.literal("limited"), code: v.literal("rate_limited"), retryAfterMs: v.number(), message: v.string() }),
);

function isLimitData(value: unknown): value is { code: "active_grants" | "rate_limited"; retryAfterMs: number } {
  if (!value || typeof value !== "object") return false;
  const data = value as { code?: unknown; retryAfterMs?: unknown };
  return (data.code === "active_grants" || data.code === "rate_limited") && typeof data.retryAfterMs === "number" && Number.isSafeInteger(data.retryAfterMs) && data.retryAfterMs > 0;
}

/** A regular authenticated action uses Convex's token validation and needs no
 * separate HTTP bearer-token parser or browser-visible deployment credential. */
export const exchange = action({
  args: { proof: v.string(), purpose: v.union(v.literal("account_export"), v.literal("account_delete")) },
  returns: approvalResult,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    // sid must come from the verified JWT. Never fall back to a client field.
    if (!identity?.subject || !identity.tokenIdentifier || typeof identity.sid !== "string" || !identity.sid) throw new Error("Approval unavailable");
    const audience = process.env.TRUECOST_PRIVACY_AUDIENCE;
    if (!audience) throw new Error("Approval unavailable");
    const keys: Record<string, Uint8Array> = Object.create(null);
    try {
      const configured: unknown = JSON.parse(process.env.TRUECOST_PRIVACY_VERIFICATION_KEYS ?? "");
      if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error();
      const entries = Object.entries(configured);
      if (entries.length < 1 || entries.length > 3) throw new Error();
      for (const [kid, value] of entries) {
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(kid) || typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) throw new Error();
        keys[kid] = Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
      }
    } catch { throw new Error("Approval unavailable"); }
    const claims = await verifySensitiveProof(args.proof, {
      keys, expected: { audience, subject: identity.subject, sessionId: identity.sid, purpose: args.purpose },
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!claims) throw new Error("Approval unavailable");
    let grant: Doc<"sensitiveGrants">;
    try {
      grant = await ctx.runMutation(issueGrant, {
        authKey: identity.tokenIdentifier, subject: claims.subject, sessionId: claims.sessionId,
        audience: claims.audience, purpose: claims.purpose, nonce: claims.nonce,
        issuedAt: claims.issuedAt, expiresAt: claims.expiresAt,
      });
    } catch (error) {
      const data = error instanceof ConvexError ? error.data : null;
      if (isLimitData(data)) return { status: "limited" as const, code: data.code, retryAfterMs: data.retryAfterMs, message: data.code === "active_grants" ? "Approval already pending; try again later" : "Approval limit reached; try again later" };
      throw new Error("Approval unavailable");
    }
    return { grantId: grant._id, expiresAt: grant.expiresAt };
  },
});
