// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComparisonSnapshot } from "../lib/contracts/snapshot";
import { compareOffers } from "../lib/finance/comparison";
import type { PrivateSessionAccess } from "../lib/auth/private-session";
import { useComparisonReport } from "../lib/reports/use-comparison-report";
import { ComparisonReportActions } from "../components/ComparisonReportActions";
import * as renderer from "../lib/reports/render";

const analyticsHarness = vi.hoisted(() => ({ value: null as null | { status: "accepted" | "declined"; consentEpoch: number; track: (build: (ids: { eventId: string; newCorrelationId: () => string }) => unknown) => { ok: boolean; value?: unknown } } }));
vi.mock("../lib/auth/provider", () => ({ useAuth: () => ({ privateSession: null }) }));
vi.mock("../lib/analytics/provider", () => ({ useOptionalAnalytics: () => analyticsHarness.value }));
vi.mock("../lib/analytics/config", () => ({ ANALYTICS_CONFIG: { environment: "development" } }));

const offers = [
  { id: "00000000-0000-4000-8000-000000000401", lender: "Aster Bank", loanType: "home" as const, amount: 5_000_000, ratePct: 8.4, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "percent" as const, value: 0.5 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "upfront" as const, otherFees: [] },
  { id: "00000000-0000-4000-8000-000000000402", lender: "Banyan Finance", loanType: "home" as const, amount: 5_000_000, ratePct: 8.7, rateType: "reducing" as const, rateStructure: "floating" as const, tenureValue: 20, tenureUnit: "years" as const, processingFee: { mode: "flat" as const, value: 8_000 }, gstPct: 18, insurancePremium: 0, insuranceFunding: "upfront" as const, otherFees: [] },
];
const snapshot = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: "2026-09-16T09:00:00.000Z" });

function access(profileId = "profile-a", current = true): PrivateSessionAccess {
  return { identity: { profileId, subject: `user-${profileId}`, sessionId: `session-${profileId}`, authEpoch: 1, verifiedOnline: true }, getToken: vi.fn(async () => "token"), isCurrent: () => current };
}

beforeEach(() => {
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:report-1");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => { analyticsHarness.value = null; cleanup(); vi.restoreAllMocks(); });

function analyticsRecorder(consentEpoch = 1) {
  const events: Array<{ event: string; properties: Record<string, unknown> }> = [];
  let sequence = 500;
  const delivered = new Set<string>();
  const track = vi.fn((build: (ids: { eventId: string; newCorrelationId: () => string }) => unknown) => {
    const eventId = `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
    const event = build({ eventId, newCorrelationId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` }) as { event: string; properties: Record<string, unknown> };
    const key = `${event.event}:${String(event.properties.request_id ?? "")}:${String(event.properties.stage ?? "")}`;
    const queued = !delivered.has(key);
    if (queued) { delivered.add(key); events.push(event); }
    return { ok: true, value: { queued, eventId } };
  });
  analyticsHarness.value = { status: "accepted", consentEpoch, track };
  return { events, track };
}

describe("comparison report lifecycle", () => {
  it("tracks requested and the current generated result with one opaque request ID", async () => {
    const analytics = analyticsRecorder();
    vi.spyOn(renderer, "renderComparisonReport").mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    const hook = renderHook(() => useComparisonReport(snapshot, "saved", access()));
    await act(async () => { await hook.result.current.generate(); });
    expect(analytics.events.map((event) => event.event)).toEqual(["report_generation_status", "report_generation_status"]);
    expect(analytics.events.map((event) => event.properties.stage)).toEqual(["requested", "generated"]);
    expect(analytics.events[0].properties.request_id).toBe(analytics.events[1].properties.request_id);
    expect(analytics.events[0].properties.source).toBe("saved");
    expect(analytics.events[0].properties).not.toHaveProperty("result_id");
    expect(analytics.events[0].properties).not.toHaveProperty("lender");
  });

  it("keeps renderer details out of both analytics and the user-visible error", async () => {
    const analytics = analyticsRecorder();
    vi.spyOn(renderer, "renderComparisonReport").mockRejectedValue(new Error("font unavailable for Aster Bank"));
    const hook = renderHook(() => useComparisonReport(snapshot, "current", access()));
    await act(async () => { await hook.result.current.generate(); });
    expect(analytics.events.map((event) => event.properties.stage)).toEqual(["requested", "failed"]);
    expect(analytics.events[1].properties.error_code).toBe("unknown");
    expect(hook.result.current.error).not.toContain("Aster Bank");
    expect(analytics.events[1].properties).not.toHaveProperty("error");
    expect(analytics.events[1].properties).not.toHaveProperty("lender");
  });

  it("does not publish a terminal event after the grant changes during rendering", async () => {
    const analytics = analyticsRecorder();
    let resolve!: (blob: Blob) => void;
    vi.spyOn(renderer, "renderComparisonReport").mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
    let current = true;
    const grant: PrivateSessionAccess = { ...access(), isCurrent: () => current };
    const hook = renderHook(() => useComparisonReport(snapshot, "saved", grant));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.generate(); });
    current = false;
    resolve(new Blob(["late"], { type: "application/pdf" }));
    await act(async () => { await pending; });
    expect(analytics.events.map((event) => event.properties.stage)).toEqual(["requested"]);
  });

  it("does not publish an old generation after consent is withdrawn and reaccepted", async () => {
    const analytics = analyticsRecorder(1);
    let resolve!: (blob: Blob) => void;
    vi.spyOn(renderer, "renderComparisonReport").mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
    const grant = access();
    const hook = renderHook(() => useComparisonReport(snapshot, "saved", grant));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.generate(); });
    analyticsHarness.value = { status: "declined", consentEpoch: 2, track: analytics.track };
    hook.rerender();
    analyticsHarness.value = { status: "accepted", consentEpoch: 3, track: analytics.track };
    hook.rerender();
    resolve(new Blob(["late"], { type: "application/pdf" }));
    await act(async () => { await pending; });
    expect(analytics.events.map((event) => event.properties.stage)).toEqual(["requested"]);
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.allowDownload()).toBe(true);
    expect(analytics.events.filter((event) => event.event === "report_download_initiated")).toHaveLength(0);
  });

  it("records one download handoff for repeated clicks on the same ready report", async () => {
    const analytics = analyticsRecorder();
    vi.spyOn(renderer, "renderComparisonReport").mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    render(<ComparisonReportActions snapshot={snapshot} source="saved" access={access()} />);
    await act(async () => { screen.getByRole("button", { name: "Generate PDF" }).click(); });
    const link = await screen.findByRole("link", { name: "Download PDF" });
    await act(async () => { link.click(); link.click(); });
    expect(analytics.events.filter((event) => event.event === "report_download_initiated")).toHaveLength(1);
    expect(analytics.events.find((event) => event.event === "report_download_initiated")?.properties).not.toHaveProperty("result_id");
  });

  it("defers rendering until an explicit gesture and exposes a fresh download URL", async () => {
    const renderPdf = vi.spyOn(renderer, "renderComparisonReport").mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    const hook = renderHook(() => useComparisonReport(snapshot, "saved", access()));
    expect(renderPdf).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe("idle");
    await act(async () => { await hook.result.current.generate(); });
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("ready");
    expect(hook.result.current.url).toBe("blob:report-1");
  });

  it("revokes the previous URL when the validated snapshot is replaced and on unmount", async () => {
    vi.spyOn(renderer, "renderComparisonReport").mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    const hook = renderHook(({ value }) => useComparisonReport(value, "current", access()), { initialProps: { value: snapshot } });
    await act(async () => { await hook.result.current.generate(); });
    const next = createComparisonSnapshot(offers, compareOffers(offers), { createdAt: "2026-09-16T09:00:01.000Z" });
    hook.rerender({ value: next });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report-1");
    await act(async () => { await hook.result.current.generate(); });
    hook.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("discards a late generation after the account grant changes", async () => {
    let resolve!: (blob: Blob) => void;
    const renderPdf = vi.spyOn(renderer, "renderComparisonReport").mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
    let current = true;
    const grant = access();
    const changingGrant: PrivateSessionAccess = { ...grant, isCurrent: () => current };
    const hook = renderHook(() => useComparisonReport(snapshot, "saved", changingGrant));
    let pending: Promise<void>;
    act(() => { pending = hook.result.current.generate(); });
    current = false;
    resolve(new Blob(["late"], { type: "application/pdf" }));
    await act(async () => { await pending; });
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(hook.result.current.url).toBeNull();
    expect(hook.result.current.status).not.toBe("ready");
  });

  it("keeps a cold reload locked and gives a printable HTML fallback after renderer failure", async () => {
    vi.spyOn(renderer, "renderComparisonReport").mockRejectedValue(new Error("font unavailable"));
    const { rerender } = render(<ComparisonReportActions snapshot={snapshot} source="saved" access={null} />);
    expect((screen.getByRole("button", { name: "Generate PDF" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Verify your account online/)).toBeTruthy();
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const member = access();
    rerender(<ComparisonReportActions snapshot={snapshot} source="saved" access={member} />);
    await act(async () => { screen.getByRole("button", { name: "Generate PDF" }).click(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Print this result" })).toBeTruthy());
    expect(screen.getByText(/Aster Bank/)).toBeTruthy();
    screen.getByRole("button", { name: "Print this result" }).click();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("does not print the private fallback after the grant is invalidated", async () => {
    vi.spyOn(renderer, "renderComparisonReport").mockRejectedValue(new Error("font unavailable"));
    let current = true;
    const grant: PrivateSessionAccess = { ...access(), isCurrent: () => current };
    render(<ComparisonReportActions snapshot={snapshot} source="saved" access={grant} />);
    await act(async () => { screen.getByRole("button", { name: "Generate PDF" }).click(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Print this result" })).toBeTruthy());
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    current = false;
    await act(async () => { screen.getByRole("button", { name: "Print this result" }).click(); });
    expect(print).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Verify your account online/)).toBeTruthy());
    await waitFor(() => expect(screen.queryByText(/Aster Bank/)).toBeNull());
  });

  it("hides fallback figures immediately on a render with an invalid grant", async () => {
    vi.spyOn(renderer, "renderComparisonReport").mockRejectedValue(new Error("font unavailable"));
    let current = true;
    const grant: PrivateSessionAccess = { ...access(), isCurrent: () => current };
    const view = render(<ComparisonReportActions snapshot={snapshot} source="saved" access={grant} />);
    await act(async () => { screen.getByRole("button", { name: "Generate PDF" }).click(); });
    await waitFor(() => expect(screen.getByText(/Aster Bank/)).toBeTruthy());
    current = false;
    view.rerender(<ComparisonReportActions snapshot={snapshot} source="saved" access={grant} />);
    expect(screen.queryByText(/Aster Bank/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Print this result" })).toBeNull();
  });

  it("keeps a ready URL scoped to the grant that generated it", async () => {
    vi.spyOn(renderer, "renderComparisonReport").mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    const first = access();
    const hook = renderHook(({ session }) => useComparisonReport(snapshot, "saved", session), { initialProps: { session: first } });
    await act(async () => { await hook.result.current.generate(); });
    expect(hook.result.current.url).toBe("blob:report-1");
    hook.rerender({ session: access("profile-b") });
    expect(hook.result.current.url).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report-1");
  });

  it("denies a download gesture after session expiry and revokes the ready URL", async () => {
    vi.spyOn(renderer, "renderComparisonReport").mockResolvedValue(new Blob(["pdf"]));
    let current = true;
    const grant: PrivateSessionAccess = { ...access(), isCurrent: () => current };
    render(<ComparisonReportActions snapshot={snapshot} source="saved" access={grant} />);
    await act(async () => { screen.getByRole("button", { name: "Generate PDF" }).click(); });
    const link = await screen.findByRole("link", { name: "Download PDF" });
    current = false;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => { link.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:report-1");
    expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
  });

  it("keeps the newer report when two render requests finish out of order", async () => {
    const completions: Array<(blob: Blob) => void> = [];
    vi.spyOn(renderer, "renderComparisonReport").mockImplementation(() => new Promise<Blob>((resolve) => { completions.push(resolve); }));
    const grant = access();
    const hook = renderHook(() => useComparisonReport(snapshot, "current", grant));
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = hook.result.current.generate(); second = hook.result.current.generate(); });
    const newer = new Blob(["newer"]);
    await act(async () => { completions[1](newer); await second; });
    await act(async () => { completions[0](new Blob(["older"])); await first; });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(newer);
    expect(hook.result.current.status).toBe("ready");
  });

  it("does not publish a late blob after unmount", async () => {
    let resolve!: (blob: Blob) => void;
    vi.spyOn(renderer, "renderComparisonReport").mockReturnValue(new Promise<Blob>((done) => { resolve = done; }));
    const hook = renderHook(() => useComparisonReport(snapshot, "current", access()));
    let pending: Promise<void>;
    act(() => { pending = hook.result.current.generate(); });
    hook.unmount();
    resolve(new Blob(["late"], { type: "application/pdf" }));
    await pending!;
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
