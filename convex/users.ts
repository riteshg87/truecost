import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const statusValidator = v.union(
  v.literal("active"),
  v.literal("deleting"),
  v.literal("deleted"),
);

const profileValidator = v.union(
  v.object({
    _id: v.id("users"),
    _creationTime: v.number(),
    status: statusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  v.null(),
);

function profileOf(user: {
  _id: Id<"users">;
  _creationTime: number;
  status: "active" | "deleting" | "deleted";
  createdAt: number;
  updatedAt: number;
}) {
  return {
    _id: user._id,
    _creationTime: user._creationTime,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function verifiedIdentity(ctx: { auth: { getUserIdentity: () => Promise<{
  tokenIdentifier?: string;
  subject?: string;
} | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.tokenIdentifier || !identity.subject) {
    throw new Error("Authenticated identity is unavailable");
  }
  return { authKey: identity.tokenIdentifier, clerkSubject: identity.subject };
}

export const currentUser = query({
  // The subject is a consistency guard supplied by the client. Authority is
  // always derived from ctx.auth; this argument only prevents a stale cached
  // profile from being accepted after the Clerk identity changes.
  args: { expectedSubject: v.string(), sessionMarker: v.string() },
  returns: profileValidator,
  handler: async (ctx, args) => {
    const { authKey, clerkSubject } = await verifiedIdentity(ctx);
    if (clerkSubject !== args.expectedSubject || !args.sessionMarker) throw new Error("Authenticated identity is unavailable");
    const user = await ctx.db
      .query("users")
      .withIndex("by_authKey", (q) => q.eq("authKey", authKey))
      .unique();
    if (!user) return null;
    if (user.status !== "active") throw new Error("Profile unavailable");
    return profileOf(user);
  },
});

export const ensureCurrentUser = mutation({
  args: {},
  returns: v.object({
    _id: v.id("users"),
    _creationTime: v.number(),
    status: statusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx) => {
    const { authKey, clerkSubject } = await verifiedIdentity(ctx);
    const tombstone = await ctx.db
      .query("clerkDeletionTombstones")
      .withIndex("by_clerkSubject", (q) => q.eq("clerkSubject", clerkSubject))
      .first();
    if (tombstone) throw new Error("Profile unavailable");
    const existing = await ctx.db
      .query("users")
      .withIndex("by_authKey", (q) => q.eq("authKey", authKey))
      .unique();
    if (existing) {
      if (existing.status !== "active") throw new Error("Profile unavailable");
      return profileOf(existing);
    }
    const now = Date.now();
    const id = await ctx.db.insert("users", {
      authKey,
      clerkSubject,
      status: "active",
      exportRevision: 0,
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get(id);
    if (!created) throw new Error("Profile provisioning failed");
    return profileOf(created);
  },
});
