import { auth, reverificationErrorResponse } from "@clerk/nextjs/server";
import { signSensitiveProof, SENSITIVE_PROOF_LIFETIME_SECONDS } from "@/lib/privacy/sensitive-proof";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "Pragma": "no-cache" };
const fail = (status: number) => Response.json({ error: "Approval unavailable" }, { status, headers });

/** Only the authenticated server context can attest to recent verification. */
export async function POST(request: Request): Promise<Response> {
  try {
    const origin = process.env.TRUECOST_APP_ORIGIN;
    const audience = process.env.TRUECOST_PRIVACY_AUDIENCE;
    const kid = process.env.TRUECOST_PRIVACY_KEY_ID;
    const encodedKey = process.env.TRUECOST_PRIVACY_SIGNING_KEY;
    if (!origin || new URL(origin).origin !== origin || !audience || !kid || !encodedKey ||
        !/^[0-9a-f]{64}$/i.test(encodedKey)) return fail(503);
    // Compare to configured origin, never an untrusted forwarded host header.
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return fail(403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return fail(415);
    const reader = request.body?.getReader();
    if (!reader) return fail(400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 1024) { await reader.cancel(); return fail(413); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return fail(400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !("purpose" in body) || (body.purpose !== "account_export" && body.purpose !== "account_delete")) return fail(400);
    const session = await auth();
    if (!session.userId || !session.sessionId) return fail(401);
    if (!session.has({ reverification: "strict" })) {
      const response = reverificationErrorResponse("strict");
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const proof = await signSensitiveProof({
      v: 1, kid, audience, subject: session.userId, sessionId: session.sessionId,
      purpose: body.purpose, nonce: crypto.randomUUID(), issuedAt,
      expiresAt: issuedAt + SENSITIVE_PROOF_LIFETIME_SECONDS,
    }, Uint8Array.from(Buffer.from(encodedKey, "hex")));
    return Response.json({ proof }, { headers });
  } catch { return fail(503); }
}
