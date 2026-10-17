import { describe, expect, it, vi } from "vitest";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import {
  createDeletionRequestCoordinator,
  type CurrentClerkSession,
  type DeletionRequestCallbacks,
} from "../lib/privacy/deletion-request";

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(requestIdFactory: () => string = () => REQUEST_ID) {
  let privateCurrent = true;
  let clerk: CurrentClerkSession | null = { subject: "user-a", sessionId: "session-a" };
  const access: PrivateSessionAccess = {
    identity: { profileId: "profile-a", subject: "user-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true },
    getToken: async () => "token",
    isCurrent: () => privateCurrent,
  };
  const cleanupRun = vi.fn(async () => ({ kind: "cleared" as const }));
  const callbacks: DeletionRequestCallbacks = {
    requestApproval: vi.fn(async () => "proof"),
    exchangeApproval: vi.fn(async () => ({ grantId: "grant-a" })),
    submitDeletion: vi.fn(async () => ({ status: "accepted" as const, requestId: REQUEST_ID })),
    captureCleanup: vi.fn(() => ({ run: cleanupRun })),
  };
  const coordinator = createDeletionRequestCoordinator({
    access,
    callbacks,
    getCurrentClerkSession: () => clerk,
    requestIdFactory,
  });
  return { access, callbacks, coordinator, cleanupRun, setPrivateCurrent: (value: boolean) => { privateCurrent = value; }, setClerk: (value: CurrentClerkSession | null) => { clerk = value; } };
}

describe("DeletionRequestCoordinator", () => {
  it("requires explicit confirmation and does not start approval", async () => {
    const { coordinator, callbacks } = setup();
    await expect(coordinator.request(false)).resolves.toEqual({ kind: "cancelled", reason: "not_confirmed" });
    expect(callbacks.requestApproval).not.toHaveBeenCalled();
  });

  it("rejects a request ID that the server would not accept", async () => {
    const { coordinator, callbacks } = setup(() => "request-a");
    await expect(coordinator.request(true)).resolves.toEqual({ kind: "cancelled", reason: "approval_failed" });
    expect(callbacks.requestApproval).not.toHaveBeenCalled();
  });

  it("keeps approval cancellation user-safe", async () => {
    const { coordinator, callbacks } = setup();
    callbacks.requestApproval = vi.fn(async () => null);
    await expect(coordinator.request(true)).resolves.toEqual({ kind: "cancelled", reason: "approval_cancelled" });
    expect(callbacks.exchangeApproval).not.toHaveBeenCalled();
  });

  it("coalesces duplicate requests while approval is pending", async () => {
    const { coordinator, callbacks } = setup();
    const approval = deferred<string | null>();
    callbacks.requestApproval = vi.fn(() => approval.promise);
    const first = coordinator.request(true);
    const second = coordinator.request(true);
    expect(second).toBe(first);
    approval.resolve("proof");
    await first;
    expect(callbacks.requestApproval).toHaveBeenCalledTimes(1);
    expect(callbacks.submitDeletion).toHaveBeenCalledTimes(1);
  });

  it("cancels when the account changes before submission", async () => {
    const { coordinator, callbacks, setPrivateCurrent, setClerk } = setup();
    const approval = deferred<string | null>();
    callbacks.requestApproval = vi.fn(() => approval.promise);
    const request = coordinator.request(true);
    setPrivateCurrent(false);
    setClerk({ subject: "user-b", sessionId: "session-b" });
    approval.resolve("proof");
    await expect(request).resolves.toEqual({ kind: "cancelled", reason: "account_changed" });
    expect(callbacks.exchangeApproval).not.toHaveBeenCalled();
    expect(callbacks.submitDeletion).not.toHaveBeenCalled();
  });

  it("requires private access for the initial submit", async () => {
    const { coordinator, callbacks, setPrivateCurrent } = setup();
    callbacks.captureCleanup = vi.fn(() => {
      setPrivateCurrent(false);
      return { run: async () => ({ kind: "cleared" as const }) };
    });
    await expect(coordinator.request(true)).resolves.toEqual({ kind: "cancelled", reason: "account_changed" });
    expect(callbacks.submitDeletion).not.toHaveBeenCalled();
  });

  it("replays the same request after private access is revoked", async () => {
    const { coordinator, callbacks, cleanupRun, setPrivateCurrent } = setup();
    callbacks.submitDeletion = vi.fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ status: "replayed" as const, requestId: REQUEST_ID });
    const first = await coordinator.request(true);
    expect(first).toEqual({ kind: "unknown", requestId: REQUEST_ID, grantId: "grant-a" });
    setPrivateCurrent(false);
    const second = await coordinator.retry();
    expect(second).toEqual({ kind: "accepted", requestId: REQUEST_ID, grantId: "grant-a", cleanup: "cleared" });
    expect(callbacks.exchangeApproval).toHaveBeenCalledTimes(1);
    expect(callbacks.submitDeletion).toHaveBeenCalledTimes(2);
    expect(callbacks.submitDeletion).toHaveBeenNthCalledWith(1, { requestId: REQUEST_ID, grantId: "grant-a" });
    expect(callbacks.submitDeletion).toHaveBeenNthCalledWith(2, { requestId: REQUEST_ID, grantId: "grant-a" });
    expect(cleanupRun).toHaveBeenCalledTimes(1);
  });

  it("refuses replay from a foreign Clerk session without discarding the pending request", async () => {
    const { coordinator, callbacks, setPrivateCurrent, setClerk } = setup();
    callbacks.submitDeletion = vi.fn().mockResolvedValue({ status: "unknown" as const });
    await coordinator.request(true);
    setPrivateCurrent(false);
    setClerk({ subject: "user-b", sessionId: "session-b" });
    await expect(coordinator.retry()).resolves.toEqual({ kind: "cancelled", reason: "account_changed" });
    expect(callbacks.submitDeletion).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot()).toEqual({ kind: "unknown", requestId: REQUEST_ID, grantId: "grant-a" });
  });

  it("refuses replay when the subject matches but the Clerk session changed", async () => {
    const { coordinator, callbacks, setPrivateCurrent, setClerk } = setup();
    callbacks.submitDeletion = vi.fn().mockResolvedValue({ status: "unknown" as const });
    await coordinator.request(true);
    setPrivateCurrent(false);
    setClerk({ subject: "user-a", sessionId: "session-new" });
    await expect(coordinator.retry()).resolves.toEqual({ kind: "cancelled", reason: "account_changed" });
    expect(callbacks.submitDeletion).toHaveBeenCalledTimes(1);
  });

  it("runs captured cleanup after an accepted response even when access is revoked", async () => {
    const { coordinator, callbacks, cleanupRun, setPrivateCurrent } = setup();
    callbacks.submitDeletion = vi.fn(async () => {
      setPrivateCurrent(false);
      return { status: "accepted" as const, requestId: REQUEST_ID };
    });
    await expect(coordinator.request(true)).resolves.toEqual({ kind: "accepted", requestId: REQUEST_ID, grantId: "grant-a", cleanup: "cleared" });
    expect(cleanupRun).toHaveBeenCalledTimes(1);
  });

  it("uses only the captured former-account cleanup when the account switches during submit", async () => {
    const { coordinator, callbacks, cleanupRun, setPrivateCurrent, setClerk } = setup();
    callbacks.submitDeletion = vi.fn(async () => {
      setPrivateCurrent(false);
      setClerk({ subject: "user-b", sessionId: "session-b" });
      return { status: "accepted" as const, requestId: REQUEST_ID };
    });
    await expect(coordinator.request(true)).resolves.toEqual({ kind: "accepted", requestId: REQUEST_ID, grantId: "grant-a", cleanup: "cleared" });
    expect(callbacks.captureCleanup).toHaveBeenCalledTimes(1);
    expect(cleanupRun).toHaveBeenCalledTimes(1);
    expect(callbacks.exchangeApproval).toHaveBeenCalledTimes(1);
  });

  it("retries failed cleanup without resubmitting deletion", async () => {
    const { coordinator, callbacks } = setup();
    const cleanupRun = vi.fn()
      .mockResolvedValueOnce({ kind: "retry" as const, reasons: ["storage-failure" as const] })
      .mockResolvedValueOnce({ kind: "cleared" as const });
    callbacks.captureCleanup = vi.fn(() => ({ run: cleanupRun }));
    const first = await coordinator.request(true);
    expect(first).toEqual({ kind: "accepted", requestId: REQUEST_ID, grantId: "grant-a", cleanup: "retry" });
    await expect(coordinator.retryCleanup()).resolves.toEqual({ kind: "accepted", requestId: REQUEST_ID, grantId: "grant-a", cleanup: "cleared" });
    expect(callbacks.submitDeletion).toHaveBeenCalledTimes(1);
    expect(cleanupRun).toHaveBeenCalledTimes(2);
  });

  it("turns malformed or thrown server outcomes into an unknown state without exposing details", async () => {
    const { coordinator, callbacks } = setup();
    callbacks.submitDeletion = vi.fn().mockResolvedValue({ status: "unexpected", detail: "private provider response" });
    await expect(coordinator.request(true)).resolves.toEqual({ kind: "unknown", requestId: REQUEST_ID, grantId: "grant-a" });
  });
});
