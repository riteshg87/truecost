// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { ClerkContextProvider, useReverification } from "@clerk/shared/react";
import { isReverificationCancelledError } from "@clerk/shared/error";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

function Probe({ fetcher, onResult, onError }: {
  fetcher: () => Promise<Response>;
  onResult: (value: unknown) => void;
  onError: (error: unknown) => void;
}) {
  const verifiedFetcher = useReverification(fetcher);
  useEffect(() => {
    void verifiedFetcher().then(onResult, onError);
  }, [verifiedFetcher, onError, onResult]);
  return null;
}

function clerkWithModal(openReverification: ReturnType<typeof vi.fn>) {
  return { __internal_openReverification: openReverification } as any;
}

const hint = () => new Response(JSON.stringify({
  clerk_error: { type: "forbidden", reason: "reverification-error", metadata: { reverification: { level: "strict" } } },
}), { status: 403, headers: { "Content-Type": "application/json" } });

describe("installed Clerk reverification contract", () => {
  it("opens the modal for a structured 403, retries after completion, and returns the success response", async () => {
    const openReverification = vi.fn();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(hint())
      .mockResolvedValueOnce(new Response(JSON.stringify({ proof: "verified-proof" }), { status: 200 }));
    const onResult = vi.fn();
    const onError = vi.fn();
    render(<ClerkContextProvider clerk={clerkWithModal(openReverification)}><Probe fetcher={fetcher} onResult={onResult} onError={onError} /></ClerkContextProvider>);

    await waitFor(() => expect(openReverification).toHaveBeenCalledTimes(1));
    const modalProps = openReverification.mock.calls[0][0];
    expect(modalProps).toEqual(expect.objectContaining({ afterVerification: expect.any(Function), afterVerificationCancelled: expect.any(Function) }));
    await act(async () => modalProps.afterVerification());
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ proof: "verified-proof" }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("rejects with Clerk's cancellation error and does not retry after modal cancellation", async () => {
    const openReverification = vi.fn();
    const fetcher = vi.fn().mockResolvedValueOnce(hint());
    const onResult = vi.fn();
    const onError = vi.fn();
    render(<ClerkContextProvider clerk={clerkWithModal(openReverification)}><Probe fetcher={fetcher} onResult={onResult} onError={onError} /></ClerkContextProvider>);

    await waitFor(() => expect(openReverification).toHaveBeenCalledTimes(1));
    await act(async () => openReverification.mock.calls[0][0].afterVerificationCancelled());
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(isReverificationCancelledError(onError.mock.calls[0][0])).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
  });
});
