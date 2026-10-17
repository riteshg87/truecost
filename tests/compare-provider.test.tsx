// @vitest-environment jsdom
import { webcrypto, createHash } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthValue } from "../lib/auth/provider";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import type { ComparisonSaveInput, ComparisonSaveAcknowledgement } from "../lib/comparison/transport";
import { ComparisonTransportError } from "../lib/comparison/transport";
import { ComparisonWorkspace } from "../lib/comparison/private-workspace";
import { CompareProvider, useCompare } from "../lib/store";
import { GuestHandoffStorage } from "../lib/guest/handoff";
import { loadGuestSnapshot } from "../lib/guest/storage";
import { OfferGrid } from "../components/OfferGrid";
import ResultsPage from "../app/compare/results/page";

const mocks = vi.hoisted(() => ({ auth: null as unknown as AuthValue, factory: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("../lib/auth/provider", () => ({ useAuth: () => mocks.auth }));
vi.mock("../lib/auth/config", async (original) => ({
  ...await original<object>(), AUTH_CONFIG: { convexUrl: "https://test.convex.cloud" },
}));
vi.mock("../lib/comparison/transport", async (original) => ({
  ...await original<object>(), createSessionBoundComparisonTransport: mocks.factory,
}));
let value: ReturnType<typeof useCompare>;
const seen: Array<{ member: boolean; lender: string; result: string | null }> = [];
function Probe() {
  value = useCompare();
  seen.push({ member: value.member, lender: value.offers[0].lender, result: value.snapshot?.resultId ?? null });
  return <output>{value.message}</output>;
}
const tree = () => <StrictMode><CompareProvider><Probe /></CompareProvider></StrictMode>;
function grant(profileId: string): PrivateSessionAccess {
  const access: PrivateSessionAccess = {
    identity: { profileId, subject: profileId, sessionId: profileId + "-session", authEpoch: 1, verifiedOnline: true },
    isCurrent: () => mocks.auth.privateSession === access, getToken: async () => "test-token",
  };
  return access;
}
function acknowledge(input: ComparisonSaveInput): ComparisonSaveAcknowledgement {
  const s = JSON.parse(input.snapshot);
  const serverHash = createHash("sha256").update(JSON.stringify(["comparison", "save", input.snapshot, s.resultId, input.title, input.source, input.createdAt])).digest("hex");
  return { status: "saved", requestId: input.requestId, resultId: s.resultId, serverHash };
}
async function opened() { await waitFor(() => expect(value.hydrated).toBe(true)); }
async function fill(lender = "Synthetic A") {
  await act(async () => {
    value.offers.forEach((offer, i) => value.updateOffer(offer.id, { lender: i ? "Synthetic B" : lender, amount: 1000000, ratePct: i ? 9 : 8 }));
  });
}
async function calculate() {
  let result!: Awaited<ReturnType<typeof value.calculate>>;
  await act(async () => { result = await value.calculate(); });
  return result;
}
beforeEach(() => {
  cleanup(); seen.length = 0; vi.clearAllMocks();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  mocks.auth = { ready: true, viewer: "guest", privateSession: null, initiatingTabId: "initiating-tab" } as AuthValue;
  mocks.factory.mockImplementation(() => ({ saveComparison: async (input: ComparisonSaveInput) => acknowledge(input) }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("comparison provider integration", () => {
  it("includes a durable history deletion in sign-out warnings without replacing the active draft", async () => {
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    render(tree()); await opened(); await fill("Current draft"); await calculate();
    const original = value.snapshot!;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const history = new ComparisonWorkspace({ access: mocks.auth.privateSession!, tabId: "history-tab" });
    try {
      await history.open();
      await act(async () => {
        const result = await history.queueDelete({ resultId: original.resultId, comparisonId: "synthetic-comparison-id" });
        expect(result.kind).toBe("ok");
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(value.pendingCount).toBe(1));
      expect(value.snapshot).toEqual(original);
      expect(value.offers[0].lender).toBe("Current draft");
      expect(value.savePauseReason).toBe("deleted");
      await act(async () => { await value.discardPrivateData(false); });
      expect(value.pendingCount).toBe(1);
      await act(async () => { expect((await value.discardPrivateData(true)).kind).toBe("ok"); });
      const reopened = new ComparisonWorkspace({ access: mocks.auth.privateSession!, tabId: "fresh-tab" });
      try {
        await reopened.open();
        expect(reopened.current().deletions).toEqual([]);
      } finally { reopened.close(); }
    } finally { history.close(); }
  });
  it("keeps live APR previews behind membership so input edits cannot bypass the guest gate", async () => {
    render(<CompareProvider><Probe /><OfferGrid /></CompareProvider>);
    await opened(); await fill();
    expect(screen.queryByText("As you type")).toBeNull();
    expect(screen.queryByText("Best")).toBeNull();
    await calculate();
    await act(async () => value.updateOffer(value.offers[0].id, { ratePct: 7 }));
    expect(screen.queryByText("As you type")).toBeNull();
  });
  it("gives the narrow comparison grid a labelled keyboard scroll region", async () => {
    render(<CompareProvider><Probe /><OfferGrid /></CompareProvider>);
    await opened();
    const region = screen.getByRole("region", {
      name: "Loan comparison fields. Scroll horizontally to view all offers.",
    });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.querySelector("[style*='min-width: 20rem']")).not.toBeNull();
  });
  it("keeps the member three-offer grid keyboard-scrollable after adding an offer", async () => {
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    render(<CompareProvider><Probe /><OfferGrid /></CompareProvider>);
    await opened();
    await act(async () => value.addOffer());
    const region = screen.getByRole("region", {
      name: "Loan comparison fields. Scroll horizontally to view all offers.",
    });
    expect(value.offers).toHaveLength(3);
    expect(region.querySelector("[style*='min-width: 30rem']")).not.toBeNull();
    Object.defineProperty(region, "scrollWidth", { configurable: true, value: 480 });
    region.scrollLeft = 0;
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(region.scrollLeft).toBe(48);
    fireEvent.keyDown(region, { key: "End" });
    expect(region.scrollLeft).toBe(480);
    fireEvent.keyDown(region, { key: "Home" });
    expect(region.scrollLeft).toBe(0);
  });
  it("leaves legacy data untouched and limits a guest to two offers", async () => {
    localStorage.setItem("truecost.compare.v1", '{"private":"legacy"}');
    render(tree()); await opened();
    expect(value.offers[0].lender).toBe("");
    await act(async () => value.addOffer());
    expect(value.offers).toHaveLength(2);
    expect(localStorage.getItem("truecost.compare.v1")).toBe('{"private":"legacy"}');
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("does not spend the allowance on invalid input", async () => {
    render(tree()); await opened();
    expect((await calculate()).kind).toBe("error");
    expect((await loadGuestSnapshot()).kind).toBe("empty");
    await fill();
    expect(await calculate()).toEqual({ kind: "ok", href: "/compare/results" });
    expect((await loadGuestSnapshot()).kind).toBe("saved");
  });
  it("reopens the same immutable result after reload without recalculating", async () => {
    const view = render(tree()); await opened(); await fill(); await calculate();
    const saved = value.snapshot;
    view.unmount(); render(tree()); await opened();
    expect(value.snapshot).toEqual(saved);
    expect(await calculate()).toEqual({ kind: "ok", href: "/compare/results" });
    expect(value.snapshot?.resultId).toBe(saved?.resultId);
  });
  it("keeps the old result while edits are gated and preserved for sign-in", async () => {
    render(tree()); await opened(); await fill(); await calculate();
    const original = value.snapshot!;
    await act(async () => value.updateOffer(value.offers[0].id, { ratePct: 7 }));
    expect(value.snapshot).toEqual(original);
    const result = await calculate();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok" || !result.href) throw new Error("missing signin");
    const next = new URL(result.href, "https://test.invalid").searchParams.get("next")!;
    const requestId = new URL(next, "https://test.invalid").searchParams.get("requestId")!;
    const record = await new GuestHandoffStorage().read(requestId, "initiating-tab");
    expect(record.kind).toBe("ok");
    if (record.kind === "ok") {
      expect(record.value.draft?.offers[0].ratePct).toBe(7);
      expect(record.value.snapshot).toEqual(original);
    }
    expect(value.snapshot).toEqual(original);
  });
  it("does not automatically adopt a guest result into a signed-in account", async () => {
    const view = render(tree()); await opened(); await fill(); await calculate();
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    view.rerender(tree());
    expect(value.snapshot).toBeNull();
    expect(value.offers[0].lender).toBe("");
    await opened();
    expect(value.snapshot).toBeNull();
    await act(async () => value.addOffer());
    expect(value.offers).toHaveLength(3);
  });
  it("does not adopt a persisted guest result when a member grant arrives on a cold remount", async () => {
    // This represents an older browser guest choice restored before auth has
    // finished settling. A private grant must still select a fresh member
    // workspace and never read the public snapshot.
    localStorage.setItem("truecost.auth.guest", "1");
    mocks.auth = { ...mocks.auth, ready: false, viewer: "anonymous", guestIntent: true, privateSession: null } as AuthValue;
    const guestView = render(tree()); await opened(); await fill("Persisted guest"); await calculate();
    expect(value.snapshot).not.toBeNull();
    guestView.unmount();

    const memberAccess = grant("account-a");
    mocks.auth = { ...mocks.auth, ready: true, viewer: "member", guestIntent: true, privateSession: memberAccess } as AuthValue;
    render(tree()); await opened();
    expect(value.snapshot).toBeNull();
    expect(value.offers[0].lender).toBe("");
    expect(value.member).toBe(true);
  });
  it("persists private working state across a verified reload", async () => {
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    const view = render(tree()); await opened(); await fill(); await calculate();
    const s = value.snapshot;
    view.unmount(); render(tree()); await opened();
    expect(value.snapshot).toEqual(s);
    expect(value.offers[0].lender).toBe("Synthetic A");
  });
  it("blanks the first render after an account or verification grant changes", async () => {
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    const view = render(tree()); await opened(); await fill(); await calculate();
    seen.length = 0;
    mocks.auth = { ...mocks.auth, privateSession: grant("account-b") };
    view.rerender(tree());
    expect(seen[0]).toEqual({ member: true, lender: "", result: null });
    await opened();
    expect(value.snapshot).toBeNull();
    await fill("B draft");
    seen.length = 0;
    mocks.auth = { ...mocks.auth, privateSession: grant("account-b") };
    view.rerender(tree());
    expect(seen[0]).toEqual({ member: true, lender: "", result: null });
  });
  it("keeps a public child draft through anonymous startup becoming a ready guest", () => {
    function PublicChildDraft() {
      const [text, setText] = useState("");
      return <input aria-label="Public comparison draft" value={text} onChange={(event) => setText(event.target.value)} />;
    }
    mocks.auth = { ...mocks.auth, ready: false, viewer: "anonymous", privateSession: null };
    const view = render(<CompareProvider><PublicChildDraft /></CompareProvider>);
    fireEvent.change(screen.getByLabelText("Public comparison draft"), { target: { value: "unfinished public input" } });
    mocks.auth = { ...mocks.auth, ready: true, viewer: "guest", privateSession: null };
    view.rerender(<CompareProvider><PublicChildDraft /></CompareProvider>);
    expect((screen.getByLabelText("Public comparison draft") as HTMLInputElement).value).toBe("unfinished public input");
  });
  it("shows queued then saved only after the matching receipt, and deduplicates clicks", async () => {
    let finish!: (ack: ComparisonSaveAcknowledgement) => void;
    let input!: ComparisonSaveInput;
    const send = vi.fn((arg: ComparisonSaveInput) => { input = arg; return new Promise<ComparisonSaveAcknowledgement>(resolve => { finish = resolve; }); });
    mocks.factory.mockReturnValue({ saveComparison: send });
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    render(tree()); await opened(); await fill(); await calculate();
    await act(async () => { await value.save(); });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(value.saveStatus).toBe("sending");
    await act(async () => { finish(acknowledge(input)); });
    await waitFor(() => expect(value.saveStatus).toBe("saved"));
    await act(async () => { await value.save(); });
    expect(send).toHaveBeenCalledOnce();
  });
  it("shows a paused save after auth expiry and retries it only after a fresh verified grant", async () => {
    let authorized = false;
    const send = vi.fn(async (input: ComparisonSaveInput) => {
      if (!authorized) throw new ComparisonTransportError("unauthorized");
      return acknowledge(input);
    });
    mocks.factory.mockReturnValue({ saveComparison: send });
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    const view = render(tree()); await opened(); await fill(); await calculate();
    await act(async () => { await value.save(); });
    await waitFor(() => expect(value.hydrated).toBe(false));
    expect(value.saveStatus).toBe("idle");

    authorized = true;
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    view.rerender(tree());
    await opened();
    expect(value.saveStatus).toBe("paused");
    await act(async () => { await value.retrySave(); });
    await waitFor(() => expect(value.saveStatus).toBe("saved"));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("resumes an explicit guest save once after a full provider reload", async () => {
    const send = vi.fn(async (input: ComparisonSaveInput) => acknowledge(input));
    mocks.factory.mockReturnValue({ saveComparison: send });
    const view = render(tree()); await opened(); await fill(); await calculate();
    const original = value.snapshot!;
    let href = "";
    await act(async () => { const r = await value.save(); if (r.kind === "ok") href = r.href!; });
    const next = new URL(href, "https://test.invalid").searchParams.get("next")!;
    const requestId = new URL(next, "https://test.invalid").searchParams.get("requestId")!;
    view.unmount();
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    render(tree()); await opened();
    await act(async () => { expect(await value.resumeIntent(requestId)).toEqual({ kind: "ok", href: "/compare/results" }); });
    expect(value.snapshot).toEqual(original);
    await waitFor(() => expect(value.saveStatus).toBe("saved"));
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0].requestId).toBe(requestId);
    await act(async () => { expect((await value.resumeIntent(requestId)).kind).toBe("error"); });
    expect(send).toHaveBeenCalledOnce();
  });
  it("restores the edited public draft after cancelling sign-in and reloading", async () => {
    const view = render(tree()); await opened(); await fill(); await calculate();
    const first = value.snapshot!;
    await act(async () => value.updateOffer(value.offers[0].id, { ratePct: 7 }));
    const result = await calculate();
    if (result.kind !== "ok" || !result.href) throw new Error("missing handoff");
    const next = new URL(result.href, "https://test.invalid").searchParams.get("next")!;
    const requestId = new URL(next, "https://test.invalid").searchParams.get("requestId")!;
    await new GuestHandoffStorage().cancel(requestId, { initiatingTabId: "initiating-tab" });
    view.unmount(); render(tree()); await opened();
    expect(value.offers[0].ratePct).toBe(7);
    expect(value.snapshot).toEqual(first);
  });
  it("preserves a guest report through sign-in without saving or downloading it automatically", async () => {
    const send = vi.fn(async (input: ComparisonSaveInput) => acknowledge(input));
    mocks.factory.mockReturnValue({ saveComparison: send });
    const view = render(tree()); await opened(); await fill(); await calculate();
    const original = value.snapshot!;
    let href = "";
    await act(async () => { const result = await value.requestReport(); if (result.kind === "ok") href = result.href!; });
    const next = new URL(href, "https://test.invalid").searchParams.get("next")!;
    const preserved = new URL(next, "https://test.invalid");
    expect(preserved.searchParams.get("action")).toBe("download");
    const requestId = preserved.searchParams.get("requestId")!;
    view.unmount();
    window.history.replaceState(null, "", next);
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-report") };
    render(<CompareProvider><Probe /><ResultsPage /></CompareProvider>);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/compare/results#comparison-report"));
    expect(value.snapshot).toEqual(original);
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Generate PDF" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry sign-in action" })).toBeNull();
    await act(async () => { expect((await value.resumeIntent(requestId)).kind).toBe("error"); });
    expect(value.snapshot).toEqual(original);
    expect(send).not.toHaveBeenCalled();
  });
  it("requires a comparison before requesting a report", async () => {
    render(tree()); await opened();
    await act(async () => { expect((await value.requestReport()).kind).toBe("error"); });
    expect(sessionStorage.getItem("truecost.compare.recovery")).toBeNull();
  });
  it("finishes automatic return when the results screen changes from empty to populated", async () => {
    const view = render(tree()); await opened(); await fill(); await calculate();
    let href = "";
    await act(async () => { const r = await value.save(); if (r.kind === "ok") href = r.href!; });
    const next = new URL(href, "https://test.invalid").searchParams.get("next")!;
    view.unmount();
    window.history.replaceState(null, "", next);
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    render(<CompareProvider><Probe /><ResultsPage /></CompareProvider>);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/compare/results"));
    await waitFor(() => expect(value.saveStatus).toBe("saved"));
    expect(screen.queryByRole("button", { name: "Retry sign-in action" })).toBeNull();
    expect(router.replace).toHaveBeenCalledOnce();
  });
  it("keeps private work on Stay, clears it on confirmed sign-out, and preserves public result", async () => {
    const view = render(tree()); await opened(); await fill(); await calculate();
    const guestResult = (await loadGuestSnapshot()).snapshot;
    mocks.auth = { ...mocks.auth, viewer: "member", privateSession: grant("account-a") };
    view.rerender(tree()); await opened(); await fill("Private lender"); await calculate();
    await act(async () => { await value.discardPrivateData(false); });
    expect(value.snapshot).not.toBeNull();
    await act(async () => { expect((await value.discardPrivateData(true)).kind).toBe("ok"); });
    expect(value.snapshot).toBeNull();
    expect((await loadGuestSnapshot()).snapshot).toEqual(guestResult);
    view.unmount(); render(tree()); await opened();
    expect(value.snapshot).toBeNull();
  });
});
