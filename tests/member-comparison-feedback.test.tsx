// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PrivateSessionAccess } from "../lib/auth/private-session";

const mocks = vi.hoisted(() => ({ session: null as PrivateSessionAccess | null, transport: vi.fn(() => ({})) }));
vi.mock("../lib/auth/provider", () => ({ useAuth: () => ({ privateSession: mocks.session }) }));
vi.mock("../lib/feedback/transport", () => ({ createSessionBoundFeedbackTransport: mocks.transport }));
vi.mock("../components/FeedbackPrompt", () => ({ FeedbackPrompt: ({ context }: { context: { contextId: string } }) => {
  const [comment, setComment] = useState("");
  return <label>{context.contextId}<input aria-label="Unsent feedback" value={comment} onChange={(event) => setComment(event.target.value)} /></label>;
} }));
import { MemberComparisonFeedback } from "../components/MemberComparisonFeedback";

const resultA = "00000000-0000-4000-8000-000000000001";
const resultB = "00000000-0000-4000-8000-000000000002";
function session(profileId: string, isCurrent = () => true): PrivateSessionAccess {
  return { identity: { profileId, subject: profileId, sessionId: `session-${profileId}`, authEpoch: 1 }, isCurrent, getToken: async () => null } as unknown as PrivateSessionAccess;
}
beforeEach(() => { mocks.session = null; mocks.transport.mockClear(); });
afterEach(cleanup);

describe("comparison feedback account boundary", () => {
  it("does not create a transport or show feedback for guests and invalid grants", () => {
    const view = render(<MemberComparisonFeedback resultId={resultA} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    mocks.session = session("a", () => false);
    view.rerender(<MemberComparisonFeedback resultId={resultA} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(mocks.transport).not.toHaveBeenCalled();
  });

  it("keeps the result context across rerenders and clears drafts on account or result replacement", () => {
    mocks.session = session("a");
    const view = render(<MemberComparisonFeedback resultId={resultA} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Account A draft" } });
    view.rerender(<MemberComparisonFeedback resultId={resultA} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Account A draft");
    expect(mocks.transport).toHaveBeenCalledTimes(1);
    mocks.session = session("b");
    view.rerender(<MemberComparisonFeedback resultId={resultA} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Different result" } });
    view.rerender(<MemberComparisonFeedback resultId={resultB} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(resultB)).toBeTruthy();
  });

  it("hides the prompt immediately when its existing grant is revoked", () => {
    let current = true;
    mocks.session = session("a", () => current);
    const view = render(<MemberComparisonFeedback resultId={resultA} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
    current = false;
    view.rerender(<MemberComparisonFeedback resultId={resultA} />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
