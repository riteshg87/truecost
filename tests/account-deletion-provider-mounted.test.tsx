// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, type ReactNode } from "react";
import { createDeletionJournal } from "../lib/privacy/deletion-journal";
import { publishAccountDeletionSignal, registerAccountDeletionCleanup, subscribeToAccountDeletionSignal } from "../lib/privacy/deletion-signal";

type RecoveryCleanupOutcome =
  | { kind: "cleared"; loanGeneration: number; comparisonGeneration: number }
  | { kind: "retry"; reason: "storage-failure" | "runtime-changed" | "server-failure" };
type CleanupRunOutcome = { kind: "cleared" } | { kind: "retry"; reasons?: readonly string[] };

const state = vi.hoisted(() => ({
  clerk: { isLoaded: true, isSignedIn: true, userId: "user-a" as string | null, sessionId: "session-a" as string | null },
  access: { identity: { profileId: "profile-a", subject: "user-a", sessionId: "session-a", authEpoch: 1, verifiedOnline: true }, isCurrent: vi.fn(() => true) },
  auth: null as any,
  exchange: vi.fn(async () => ({ grantId: "grant-a" })),
  submit: vi.fn(),
  query: vi.fn(() => null),
  receipt: null as { requestId: string; ownerId: string; status: "app_pending" | "providers_pending" | "completed" } | null,
  queryReceipt: vi.fn(async (..._args: unknown[]) => state.receipt),
  recoveryCleanup: vi.fn(async (..._args: unknown[]): Promise<RecoveryCleanupOutcome> => ({ kind: "retry", reason: "storage-failure" })),
  stopAnalytics: vi.fn(async () => undefined),
  cleanupRun: vi.fn(async (): Promise<CleanupRunOutcome> => ({ kind: "cleared" })),
  publish: vi.fn(),
  childKey: 0,
}));
state.auth = { viewer: "member", configured: true, privateSession: state.access };

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => state.clerk,
  useReverification: (fetcher: () => Promise<unknown>) => () => fetcher(),
}));
vi.mock("convex/react", () => ({
  useAction: () => state.exchange,
  useMutation: () => state.submit,
  useConvex: () => ({
    query: (reference: unknown, args: unknown) => state.queryReceipt(reference, args),
    watchQuery: () => ({ localQueryResult: () => state.query(), onUpdate: (callback: () => void) => { void callback; return () => undefined; } }),
  }),
}));
vi.mock("@/lib/auth/provider", () => ({ useAuth: () => state.auth }));
vi.mock("../lib/privacy/deletion-recovery-cleanup", () => ({
  runDeletionRecoveryCleanup: (...args: unknown[]) => state.recoveryCleanup(...args),
}));

import { AccountDeletionProvider, useAccountDeletion } from "../lib/privacy/account-deletion-provider";

function options() {
  return {
    captureCleanup: () => ({ run: state.cleanupRun as any }),
    captureSignal: () => ({ publish: state.publish }),
    stopAnalytics: state.stopAnalytics as any,
  };
}

function useRegistryIdentity(label: string) {
  const subject = `registry-${label}`;
  const sessionId = `registry-session-${label}`;
  const profileId = `registry-profile-${label}`;
  state.clerk.userId = subject;
  state.clerk.sessionId = sessionId;
  state.access = { ...state.access, identity: { ...state.access.identity, profileId, subject, sessionId } };
  state.auth = { viewer: "member", configured: true, privateSession: state.access };
  return state.access as any;
}

let retainedLocalCleanupRetry: (() => Promise<unknown>) | null = null;

function Probe() {
  const deletion = useAccountDeletion();
  retainedLocalCleanupRetry = deletion.retryLocalCleanup;
  return <div>
    <output data-testid="state">{deletion.state.kind}</output>
    <output data-testid="visible">{String(deletion.visibleForCurrent)}</output>
    <output data-testid="recovery">{deletion.recovery?.kind ?? "none"}</output>
    <output data-testid="subject">{state.auth.privateSession?.identity.subject ?? "none"}</output>
    <output data-testid="cleanup">{deletion.state.kind === "accepted" ? deletion.state.cleanup : "none"}</output>
    <button type="button" onClick={() => void deletion.start(true, options())}>start</button>
    <button type="button" onClick={() => void deletion.retry()}>retry</button>
  </div>;
}

function Mounted({ children }: { children?: ReactNode }) {
  return <AccountDeletionProvider>{children ?? <Probe />}</AccountDeletionProvider>;
}

beforeEach(() => {
  window.sessionStorage.clear();
  state.clerk.isLoaded = true;
  state.clerk.isSignedIn = true;
  state.clerk.userId = "user-a";
  state.clerk.sessionId = "session-a";
  state.access = { ...state.access, identity: { ...state.access.identity, profileId: "profile-a", subject: "user-a", sessionId: "session-a" }, isCurrent: vi.fn(() => true) };
  state.auth = { viewer: "member", configured: true, privateSession: state.access };
  state.exchange.mockReset();
  state.exchange.mockResolvedValue({ grantId: "grant-a" });
  state.submit.mockReset();
  state.submit.mockImplementation(async (input: { requestId: string; grantId: string }) => ({ status: "accepted", requestId: input.requestId }));
  state.query.mockReset();
  state.query.mockReturnValue(null);
  state.receipt = null;
  state.queryReceipt.mockReset();
  state.queryReceipt.mockImplementation(async () => state.receipt);
  state.recoveryCleanup.mockReset();
  state.recoveryCleanup.mockResolvedValue({ kind: "retry", reason: "storage-failure" });
  state.stopAnalytics.mockReset();
  state.stopAnalytics.mockResolvedValue(undefined);
  state.cleanupRun.mockReset();
  state.cleanupRun.mockResolvedValue({ kind: "cleared" });
  state.publish.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ proof: "proof-a" }), { status: 200, headers: { "Content-Type": "application/json" } })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("mounted account deletion runtime", () => {
  it("clears a fresh request journal only after local and server completion", async () => {
    state.query.mockReturnValue({ status: "completed", needsAttention: false, createdAt: 1, updatedAt: 2 } as any);
    let finishCleanup!: () => void;
    state.cleanupRun.mockImplementationOnce(() => new Promise((resolve) => {
      finishCleanup = () => resolve({ kind: "cleared" });
    }));
    render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(state.cleanupRun).toHaveBeenCalledTimes(1));
    expect(createDeletionJournal().read({ subject: "user-a", sessionId: "session-a" }).kind).toBe("ok");
    await act(async () => finishCleanup());
    await waitFor(() => expect(screen.getByTestId("cleanup").textContent).toBe("cleared"));
    await waitFor(() => expect(createDeletionJournal().read({ subject: "user-a", sessionId: "session-a" }).kind).toBe("missing"));
  });

  it("shares one request when confirmation is clicked twice", async () => {
    let resolveStop!: () => void;
    (state.stopAnalytics as any).mockImplementation(() => new Promise<void>((resolve) => { resolveStop = resolve; }));
    const view = render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("submitting"));
    expect(state.exchange).toHaveBeenCalledTimes(1);
    expect(state.stopAnalytics).toHaveBeenCalledTimes(1);
    resolveStop();
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
  });

  it("replays the same request after an unknown response and revoked private access", async () => {
    state.submit.mockRejectedValueOnce(new Error("network timeout")).mockImplementationOnce(async (input: { requestId: string; grantId: string }) => ({ status: "replayed", requestId: input.requestId }));
    const view = render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("unknown"));
    state.access.isCurrent.mockReturnValue(false);
    state.auth = { ...state.auth, privateSession: null };
    state.clerk.userId = "user-a";
    state.clerk.sessionId = "session-a";
    view.rerender(<Mounted />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "retry" })));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    expect(state.submit).toHaveBeenCalledTimes(2);
    expect(state.submit.mock.calls[1][0]).toEqual({ grantId: "grant-a", requestId: state.submit.mock.calls[0][0].requestId });
    expect(state.cleanupRun).toHaveBeenCalledTimes(1);
    expect(state.publish).toHaveBeenCalledTimes(1);
  });

  it("refuses a retry when Clerk is signed out even if stale IDs remain", async () => {
    state.submit.mockRejectedValueOnce(new Error("network timeout"));
    const view = render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("unknown"));
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    view.rerender(<Mounted />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "retry" })));
    expect(state.submit).toHaveBeenCalledTimes(1);
  });

  it("offers generic local cleanup retry after same-page sign-out without server calls", async () => {
    state.cleanupRun.mockResolvedValueOnce({ kind: "retry", reasons: ["storage-failure"] }).mockResolvedValueOnce({ kind: "cleared" });
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    expect(state.cleanupRun).toHaveBeenCalledTimes(1);
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    view.rerender(<Mounted />);
    expect(screen.getByRole("button", { name: "Retry local cleanup" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry local cleanup" }));
    await waitFor(() => expect(state.cleanupRun).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/(?:pending local cleanup is complete|local browser cleanup completed)/i)).toBeTruthy());
    expect(state.submit).toHaveBeenCalledTimes(1);
    expect(state.queryReceipt).not.toHaveBeenCalled();
  });

  it("coalesces duplicate signed-out local cleanup retries", async () => {
    let finishCleanup!: () => void;
    state.cleanupRun.mockResolvedValueOnce({ kind: "retry", reasons: ["storage-failure"] }).mockImplementationOnce(() => new Promise((resolve) => {
      finishCleanup = () => resolve({ kind: "cleared" });
    }));
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    view.rerender(<Mounted />);
    const button = screen.getByRole("button", { name: "Retry local cleanup" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(state.cleanupRun).toHaveBeenCalledTimes(2);
    finishCleanup();
    await waitFor(() => expect(screen.getByText(/(?:pending local cleanup is complete|local browser cleanup completed)/i)).toBeTruthy());
    expect(state.submit).toHaveBeenCalledTimes(1);
  });

  it("does not expose or control former cleanup after switching to account B", async () => {
    state.cleanupRun.mockResolvedValueOnce({ kind: "retry", reasons: ["storage-failure"] });
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    const retainedRetry = retainedLocalCleanupRetry;
    state.clerk.userId = "user-b";
    state.clerk.sessionId = "session-b";
    state.auth = { viewer: "member", configured: true, privateSession: { ...state.access, identity: { ...state.access.identity, profileId: "profile-b", subject: "user-b", sessionId: "session-b" } } };
    view.rerender(<Mounted />);
    expect(screen.queryByRole("button", { name: "Retry local cleanup" })).toBeNull();
    expect(screen.queryByLabelText("Local deletion cleanup")).toBeNull();
    expect(state.cleanupRun).toHaveBeenCalledTimes(1);
    await expect(retainedRetry?.()).resolves.toEqual({ kind: "unavailable" });
    expect(state.cleanupRun).toHaveBeenCalledTimes(1);
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    view.rerender(<Mounted />);
    await expect(retainedRetry?.()).resolves.toEqual({ kind: "unavailable" });
    expect(state.cleanupRun).toHaveBeenCalledTimes(1);
  });

  it("hides local cleanup while Clerk is still loading", async () => {
    state.cleanupRun.mockResolvedValueOnce({ kind: "retry", reasons: ["storage-failure"] });
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    const retainedRetry = retainedLocalCleanupRetry;
    state.clerk.isLoaded = false;
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    view.rerender(<Mounted />);
    expect(screen.queryByLabelText("Local deletion cleanup")).toBeNull();
    await expect(retainedRetry?.()).resolves.toEqual({ kind: "unavailable" });
    expect(state.cleanupRun).toHaveBeenCalledTimes(1);
  });

  it("retains receiver-only registry cleanup across keyed child revoke and retries locally", async () => {
    const access = useRegistryIdentity("receiver");
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    const registryCleanup = vi.fn()
      .mockResolvedValueOnce({ kind: "retry", reasons: ["storage-failure"] })
      .mockResolvedValueOnce({ kind: "retry", reasons: ["storage-failure"] })
      .mockResolvedValueOnce({ kind: "cleared" })
      .mockResolvedValueOnce({ kind: "cleared" });
    const loanRegistration = registerAccountDeletionCleanup(access, { run: registryCleanup }, "loan");
    const comparisonRegistration = registerAccountDeletionCleanup(access, { run: registryCleanup }, "comparison");
    const signalSubscription = subscribeToAccountDeletionSignal({ access, onRevoke: () => undefined });
    expect(loanRegistration).not.toBeNull();
    expect(comparisonRegistration).not.toBeNull();
    expect(publishAccountDeletionSignal(access)).toBe(true);
    loanRegistration?.stop();
    comparisonRegistration?.stop();
    signalSubscription.stop();
    await waitFor(() => expect(registryCleanup).toHaveBeenCalledTimes(2));
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    view.rerender(<Mounted />);
    const button = await screen.findByRole("button", { name: "Retry browser cleanup" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(registryCleanup).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getByText(/Local browser cleanup completed/i)).toBeTruthy());
    expect(screen.getByTestId("subject").textContent).toBe("none");
    expect(state.submit).not.toHaveBeenCalled();
    expect(state.queryReceipt).not.toHaveBeenCalled();
  });

  it("hides a former receiver registry retry from account B and fences its old callback", async () => {
    const access = useRegistryIdentity("foreign-a");
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    const registryCleanup = vi.fn().mockResolvedValue({ kind: "retry", reasons: ["storage-failure"] });
    const loanRegistration = registerAccountDeletionCleanup(access, { run: registryCleanup }, "loan");
    const comparisonRegistration = registerAccountDeletionCleanup(access, { run: registryCleanup }, "comparison");
    const signalSubscription = subscribeToAccountDeletionSignal({ access, onRevoke: () => undefined });
    expect(publishAccountDeletionSignal(access)).toBe(true);
    loanRegistration?.stop();
    comparisonRegistration?.stop();
    signalSubscription.stop();
    await waitFor(() => expect(registryCleanup).toHaveBeenCalledTimes(2));
    const button = await screen.findByRole("button", { name: "Retry browser cleanup" });
    useRegistryIdentity("foreign-b");
    view.rerender(<Mounted />);
    expect(screen.queryByRole("button", { name: "Retry browser cleanup" })).toBeNull();
    expect(screen.queryByLabelText("Local deletion cleanup")).toBeNull();
    fireEvent.click(button);
    await Promise.resolve();
    expect(registryCleanup).toHaveBeenCalledTimes(2);
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    view.rerender(<Mounted />);
    expect(screen.queryByLabelText("Local deletion cleanup")).toBeNull();
  });

  it("does not reuse a registry retry from an older auth epoch", async () => {
    const access = useRegistryIdentity("epoch");
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    const registryCleanup = vi.fn().mockResolvedValue({ kind: "retry", reasons: ["storage-failure"] });
    const registration = registerAccountDeletionCleanup(access, { run: registryCleanup }, "loan");
    const signalSubscription = subscribeToAccountDeletionSignal({ access, onRevoke: () => undefined });
    expect(publishAccountDeletionSignal(access)).toBe(true);
    registration?.stop();
    signalSubscription.stop();
    await waitFor(() => expect(registryCleanup).toHaveBeenCalledTimes(1));
    const button = await screen.findByRole("button", { name: "Retry browser cleanup" });
    state.access = { ...state.access, identity: { ...state.access.identity, authEpoch: 2 } };
    state.auth = { ...state.auth, privateSession: state.access };
    view.rerender(<Mounted />);
    expect(screen.queryByRole("button", { name: "Retry browser cleanup" })).toBeNull();
    fireEvent.click(button);
    await Promise.resolve();
    expect(registryCleanup).toHaveBeenCalledTimes(1);
  });

  it("keeps A registry cleanup hidden after an unverified B transition and sign-out", async () => {
    const access = useRegistryIdentity("unverified-a");
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    const registryCleanup = vi.fn().mockResolvedValue({ kind: "retry", reasons: ["storage-failure"] });
    const loanRegistration = registerAccountDeletionCleanup(access, { run: registryCleanup }, "loan");
    const comparisonRegistration = registerAccountDeletionCleanup(access, { run: registryCleanup }, "comparison");
    const signalSubscription = subscribeToAccountDeletionSignal({ access, onRevoke: () => undefined });
    expect(publishAccountDeletionSignal(access)).toBe(true);
    loanRegistration?.stop();
    comparisonRegistration?.stop();
    signalSubscription.stop();
    await waitFor(() => expect(registryCleanup).toHaveBeenCalledTimes(2));
    const button = await screen.findByRole("button", { name: "Retry browser cleanup" });
    state.clerk.userId = "registry-unverified-b";
    state.clerk.sessionId = "registry-session-unverified-b";
    state.auth = { viewer: "guest", configured: true, privateSession: null };
    view.rerender(<Mounted />);
    expect(screen.queryByRole("button", { name: "Retry browser cleanup" })).toBeNull();
    state.clerk.isSignedIn = false;
    view.rerender(<Mounted />);
    expect(screen.queryByLabelText("Local deletion cleanup")).toBeNull();
    fireEvent.click(button);
    await Promise.resolve();
    expect(registryCleanup).toHaveBeenCalledTimes(2);
  });

  it("reports partial registry role coverage as pending while signed out", async () => {
    const access = useRegistryIdentity("partial");
    const view = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    const registryCleanup = vi.fn().mockResolvedValue({ kind: "cleared" });
    const registration = registerAccountDeletionCleanup(access, { run: registryCleanup }, "loan");
    const signalSubscription = subscribeToAccountDeletionSignal({ access, onRevoke: () => undefined });
    expect(publishAccountDeletionSignal(access)).toBe(true);
    registration?.stop();
    signalSubscription.stop();
    await waitFor(() => expect(registryCleanup).toHaveBeenCalledTimes(1));
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    view.rerender(<Mounted />);
    const notice = await screen.findByLabelText("Local deletion cleanup");
    expect(notice.textContent).toMatch(/still in progress/i);
    expect(notice.textContent).not.toMatch(/completed|cleared/i);
  });

  it("does not use an unsigned journal for cleanup after a signed-out reload", async () => {
    const first = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("missing"));
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    expect(createDeletionJournal().read({ subject: "user-a", sessionId: "session-a" }).kind).toBe("ok");
    first.unmount();
    state.clerk.isSignedIn = false;
    state.auth = { ...state.auth, privateSession: null };
    render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("recovery").textContent).toBe("none"));
    expect(screen.queryByRole("button", { name: "Retry local cleanup" })).toBeNull();
    expect(state.queryReceipt).not.toHaveBeenCalled();
    expect(state.recoveryCleanup).not.toHaveBeenCalled();
    expect(createDeletionJournal().read({ subject: "user-a", sessionId: "session-a" }).kind).toBe("ok");
  });

  it("keeps cleanup retry separate from the accepted server request", async () => {
    state.cleanupRun.mockResolvedValueOnce({ kind: "retry", reasons: ["storage-failure"] }).mockResolvedValueOnce({ kind: "cleared" });
    const view = render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    expect(state.submit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(state.cleanupRun).toHaveBeenCalledTimes(2));
    expect(state.submit).toHaveBeenCalledTimes(1);
  });

  it("keeps the app usable when the status watch errors", async () => {
    state.query.mockImplementation(() => { throw new Error("revoked token"); });
    render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByLabelText("Account deletion progress")).toBeTruthy());
    expect(screen.getByText(/pending\. Your account access remains restricted/i)).toBeTruthy();
  });

  it("rejects an account switch while analytics withdrawal is pending", async () => {
    let resolveStop!: () => void;
    (state.stopAnalytics as any).mockImplementation(() => new Promise<void>((resolve) => { resolveStop = resolve; }));
    const view = render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(state.stopAnalytics).toHaveBeenCalledTimes(1));
    state.clerk.userId = "user-b";
    state.clerk.sessionId = "session-b";
    state.auth = { viewer: "member", configured: true, privateSession: { ...state.access, identity: { ...state.access.identity, profileId: "profile-b", subject: "user-b", sessionId: "session-b" } } };
    view.rerender(<Mounted />);
    resolveStop();
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("cancelled"));
    expect(state.submit).not.toHaveBeenCalled();
    expect(screen.getByTestId("visible").textContent).toBe("false");
  });

  it("keeps progress across a private subtree remount and hides it for a foreign account", async () => {
    const view = render(<Mounted><div key={state.childKey}><Probe /></div></Mounted>);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByLabelText("Account deletion progress")).toBeTruthy());
    state.childKey = 1;
    view.rerender(<Mounted><div key={state.childKey}><Probe /></div></Mounted>);
    expect(screen.getByLabelText("Account deletion progress")).toBeTruthy();
    state.clerk.userId = "user-b";
    state.clerk.sessionId = "session-b";
    state.auth = { viewer: "member", configured: true, privateSession: null };
    view.rerender(<Mounted><div key={2}><Probe /></div></Mounted>);
    expect(screen.queryByLabelText("Account deletion progress")).toBeNull();
  });

  it("restores an accepted request after a strict-mode provider reload", async () => {
    const first = render(<StrictMode><Mounted /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    const requestId = state.submit.mock.calls[0][0].requestId as string;
    first.unmount();
    state.receipt = { requestId, ownerId: "owner-a", status: "app_pending" };
    render(<StrictMode><Mounted /></StrictMode>);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    expect(state.submit).toHaveBeenCalledTimes(1);
    expect(state.queryReceipt).toHaveBeenCalled();
    expect(screen.getByLabelText("Account deletion progress").textContent).toMatch(/browser still has private copies to clear/i);
    state.recoveryCleanup.mockResolvedValueOnce({ kind: "cleared", loanGeneration: 2, comparisonGeneration: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("cleanup").textContent).toBe("cleared"));
    expect(state.recoveryCleanup).toHaveBeenCalledTimes(1);
    expect(state.submit).toHaveBeenCalledTimes(1);
  });

  it("keeps restored browser cleanup pending after a cleanup failure", async () => {
    const first = render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    const requestId = state.submit.mock.calls[0][0].requestId as string;
    first.unmount();
    state.receipt = { requestId, ownerId: "owner-a", status: "app_pending" };
    state.recoveryCleanup.mockResolvedValue({ kind: "retry", reason: "server-failure" });
    render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(state.recoveryCleanup).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("cleanup").textContent).toBe("retry");
    expect(screen.getByLabelText("Account deletion progress").textContent).toMatch(/browser still has private copies to clear/i);
    expect(state.submit).toHaveBeenCalledTimes(1);
  });

  it("does not mark restored cleanup cleared when account B replaces account A", async () => {
    const first = render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    const requestId = state.submit.mock.calls[0][0].requestId as string;
    first.unmount();
    state.receipt = { requestId, ownerId: "owner-a", status: "app_pending" };
    let resolveCleanup!: (value: unknown) => void;
    state.recoveryCleanup.mockImplementationOnce(() => new Promise<RecoveryCleanupOutcome>((resolve) => { resolveCleanup = resolve as (value: unknown) => void; }));
    const second = render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(state.recoveryCleanup).toHaveBeenCalledTimes(1));
    state.clerk.userId = "user-b";
    state.clerk.sessionId = "session-b";
    state.access = { ...state.access, identity: { ...state.access.identity, profileId: "profile-b", subject: "user-b", sessionId: "session-b" } };
    state.auth = { viewer: "member", configured: true, privateSession: state.access };
    second.rerender(<Mounted />);
    resolveCleanup({ kind: "cleared", loanGeneration: 9, comparisonGeneration: 9 });
    await waitFor(() => expect(screen.getByTestId("subject").textContent).toBe("user-b"));
    expect(screen.getByTestId("cleanup").textContent).toBe("retry");
    expect(screen.getByTestId("visible").textContent).toBe("false");
  });

  it("restores an uncertain request and replays the original pair only after an explicit retry", async () => {
    state.submit.mockRejectedValueOnce(new Error("network timeout"));
    const first = render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("unknown"));
    const original = state.submit.mock.calls[0][0] as { requestId: string; grantId: string };
    first.unmount();
    state.submit.mockImplementationOnce(async (input: { requestId: string; grantId: string }) => ({ status: "replayed", requestId: input.requestId }));
    render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("unknown"));
    expect(state.submit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("accepted"));
    expect(state.submit).toHaveBeenCalledTimes(2);
    expect(state.submit.mock.calls[1][0]).toEqual(original);
  });

  it("refuses the initial mutation when the journal cannot be verified, then retries after storage recovers", async () => {
    const originalStorage = window.sessionStorage;
    let blocked = true;
    const failingStorage = {
      getItem: originalStorage.getItem.bind(originalStorage),
      setItem: (key: string, value: string) => { if (blocked) throw new Error("storage blocked"); originalStorage.setItem(key, value); },
      removeItem: originalStorage.removeItem.bind(originalStorage),
    };
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: failingStorage });
    render(<Mounted />);
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("unknown"));
    expect(state.submit).not.toHaveBeenCalled();
    expect(screen.getByText(/could not save the deletion request/i)).toBeTruthy();
    blocked = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: originalStorage });
  });

  it("does not query or replay a journal belonging to a foreign signed-in session", async () => {
    const journal = createDeletionJournal();
    journal.write({ version: 1, requestId: "00000000-0000-4000-8000-000000000001", grantId: "grant-a", subject: "user-a", sessionId: "session-a", createdAt: Date.now(), phase: "submitting" });
    state.clerk.userId = "user-b";
    state.clerk.sessionId = "session-b";
    state.access = { ...state.access, identity: { ...state.access.identity, profileId: "profile-b", subject: "user-b", sessionId: "session-b" } };
    state.auth = { viewer: "member", configured: true, privateSession: state.access };
    render(<Mounted />);
    await waitFor(() => expect(screen.getByTestId("subject").textContent).toBe("user-b"));
    expect(state.queryReceipt).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it("ignores a late former-account receipt after switching to account B", async () => {
    const journal = createDeletionJournal();
    journal.write({ version: 1, requestId: "00000000-0000-4000-8000-000000000002", grantId: "grant-a", subject: "user-a", sessionId: "session-a", createdAt: Date.now(), phase: "submitting" });
    const pending: Array<(value: unknown) => void> = [];
    state.queryReceipt.mockImplementation(() => new Promise<typeof state.receipt>((resolve) => pending.push(resolve as (value: unknown) => void)));
    const view = render(<Mounted />);
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    state.clerk.userId = "user-b";
    state.clerk.sessionId = "session-b";
    state.access = { ...state.access, identity: { ...state.access.identity, profileId: "profile-b", subject: "user-b", sessionId: "session-b" } };
    state.auth = { viewer: "member", configured: true, privateSession: state.access };
    view.rerender(<Mounted />);
    for (const resolve of pending) resolve({ requestId: "00000000-0000-4000-8000-000000000002", ownerId: "owner-a", status: "app_pending" });
    await waitFor(() => expect(screen.getByTestId("subject").textContent).toBe("user-b"));
    expect(screen.getByTestId("state").textContent).toBe("idle");
    expect(screen.getByTestId("visible").textContent).toBe("true");
    expect(state.submit).not.toHaveBeenCalled();
  });
});
