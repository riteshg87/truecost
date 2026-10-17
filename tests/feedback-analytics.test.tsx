// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsHarness = vi.hoisted(() => ({
  value: null as {
    status: "accepted" | "declined";
    consentEpoch: number;
    track: ReturnType<typeof vi.fn>;
  } | null,
  events: [] as unknown[],
}));

vi.mock("../lib/analytics/provider", () => ({
  useOptionalAnalytics: () => analyticsHarness.value,
}));
vi.mock("../lib/analytics/config", () => ({
  ANALYTICS_CONFIG: { environment: "development" },
}));

import { FeedbackPrompt } from "../components/FeedbackPrompt";
import { comparisonFeedbackContext, loanHealthFeedbackContext } from "../lib/feedback/context";
import { FeedbackTransportError, type FeedbackAcknowledgement, type FeedbackSubmission, type FeedbackTransport } from "../lib/feedback/transport";

const context = comparisonFeedbackContext("11111111-1111-4111-8111-111111111111");
const loanContext = loanHealthFeedbackContext("22222222-2222-4222-8222-222222222222");
const opaqueResultId = "33333333-3333-4333-8333-333333333333";

function transport(overrides: Partial<FeedbackTransport> = {}): FeedbackTransport {
  return {
    getStatus: vi.fn(async (value) => ({ status: "available" as const, context: value })),
    submit: vi.fn(async (input) => ({ status: "submitted" as const, requestId: input.requestId, context: input.context })),
    dismiss: vi.fn(async (value, requestId) => ({ status: "dismissed" as const, requestId, context: value })),
    ...overrides,
  };
}

function installAnalytics(): ReturnType<typeof vi.fn> {
  const track = vi.fn((build: (ids: { eventId: string; newCorrelationId: () => string }) => unknown) => {
    const event = build({
      eventId: "44444444-4444-4444-8444-444444444444",
      newCorrelationId: () => opaqueResultId,
    });
    analyticsHarness.events.push(event);
    return { ok: true as const, value: { queued: true, eventId: "44444444-4444-4444-8444-444444444444" } };
  });
  analyticsHarness.value = { status: "accepted", consentEpoch: 1, track };
  return track;
}

afterEach(() => {
  cleanup();
  analyticsHarness.value = null;
  analyticsHarness.events.length = 0;
});

describe("FeedbackPrompt analytics", () => {
  it("publishes only an acknowledged member submission with an opaque result token", async () => {
    const track = installAnalytics();
    render(<FeedbackPrompt context={context} transport={transport()} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Optional comment" }), { target: { value: "private business detail" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send feedback" })); });
    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());

    expect(track).toHaveBeenCalledOnce();
    const event = analyticsHarness.events[0] as { event: string; properties: Record<string, unknown> };
    expect(event.event).toBe("feedback_submitted");
    expect(event.properties).toMatchObject({ feature: "comparison", route_name: "comparison_detail", answer: "yes", context_version: "v1", auth_state: "member" });
    expect(event.properties.result_id).toBe(opaqueResultId);
    expect(event.properties.result_id).not.toBe(context.contextId);
    expect(JSON.stringify(event)).not.toContain("private business detail");
    expect(Object.keys(event.properties).sort()).toEqual([
      "answer", "auth_state", "context_version", "environment", "event_id", "event_version", "feature", "occurred_at", "release", "result_id", "route_name",
    ].sort());
  });

  it("records the results route separately from a saved comparison detail route", async () => {
    const track = installAnalytics();
    render(<FeedbackPrompt context={context} routeName="compare_results" transport={transport()} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send feedback" })); });
    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
    expect(track).toHaveBeenCalledOnce();
    expect((analyticsHarness.events[0] as { properties: { route_name: string } }).properties.route_name).toBe("compare_results");
  });

  it("does not publish failed sends or dismissal", async () => {
    const track = installAnalytics();
    const failed = transport({ submit: vi.fn(async () => { throw new FeedbackTransportError("network"); }) });
    const view = render(<FeedbackPrompt context={context} transport={failed} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send feedback" })); });
    await screen.findByRole("alert");
    expect(track).not.toHaveBeenCalled();

    view.rerender(<FeedbackPrompt context={loanContext} transport={transport()} />);
    await screen.findByText("Was this useful?");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); });
    expect(track).not.toHaveBeenCalled();
  });

  it("does not publish an already-resolved submission error", async () => {
    const track = installAnalytics();
    const api = transport({ submit: vi.fn(async () => { throw new FeedbackTransportError("already_resolved"); }) });
    render(<FeedbackPrompt context={context} transport={api} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send feedback" })); });
    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
    expect(track).not.toHaveBeenCalled();
  });

  it("drops a late acknowledgement after the consent epoch changes", async () => {
    const oldTrack = installAnalytics();
    let resolveSubmit!: (value: Awaited<ReturnType<FeedbackTransport["submit"]>>) => void;
    const api = transport({ submit: vi.fn((_input: FeedbackSubmission) => new Promise<FeedbackAcknowledgement>((resolve) => { resolveSubmit = resolve; })) });
    const view = render(<FeedbackPrompt context={context} transport={api} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    const newTrack = vi.fn();
    analyticsHarness.value = { status: "accepted", consentEpoch: 2, track: newTrack };
    view.rerender(<FeedbackPrompt context={context} transport={api} />);
    await act(async () => { resolveSubmit({ status: "submitted", requestId: "55555555-5555-4555-8555-555555555555", context }); });
    expect(oldTrack).not.toHaveBeenCalled();
    expect(newTrack).not.toHaveBeenCalled();
    expect(analyticsHarness.events).toHaveLength(0);
  });

  it("drops a late acknowledgement after the rendered account/context changes", async () => {
    const oldTrack = installAnalytics();
    let resolveSubmit!: (value: FeedbackAcknowledgement) => void;
    const oldApi = transport({ submit: vi.fn((_input: FeedbackSubmission) => new Promise<FeedbackAcknowledgement>((resolve) => { resolveSubmit = resolve; })) });
    const nextTrack = vi.fn();
    const nextApi = transport();
    const view = render(<FeedbackPrompt context={context} transport={oldApi} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    analyticsHarness.value = { status: "accepted", consentEpoch: 2, track: nextTrack };
    view.rerender(<FeedbackPrompt context={loanContext} transport={nextApi} />);
    await act(async () => { resolveSubmit({ status: "submitted", requestId: "66666666-6666-4666-8666-666666666666", context }); });
    expect(oldTrack).not.toHaveBeenCalled();
    expect(nextTrack).not.toHaveBeenCalled();
    expect(analyticsHarness.events).toHaveLength(0);
  });

  it("does not backfill a submission that began before consent was accepted", async () => {
    const oldTrack = vi.fn();
    analyticsHarness.value = { status: "declined", consentEpoch: 1, track: oldTrack };
    let resolveSubmit!: (value: FeedbackAcknowledgement) => void;
    const api = transport({ submit: vi.fn((_input: FeedbackSubmission) => new Promise<FeedbackAcknowledgement>((resolve) => { resolveSubmit = resolve; })) });
    const view = render(<FeedbackPrompt context={context} transport={api} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    const newTrack = vi.fn();
    analyticsHarness.value = { status: "accepted", consentEpoch: 2, track: newTrack };
    view.rerender(<FeedbackPrompt context={context} transport={api} />);
    await act(async () => { resolveSubmit({ status: "submitted", requestId: "77777777-7777-4777-8777-777777777777", context }); });
    expect(oldTrack).not.toHaveBeenCalled();
    expect(newTrack).not.toHaveBeenCalled();
    expect(analyticsHarness.events).toHaveLength(0);
  });

  it("emits once when an explicit retry receives a replay acknowledgement", async () => {
    const track = installAnalytics();
    let calls = 0;
    const submit = vi.fn(async (input: Parameters<FeedbackTransport["submit"]>[0]) => {
      calls += 1;
      if (calls === 1) throw new FeedbackTransportError("network");
      return { status: "replayed" as const, requestId: input.requestId, context: input.context };
    });
    const api = transport({ submit });
    render(<FeedbackPrompt context={context} transport={api} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send feedback" })); });
    await screen.findByRole("alert");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
    expect(submit).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledOnce();
    expect(analyticsHarness.events).toHaveLength(1);
  });

  it("keeps a successful feedback acknowledgement successful when analytics throws", async () => {
    const track = vi.fn(() => { throw new Error("analytics unavailable"); });
    analyticsHarness.value = { status: "accepted", consentEpoch: 1, track };
    render(<FeedbackPrompt context={loanContext} transport={transport()} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send feedback" })); });
    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
    expect(track).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
