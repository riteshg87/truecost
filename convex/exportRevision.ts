import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Missing revisions are legacy users and are treated as revision zero. */
export function exportRevisionOf(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new Error("Export revision is invalid");
}

/** Must run in the same Convex transaction as the exported-data write. */
export async function bumpExportRevision(ctx: MutationCtx, ownerId: Id<"users">): Promise<number> {
  const user = await ctx.db.get(ownerId);
  if (!user || user.status !== "active") throw new Error("Export owner is unavailable");
  const current = exportRevisionOf(user.exportRevision);
  if (current >= Number.MAX_SAFE_INTEGER) throw new Error("Export revision limit reached");
  const next = current + 1;
  await ctx.db.patch(ownerId, { exportRevision: next, updatedAt: Date.now() });
  return next;
}
