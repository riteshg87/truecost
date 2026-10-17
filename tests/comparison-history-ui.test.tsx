// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import type {
  ComparisonHistoryDeleteAcknowledgement,
  ComparisonHistoryDeleteInput,
  ComparisonHistoryRecord,
  ComparisonHistoryTransport,
} from "../lib/comparison/history-transport";
import { compareOffers } from "../lib/finance/comparison";
import { createComparisonSnapshot, type ComparisonSnapshot } from "../lib/contracts/snapshot";
import { COMPARISON_PRIVATE_DB } from "../lib/comparison/private-workspace";
import { ComparisonTransportError } from "../lib/comparison/transport";
import { HistoryProvider, useComparisonHistory } from "../lib/comparison/history-provider";
import ComparisonsPage from "../app/comparisons/page";
import ComparisonDetailPage from "../app/comparisons/[id]/page";

const mocks = vi.hoisted(() => ({
  auth: null as unknown as AuthValue,
  transports: new Map<string, ComparisonHistoryTransport>(),
}));

vi.mock("../lib/auth/provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("../lib/comparison/history-transport", () => ({
  createSessionBoundComparisonHistoryTransport: (options: { identity: { profileId: string } }) => mocks.transports.get(options.identity.profileId),
}));
vi.mock("../components/ThemeToggle", () => ({ ThemeToggle: () => null }));

const NOW = Date.now() - 60_000;

function access(profileId: string): PrivateSessionAccess {
  const value: PrivateSessionAccess = {
    identity: { profileId, subject: `subject-${profileId}`, sessionId: `session-${profileId}`, authEpoch: 1, verifiedOnline: true },
    getToken: vi.fn(async () => "test-token"),
    isCurrent: () => mocks.auth.privateSession === value,
  };
  return value;
}

function authFor(session: PrivateSessionAccess): AuthValue {
  return { ready: true, viewer: "member", privateSession: session, initiatingTabId: "history-ui-tab" } as AuthValue;
}

function snapshot(seed = "a", lenderSuffix = ""): ComparisonSnapshot {
  const offers = ["A", "B"].map((name, index) => ({
    id: `offer-${name.toLowerCase()}-${seed}`,
    lender: `Lender ${name}${lenderSuffix}`,
    loanType: "home" as const,
    amount: 5_000_000,
    ratePct: 8 + index / 10,
    rateType: "reducing" as const,
    rateStructure: "floating" as const,
    tenureValue: 20,
    tenureUnit: "years" as const,
    processingFee: { mode: "percent" as const, value: 0.35 },
    gstPct: 18,
    insurancePremium: 0,
    insuranceFunding: "financed" as const,
    otherFees: [],
  }));
  return createComparisonSnapshot(offers, compareOffers(offers), { createdAt: new Date(NOW).toISOString() });
}

function record(title: string, id = "comparison-a"): ComparisonHistoryRecord {
  const value = snapshot(id, id === "comparison-b" ? " Second" : "");
  return {
    comparisonId: id,
    creationTime: NOW,
    resultId: value.resultId,
    snapshot: value,
    title,
    source: "member",
    createdAt: new Date(NOW).toISOString(),
    calculationVersion: value.calculationVersion,
  };
}

function transport(overrides: Partial<ComparisonHistoryTransport> = {}): ComparisonHistoryTransport {
  return {
    listComparisons: vi.fn(async () => ({ page: [], isDone: true, continueCursor: "" })),
    getComparison: vi.fn(async () => null),
    deleteComparison: vi.fn(async (input: ComparisonHistoryDeleteInput): Promise<ComparisonHistoryDeleteAcknowledgement> => ({
      status: "deleted",
      requestId: input.requestId,
      resultId: input.resultId,
      comparisonId: input.comparisonId ?? null,
      serverHash: "server-hash",
    })),
    ...overrides,
  };
}

function mount(child: ReactNode) {
  return render(<StrictMode><HistoryProvider>{child}</HistoryProvider></StrictMode>);
}

async function deleteDb() {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(COMPARISON_PRIVATE_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

beforeEach(() => {
  mocks.transports.clear();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

afterEach(async () => {
  cleanup();
  mocks.auth = null as unknown as AuthValue;
  await deleteDb();
  vi.clearAllMocks();
});

describe("comparison history UI", () => {
  it("ignores a deferred list response after the StrictMode workspace is cleaned up", async () => {
    const deferred = record("Deferred result");
    let resolveList!: (value: { page: ComparisonHistoryRecord[]; isDone: boolean; continueCursor: string }) => void;
    const list = vi.fn(() => new Promise<{ page: ComparisonHistoryRecord[]; isDone: boolean; continueCursor: string }>((resolve) => { resolveList = resolve; }));
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", transport({ listComparisons: list }));

    const view = mount(<ComparisonsPage />);
    await waitFor(() => expect(list).toHaveBeenCalled());
    view.unmount();
    await act(async () => { resolveList({ page: [deferred], isDone: true, continueCursor: "" }); });
    expect(screen.queryByText("Deferred result")).toBeNull();
  });

  it("loads newest-first pages and keeps the older-page control reachable", async () => {
    const first = record("Newest comparison");
    const second = record("Older comparison", "comparison-b");
    const list = vi.fn(async (input?: { cursor?: string | null }) => input?.cursor
      ? { page: [second], isDone: true, continueCursor: "" }
      : { page: [first], isDone: false, continueCursor: "next-page" });
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", transport({ listComparisons: list }));

    mount(<ComparisonsPage />);
    expect(await screen.findByText("Newest comparison")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load older comparisons" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load older comparisons" }));
    expect(await screen.findByText("Older comparison")).toBeTruthy();
    expect(list).toHaveBeenLastCalledWith({ cursor: "next-page", numItems: 50 });
  });

  it("drops a list response from the previous account", async () => {
    let resolveA!: (page: { page: ComparisonHistoryRecord[]; isDone: boolean; continueCursor: string }) => void;
    const oldPage = new Promise<{ page: ComparisonHistoryRecord[]; isDone: boolean; continueCursor: string }>((resolve) => { resolveA = resolve; });
    const oldRecord = record("Old account result");
    const newRecord = record("New account result", "comparison-b");
    const sessionA = access("profile-a");
    const sessionB = access("profile-b");
    mocks.auth = authFor(sessionA);
    mocks.transports.set("profile-a", transport({ listComparisons: vi.fn(async () => oldPage) }));
    mocks.transports.set("profile-b", transport({ listComparisons: vi.fn(async () => ({ page: [newRecord], isDone: true, continueCursor: "" })) }));

    const view = mount(<ComparisonsPage />);
    await waitFor(() => expect(mocks.transports.get("profile-a")?.listComparisons).toHaveBeenCalled());
    mocks.auth = authFor(sessionB);
    view.rerender(<StrictMode><HistoryProvider><ComparisonsPage /></HistoryProvider></StrictMode>);
    expect(await screen.findByText("New account result")).toBeTruthy();
    await act(async () => { resolveA({ page: [oldRecord], isDone: true, continueCursor: "" }); });
    expect(screen.queryByText("Old account result")).toBeNull();
  });

  it("shows a safe missing state for a deleted detail record", async () => {
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", transport());
    const params = Promise.resolve({ id: "missing" });
    await act(async () => {
      mount(<Suspense fallback={<p>Loading route</p>}><ComparisonDetailPage params={params} /></Suspense>);
    });
    expect(await screen.findByText("Saved comparison unavailable")).toBeTruthy();
  });

  it("loads the immutable detail through the real provider and retries a failed read", async () => {
    const saved = record("Readable result");
    const getComparison = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(saved);
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", transport({ getComparison }));
    const params = Promise.resolve({ id: saved.comparisonId });
    await act(async () => {
      mount(<Suspense fallback={<p>Loading route</p>}><ComparisonDetailPage params={params} /></Suspense>);
    });
    expect(await screen.findByText("This result could not be opened")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findAllByText("Lender A")).length).toBeGreaterThan(0);
    expect(getComparison).toHaveBeenCalledTimes(2);
  });

  it("clears the previous detail during a route ID change", async () => {
    const first = record("First result");
    const second = record("Second result", "comparison-b");
    const getComparison = vi.fn(async (id: string) => id === first.comparisonId ? first : second);
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", transport({ getComparison }));
    const paramsA = Promise.resolve({ id: first.comparisonId });
    const paramsB = Promise.resolve({ id: second.comparisonId });
    let view!: ReturnType<typeof mount>;
    await act(async () => {
      view = mount(<Suspense fallback={<p>Loading route</p>}><ComparisonDetailPage params={paramsA} /></Suspense>);
    });
    expect((await screen.findAllByText("Lender A")).length).toBeGreaterThan(0);
    await act(async () => {
      view.rerender(<StrictMode><HistoryProvider><Suspense fallback={<p>Loading route</p>}><ComparisonDetailPage params={paramsB} /></Suspense></HistoryProvider></StrictMode>);
    });
    expect(screen.queryByText("Lender A")).toBeNull();
    expect((await screen.findAllByText("Lender A Second")).length).toBeGreaterThan(0);
  });

  it("cancels deletion and restores focus to the delete trigger", async () => {
    const saved = record("Keep this result");
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", transport({ listComparisons: vi.fn(async () => ({ page: [saved], isDone: true, continueCursor: "" })) }));
    mount(<ComparisonsPage />);
    expect(await screen.findByText("Keep this result")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete" })));
    expect(screen.getByText("Keep this result")).toBeTruthy();
  });

  it("hides a queued row, shows pending status, and removes it after acknowledgement", async () => {
    const saved = record("Pending result");
    const deletion = transport({ listComparisons: vi.fn(async () => ({ page: [saved], isDone: true, continueCursor: "" })) });
    const deleteCall = vi.fn(async (input: ComparisonHistoryDeleteInput) => ({
      status: "deleted" as const,
      requestId: input.requestId,
      resultId: input.resultId,
      comparisonId: input.comparisonId ?? null,
      serverHash: "server-hash",
    }));
    deletion.deleteComparison = deleteCall;
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", deletion);
    mount(<ComparisonsPage />);
    expect(await screen.findByText("Pending result")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(deleteCall).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("Pending result")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Deletion pending")).toBeNull());
  });

  it("keeps pagination reachable when every loaded row is hidden by a pending deletion", async () => {
    const saved = record("Only loaded result");
    const list = vi.fn(async (input?: { cursor?: string | null }) => input?.cursor
      ? { page: [], isDone: true, continueCursor: "" }
      : { page: [saved], isDone: false, continueCursor: "next-page" });
    let resolveDelete!: (value: ComparisonHistoryDeleteAcknowledgement) => void;
    const deletion = transport({ listComparisons: list });
    deletion.deleteComparison = vi.fn((input: ComparisonHistoryDeleteInput): Promise<ComparisonHistoryDeleteAcknowledgement> => new Promise((resolve) => {
      resolveDelete = () => resolve({ status: "deleted", requestId: input.requestId, resultId: input.resultId, comparisonId: input.comparisonId ?? null, serverHash: "server-hash" });
    }));
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", deletion);
    mount(<ComparisonsPage />);
    expect(await screen.findByText("Only loaded result")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(screen.queryByText("Only loaded result")).toBeNull());
    expect(screen.getByRole("button", { name: "Load older comparisons" })).toBeTruthy();
    expect(screen.getByText("Deletion pending")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load older comparisons" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ cursor: "next-page", numItems: 50 }));
    expect(screen.getByText("No saved comparisons yet")).toBeTruthy();
    expect(screen.getByText("Deletion pending")).toBeTruthy();
    await waitFor(() => expect(deletion.deleteComparison).toHaveBeenCalled());
    await act(async () => { resolveDelete({ status: "deleted", requestId: "unused", resultId: saved.resultId, comparisonId: saved.comparisonId, serverHash: "server-hash" }); });
    await waitFor(() => expect(screen.queryByText("Deletion pending")).toBeNull());
  });

  it("keeps loaded actions available offline and pumps the durable delete on reconnect", async () => {
    const saved = record("Offline result");
    const deletion = transport({ listComparisons: vi.fn(async () => ({ page: [saved], isDone: true, continueCursor: "" })) });
    let resolveDelete!: (value: ComparisonHistoryDeleteAcknowledgement) => void;
    deletion.deleteComparison = vi.fn((input: ComparisonHistoryDeleteInput): Promise<ComparisonHistoryDeleteAcknowledgement> => new Promise((resolve) => {
      resolveDelete = () => resolve({ status: "deleted", requestId: input.requestId, resultId: input.resultId, comparisonId: input.comparisonId ?? null, serverHash: "server-hash" });
    }));
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", deletion);
    mount(<ComparisonsPage />);
    expect(await screen.findByText("Offline result")).toBeTruthy();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
    expect(await screen.findByText(/loaded comparisons remain available/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(screen.queryByText("Offline result")).toBeNull());
    expect(screen.getByText("Deletion pending")).toBeTruthy();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(deletion.deleteComparison).toHaveBeenCalled());
    await act(async () => { resolveDelete({ status: "deleted", requestId: "unused", resultId: saved.resultId, comparisonId: saved.comparisonId, serverHash: "server-hash" }); });
    await waitFor(() => expect(screen.queryByText("Deletion pending")).toBeNull());
  });

  it("surfaces a paused deletion reason and limits retry to eligible reasons", async () => {
    const saved = record("Needs review");
    const deletion = transport({ listComparisons: vi.fn(async () => ({ page: [saved], isDone: true, continueCursor: "" })) });
    deletion.deleteComparison = vi.fn(async () => { throw new ComparisonTransportError("result_conflict"); });
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", deletion);
    mount(<ComparisonsPage />);
    expect(await screen.findByText("Needs review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(screen.getByText(/saved comparison changed on the server/i)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("leaves the loaded row visible when local queue persistence fails", async () => {
    const saved = record("Persistence failure");
    const session = access("profile-a");
    mocks.auth = authFor(session);
    mocks.transports.set("profile-a", transport({ listComparisons: vi.fn(async () => ({ page: [saved], isDone: true, continueCursor: "" })) }));
    mount(<ComparisonsPage />);
    expect(await screen.findByText("Persistence failure")).toBeTruthy();
    const open = vi.spyOn(indexedDB, "open").mockImplementation(() => { throw new Error("storage unavailable"); });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText("Persistence failure")).toBeTruthy();
    expect(await screen.findByRole("alert")).toBeTruthy();
    open.mockRestore();
  });
});
