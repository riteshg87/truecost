// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackPrompt } from "../components/FeedbackPrompt";
import {
  comparisonFeedbackContext,
  forgetRememberedFeedbackContext,
  readRememberedFeedbackContext,
  rememberFeedbackContext,
} from "../lib/feedback/context";
import type { FeedbackStatus, FeedbackTransport } from "../lib/feedback/transport";
import { FeedbackTransportError } from "../lib/feedback/transport";

const context = comparisonFeedbackContext("11111111-1111-4111-8111-111111111111");
const contextB = comparisonFeedbackContext("22222222-2222-4222-8222-222222222222");

function transport(overrides: Partial<FeedbackTransport> = {}): FeedbackTransport {
  return {
    getStatus: vi.fn(async (value) => ({ status: "available" as const, context: value })),
    submit: vi.fn(async (input) => ({ status: "submitted" as const, requestId: input.requestId, context: input.context })),
    dismiss: vi.fn(async (value, requestId) => ({ status: "dismissed" as const, requestId, context: value })),
    ...overrides,
  };
}

afterEach(() => { cleanup(); sessionStorage.clear(); });

describe("FeedbackPrompt", () => {
  it("asks only after status is available and suppresses a terminal server status", async () => {
    const available = transport();
    render(<FeedbackPrompt context={context} transport={available} />);
    await screen.findByText("Was this useful?");
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeTruthy();

    const submitted = transport({ getStatus: vi.fn(async (value) => ({ status: "submitted" as const, context: value })) });
    const view = render(<FeedbackPrompt context={contextB} transport={submitted} />);
    await waitFor(() => expect(view.container.querySelector("[aria-label=Feedback]")).toBeNull());
  });

  it("keeps comment and request ID for an explicit retry after a lost acknowledgement", async () => {
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
    const comment = screen.getByRole("textbox", { name: "Optional comment" });
    fireEvent.change(comment, { target: { value: "The explanation needs one more example" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send feedback" })); });
    await screen.findByRole("alert");
    expect((comment as HTMLTextAreaElement).value).toBe("The explanation needs one more example");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0].requestId).toBe(submit.mock.calls[1][0].requestId);
    expect(submit.mock.calls[0][0].comment).toBe(submit.mock.calls[1][0].comment);
    await waitFor(() => expect(screen.queryByLabelText("Feedback")).toBeNull());
  });

  it("uses a separate request ID when the user changes from a failed send to dismiss", async () => {
    const submit = vi.fn(async () => { throw new FeedbackTransportError("network"); });
    const dismiss = vi.fn(async (value, requestId) => ({ status: "dismissed" as const, requestId, context: value }));
    const api = transport({ submit, dismiss });
    render(<FeedbackPrompt context={context} transport={api} />);
    await screen.findByText("Was this useful?");
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send feedback" })); });
    await screen.findByRole("alert");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); });
    const submitCall = (submit.mock.calls as unknown as Array<[{ requestId: string }]>)[0];
    const dismissCall = (dismiss.mock.calls as unknown as Array<[unknown, string]>)[0];
    expect(submitCall[0].requestId).not.toBe(dismissCall[1]);
  });

  it("does not publish a stale status after account/context replacement", async () => {
    let resolveOld!: (value: FeedbackStatus) => void;
    const oldTransport = transport({ getStatus: vi.fn(() => new Promise<FeedbackStatus>((resolve) => { resolveOld = resolve; })) });
    const nextTransport = transport();
    const view = render(<FeedbackPrompt context={context} transport={oldTransport} />);
    view.rerender(<FeedbackPrompt context={contextB} transport={nextTransport} />);
    await screen.findByText("Was this useful?");
    await act(async () => { resolveOld({ status: "submitted", context }); });
    expect(screen.getByText("Was this useful?")).toBeTruthy();
    expect(nextTransport.getStatus).toHaveBeenCalledWith(contextB);
  });

  it("does not flash the old comment when the context changes", async () => {
    const first = transport();
    const second = transport();
    const view = render(<FeedbackPrompt context={context} transport={first} />);
    await screen.findByText("Was this useful?");
    fireEvent.change(screen.getByRole("textbox", { name: "Optional comment" }), { target: { value: "private draft" } });
    view.rerender(<FeedbackPrompt context={contextB} transport={second} />);
    expect(screen.queryByDisplayValue("private draft")).toBeNull();
    await screen.findByText("Was this useful?");
  });

  it("dismisses only after an explicit click and keeps the prompt terminal", async () => {
    const api = transport();
    render(<FeedbackPrompt context={context} transport={api} />);
    await screen.findByText("Was this useful?");
    expect(api.dismiss).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); });
    expect(api.dismiss).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Feedback")).toBeNull();
  });

  it("retains only account-scoped context metadata across an ordinary reload", () => {
    rememberFeedbackContext("profile-a", "comparison", context);
    expect(readRememberedFeedbackContext("profile-a", "comparison")).toEqual(context);
    expect(readRememberedFeedbackContext("profile-b", "comparison")).toBeNull();
    const stored = sessionStorage.getItem("truecost.feedback.context.v1.profile-a.comparison");
    expect(stored).toContain(context.contextId);
    expect(stored).not.toContain("comment");
    expect(stored).not.toContain("answer");
    forgetRememberedFeedbackContext("profile-a", "comparison");
    expect(readRememberedFeedbackContext("profile-a", "comparison")).toBeNull();
  });
});
