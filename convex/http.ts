import { verifyWebhook } from "@clerk/backend/webhooks";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { makeFunctionReference } from "convex/server";

export const MAX_BODY_BYTES = 64 * 1024;
const ingestRef = makeFunctionReference<"mutation", { eventId: string; clerkSubject: string }>("accountDeletionWebhook:ingest");

function failure(status: number): Response {
  return Response.json({ ok: false }, { status });
}

export async function boundedBody(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + 5_000;
  const cancel = () => {
    // Cancellation is best effort. A malicious or broken stream must never
    // keep this handler waiting for the stream's cancellation promise.
    void reader.cancel().catch(() => undefined);
  };
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        cancel();
        return null;
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Webhook body read timed out")), remaining);
        }),
      ]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    cancel();
    return null;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The stream may have completed cancellation while the lock is released.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function verifyClerkDeletionRequest(request: Request, secret: string): Promise<{ eventId: string; clerkSubject: string } | null> {
  const body = await boundedBody(request);
  if (body === null) return null;
  const eventId = request.headers.get("svix-id")?.trim();
  if (!eventId || eventId.length > 256) return null;
  try {
    const signedRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body,
    });
    const event = await verifyWebhook(signedRequest, { signingSecret: secret });
    if (event.type !== "user.deleted") return null;
    const data = event.data as { id?: unknown; deleted?: unknown };
    if (typeof data.id !== "string" || data.id.length === 0 || data.id.length > 256 || data.deleted !== true) return null;
    return { eventId, clerkSubject: data.id };
  } catch {
    return null;
  }
}

const clerkWebhook = httpAction(async (ctx, request) => {
  if (request.method !== "POST") return failure(405);
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) return failure(503);
  const verified = await verifyClerkDeletionRequest(request, secret);
  if (!verified) return failure(400);
  try {
    await ctx.runMutation(ingestRef, verified);
    return Response.json({ ok: true });
  } catch {
    return failure(503);
  }
});

const http = httpRouter();
http.route({ path: "/clerk-webhook", method: "POST", handler: clerkWebhook });
export default http;
