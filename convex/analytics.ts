import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

/** The policy version is deliberately server-owned and bounded. */
export const ANALYTICS_POLICY_VERSION = "v1" as const;
const MAX_REVISION = 1_000_000_000;

const consentValidator = v.union(
  v.literal("declined"),
  v.literal("accepted"),
);

const preferenceValidator = v.object({
  consent: v.union(v.literal("unknown"), v.literal("declined"), v.literal("accepted")),
  policyVersion: v.string(),
  revision: v.number(),
  // This is null unless consent is currently accepted. The backing row may
  // retain the value after withdrawal for a later provider deletion workflow.
  analyticsAccountId: v.union(v.string(), v.null()),
  sendPermission: v.boolean(),
});

type Preference = {
  consent: "declined" | "accepted";
  policyVersion: string;
  revision: number;
  analyticsAccountId: string | null;
};

async function activeUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  const authKey = identity?.tokenIdentifier;
  if (!authKey) throw new Error("Authenticated identity is unavailable");

  const user = await ctx.db
    .query("users")
    .withIndex("by_authKey", (q) => q.eq("authKey", authKey))
    .unique();
  if (!user || user.status !== "active") throw new Error("Profile unavailable");
  return user;
}

function publicPreference(preference: Preference | null) {
  if (!preference) {
    return {
      consent: "unknown" as const,
      policyVersion: ANALYTICS_POLICY_VERSION,
      revision: 0,
      analyticsAccountId: null,
      sendPermission: false,
    };
  }

  // A row written under a retired policy must never silently authorize sends
  // or disclose its retained ID. The caller can explicitly re-consent using
  // the current policy and the returned revision.
  if (preference.policyVersion !== ANALYTICS_POLICY_VERSION) {
    return {
      consent: "unknown" as const,
      policyVersion: ANALYTICS_POLICY_VERSION,
      revision: preference.revision,
      analyticsAccountId: null,
      sendPermission: false,
    };
  }

  const sendPermission = preference.consent === "accepted" && preference.analyticsAccountId !== null;
  return {
    consent: preference.consent,
    policyVersion: preference.policyVersion,
    revision: preference.revision,
    analyticsAccountId: sendPermission ? preference.analyticsAccountId : null,
    sendPermission,
  };
}

function issueAnalyticsAccountId() {
  // Convex's default runtime exposes the Web Crypto API. Keep generation in
  // the mutation, after the consent check, so clients cannot supply or cause
  // an identifier to be created by a read or a declined write.
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("Secure analytics identifier generation is unavailable");
  }
  return crypto.randomUUID();
}

export const getPreference = query({
  args: {},
  returns: preferenceValidator,
  handler: async (ctx) => {
    const user = await activeUser(ctx);
    const preference = await ctx.db
      .query("analyticsPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .unique();
    return publicPreference(preference);
  },
});

export const setPreference = mutation({
  args: {
    consent: consentValidator,
    policyVersion: v.literal(ANALYTICS_POLICY_VERSION),
    expectedRevision: v.number(),
  },
  returns: preferenceValidator,
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.expectedRevision) ||
      args.expectedRevision < 0 ||
      args.expectedRevision > MAX_REVISION
    ) {
      throw new Error("Analytics preference revision is invalid");
    }

    const user = await activeUser(ctx);
    const existing = await ctx.db
      .query("analyticsPreferences")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .unique();
    const revision = existing?.revision ?? 0;
    if (revision !== args.expectedRevision) {
      throw new Error("Analytics preference revision is stale");
    }
    if (revision >= MAX_REVISION) {
      throw new Error("Analytics preference revision is exhausted");
    }

    const analyticsAccountId =
      args.consent === "accepted"
        ? (existing?.analyticsAccountId ?? issueAnalyticsAccountId())
        : (existing?.analyticsAccountId ?? null);
    const next = {
      ownerId: user._id,
      consent: args.consent,
      policyVersion: args.policyVersion,
      revision: revision + 1,
      analyticsAccountId,
      updatedAt: Date.now(),
    } as const;

    if (existing) {
      await ctx.db.patch(existing._id, next);
    } else {
      await ctx.db.insert("analyticsPreferences", next);
    }

    return publicPreference(next);
  },
});
