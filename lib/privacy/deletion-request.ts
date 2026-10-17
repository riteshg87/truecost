import type { PrivateSessionAccess } from "../auth/private-session";
import type { CapturedDeletionCleanup, DeletionCleanupResult } from "./deletion-cleanup";

export const ACCOUNT_DELETION_PURPOSE = "account_delete" as const;

type Binding = Readonly<{
  subject: string;
  sessionId: string;
  purpose: typeof ACCOUNT_DELETION_PURPOSE;
}>;

/** The Clerk identity used to replay an ambiguous request after private access is revoked. */
export type CurrentClerkSession = Readonly<Pick<Binding, "subject" | "sessionId">>;

export type DeletionApproval = string | null;
export type DeletionGrant = Readonly<{ grantId: string }>;
export type DeletionSubmitOutcome =
  | Readonly<{ status: "accepted" | "replayed"; requestId?: string }>
  | Readonly<{ status: "unknown" }>
  | Readonly<{ status: "rejected"; code?: "unauthorized" | "blocked" | "invalid" | "rate_limited" }>;

export interface DeletionRequestCallbacks {
  /** Starts a recent-auth approval flow for this exact Clerk subject/session. */
  requestApproval(binding: Binding): Promise<DeletionApproval>;
  /** Exchanges the one-time proof immediately; the coordinator never stores it. */
  exchangeApproval(proof: string, binding: Binding): Promise<DeletionGrant | null>;
  /** Submits the fixed request/grant pair to the server. */
  submitDeletion(input: Readonly<{ requestId: string; grantId: string }>): Promise<DeletionSubmitOutcome>;
  /** Captures former-account cleanup while the confirmed account is still current. */
  captureCleanup(): CapturedDeletionCleanup | null;
}

export interface DeletionRequestOptions {
  access: PrivateSessionAccess;
  callbacks: DeletionRequestCallbacks;
  /** Reads the live Clerk identity independently of the private-session grant. */
  getCurrentClerkSession: () => CurrentClerkSession | null;
  requestIdFactory?: () => string;
}

export type DeletionRequestState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "approving"; requestId: string }>
  | Readonly<{ kind: "submitting"; requestId: string; grantId: string }>
  | Readonly<{ kind: "unknown"; requestId: string; grantId: string }>
  | Readonly<{ kind: "accepted"; requestId: string; grantId: string; cleanup: "cleared" | "retry" }>
  | Readonly<{ kind: "cancelled"; reason: "not_confirmed" | "approval_cancelled" | "approval_failed" | "account_changed" | "cleanup_unavailable" | "server_rejected" }>;

export type DeletionRequestResult = DeletionRequestState;

const REQUEST_ID_LIMIT = 200;
const GRANT_ID_LIMIT = 200;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeRequestId(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > REQUEST_ID_LIMIT || !REQUEST_ID_PATTERN.test(value)) throw new Error("request_id_invalid");
  return value;
}

function safeGrantId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= GRANT_ID_LIMIT;
}

function bindingFor(access: PrivateSessionAccess): Binding {
  const { subject, sessionId } = access.identity;
  if (typeof subject !== "string" || subject.length === 0 || typeof sessionId !== "string" || sessionId.length === 0) throw new Error("binding_invalid");
  return Object.freeze({ subject, sessionId, purpose: ACCOUNT_DELETION_PURPOSE });
}

function sameBinding(access: PrivateSessionAccess, binding: Binding): boolean {
  return access.isCurrent() && access.identity.subject === binding.subject && access.identity.sessionId === binding.sessionId;
}

function currentClerkSession(options: DeletionRequestOptions): CurrentClerkSession | null {
  try {
    const current = options.getCurrentClerkSession();
    if (!current || typeof current.subject !== "string" || current.subject.length === 0 ||
      typeof current.sessionId !== "string" || current.sessionId.length === 0 ||
      current.subject.length > REQUEST_ID_LIMIT || current.sessionId.length > REQUEST_ID_LIMIT) return null;
    return { subject: current.subject, sessionId: current.sessionId };
  } catch {
    return null;
  }
}

function sameClerkSession(options: DeletionRequestOptions, binding: Binding): boolean {
  const current = currentClerkSession(options);
  return current?.subject === binding.subject && current.sessionId === binding.sessionId;
}

function cleanupSucceeded(result: DeletionCleanupResult): result is { kind: "cleared" } {
  return result.kind === "cleared";
}

function isAccepted(result: DeletionSubmitOutcome, requestId: string): result is Readonly<{ status: "accepted" | "replayed"; requestId?: string }> {
  return (result.status === "accepted" || result.status === "replayed") && (result.requestId === undefined || result.requestId === requestId);
}

function isDeletionSubmitOutcome(value: unknown): value is DeletionSubmitOutcome {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  if (status === "unknown") return true;
  if (status === "accepted" || status === "replayed") {
    const requestId = (value as { requestId?: unknown }).requestId;
    return requestId === undefined || (typeof requestId === "string" && requestId.length <= REQUEST_ID_LIMIT);
  }
  if (status === "rejected") {
    const code = (value as { code?: unknown }).code;
    return code === undefined || code === "unauthorized" || code === "blocked" || code === "invalid" || code === "rate_limited";
  }
  return false;
}

/**
 * Coordinates one confirmed deletion request for one Clerk subject/session.
 * The coordinator is intentionally memory-only. A reload recovery layer must
 * persist the request/grant pair and status outside this class.
 */
export class DeletionRequestCoordinator {
  private stateValue: DeletionRequestState = { kind: "idle" };
  private inFlight: Promise<DeletionRequestResult> | null = null;
  private cleanup: CapturedDeletionCleanup | null = null;
  private binding: Binding | null = null;
  private requestId: string | null = null;
  private grantId: string | null = null;

  constructor(private readonly options: DeletionRequestOptions) {}

  snapshot(): DeletionRequestState {
    return this.stateValue;
  }

  /**
   * Starts the flow after the caller has displayed an explicit confirmation.
   * Duplicate calls while any step is pending share the same promise.
   */
  request(confirmed: boolean): Promise<DeletionRequestResult> {
    if (this.inFlight) return this.inFlight;
    if (this.stateValue.kind === "accepted" || this.stateValue.kind === "unknown") return this.retry();
    if (!confirmed) {
      this.stateValue = { kind: "cancelled", reason: "not_confirmed" };
      return Promise.resolve(this.stateValue);
    }
    this.stateValue = { kind: "idle" };
    const promise = this.runFreshRequest();
    this.inFlight = promise;
    void promise.finally(() => {
      if (this.inFlight === promise) this.inFlight = null;
    });
    return promise;
  }

  /** Retries only the original unknown submission, never a new approval. */
  retry(): Promise<DeletionRequestResult> {
    if (this.inFlight) return this.inFlight;
    if (this.stateValue.kind === "accepted") {
      return this.stateValue.cleanup === "retry" ? this.retryCleanup() : Promise.resolve(this.stateValue);
    }
    if (this.stateValue.kind !== "unknown" || !this.binding || !this.requestId || !this.grantId) return Promise.resolve(this.stateValue);
    // The server may already have revoked the private grant. Replay is allowed
    // only when the live Clerk subject and session still match the original.
    if (!sameClerkSession(this.options, this.binding)) return Promise.resolve({ kind: "cancelled", reason: "account_changed" });
    const promise = this.submitExisting(this.requestId, this.grantId, false);
    this.inFlight = promise;
    void promise.finally(() => {
      if (this.inFlight === promise) this.inFlight = null;
    });
    return promise;
  }

  /** Retries captured local cleanup without submitting deletion again. */
  retryCleanup(): Promise<DeletionRequestResult> {
    if (this.inFlight) return this.inFlight;
    if (this.stateValue.kind !== "accepted" || this.stateValue.cleanup !== "retry" || !this.cleanup) return Promise.resolve(this.stateValue);
    const promise = this.runCleanup();
    this.inFlight = promise;
    void promise.finally(() => {
      if (this.inFlight === promise) this.inFlight = null;
    });
    return promise;
  }

  private async runFreshRequest(): Promise<DeletionRequestResult> {
    let binding: Binding;
    let requestId: string;
    try {
      if (!this.options.access.isCurrent()) return this.cancel("account_changed");
      binding = bindingFor(this.options.access);
      if (!sameClerkSession(this.options, binding)) return this.cancel("account_changed");
      requestId = safeRequestId(this.options.requestIdFactory?.() ?? crypto.randomUUID());
      this.binding = binding;
      this.requestId = requestId;
      this.stateValue = { kind: "approving", requestId };

      const proof = await this.options.callbacks.requestApproval(binding);
      if (!sameBinding(this.options.access, binding) || !sameClerkSession(this.options, binding)) return this.cancel("account_changed");
      if (proof === null) return this.cancel("approval_cancelled");
      if (typeof proof !== "string" || proof.length === 0 || proof.length > 4096) return this.cancel("approval_failed");

      let ephemeralProof: string | null = proof;
      let grant: DeletionGrant | null = null;
      try {
        grant = await this.options.callbacks.exchangeApproval(ephemeralProof, binding);
      } catch {
        return this.cancel("approval_failed");
      } finally {
        ephemeralProof = null;
      }
      if (!sameBinding(this.options.access, binding) || !sameClerkSession(this.options, binding)) return this.cancel("account_changed");
      if (!grant || !safeGrantId(grant.grantId)) return this.cancel("approval_failed");
      this.grantId = grant.grantId;

      try {
        this.cleanup = this.options.callbacks.captureCleanup();
      } catch {
        this.cleanup = null;
      }
      if (!this.cleanup) return this.cancel("cleanup_unavailable");
      if (!sameBinding(this.options.access, binding) || !sameClerkSession(this.options, binding)) return this.cancel("account_changed");
      return this.submitExisting(requestId, grant.grantId, true);
    } catch {
      return this.cancel("approval_failed");
    }
  }

  private async submitExisting(requestId: string, grantId: string, requirePrivateAccess: boolean): Promise<DeletionRequestResult> {
    if (!this.binding || !sameClerkSession(this.options, this.binding) ||
      (requirePrivateAccess && !sameBinding(this.options.access, this.binding))) {
      return this.cancel("account_changed");
    }
    this.stateValue = { kind: "submitting", requestId, grantId };
    let outcome: unknown;
    try {
      outcome = await this.options.callbacks.submitDeletion({ requestId, grantId });
    } catch {
      this.stateValue = { kind: "unknown", requestId, grantId };
      return this.stateValue;
    }
    if (!isDeletionSubmitOutcome(outcome)) {
      this.stateValue = { kind: "unknown", requestId, grantId };
      return this.stateValue;
    }
    if (outcome.status === "unknown" || !isAccepted(outcome, requestId)) {
      if (outcome.status === "rejected") {
        this.stateValue = { kind: "cancelled", reason: "server_rejected" };
        return this.stateValue;
      }
      this.stateValue = { kind: "unknown", requestId, grantId };
      return this.stateValue;
    }
    this.stateValue = { kind: "accepted", requestId, grantId, cleanup: "retry" };
    return this.runCleanup();
  }

  private async runCleanup(): Promise<DeletionRequestResult> {
    if (this.stateValue.kind !== "accepted" || !this.cleanup) return this.stateValue;
    try {
      const result = await this.cleanup.run();
      if (cleanupSucceeded(result)) {
        this.stateValue = { ...this.stateValue, cleanup: "cleared" };
      } else {
        this.stateValue = { ...this.stateValue, cleanup: "retry" };
      }
    } catch {
      this.stateValue = { ...this.stateValue, cleanup: "retry" };
    }
    return this.stateValue;
  }

  private cancel(reason: "not_confirmed" | "approval_cancelled" | "approval_failed" | "account_changed" | "cleanup_unavailable" | "server_rejected"): DeletionRequestResult {
    this.stateValue = { kind: "cancelled", reason };
    this.binding = null;
    this.requestId = null;
    this.grantId = null;
    this.cleanup = null;
    return this.stateValue;
  }
}

export function createDeletionRequestCoordinator(options: DeletionRequestOptions): DeletionRequestCoordinator {
  return new DeletionRequestCoordinator(options);
}
