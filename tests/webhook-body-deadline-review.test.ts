import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedBody, MAX_BODY_BYTES } from "../convex/http";

afterEach(() => vi.useRealTimers());

function requestFor(body: ReadableStream<Uint8Array>): Request {
  return new Request("https://example.test/clerk-webhook", {
    method: "POST", body, duplex: "half",
  } as RequestInit);
}

describe("webhook body resource bounds", () => {
  it("finishes rejection even when stream cancellation never settles", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_BODY_BYTES + 1)); },
      cancel,
    });
    let settled = false;
    let result: string | null | undefined;
    void boundedBody(requestFor(body)).then(value => { settled = true; result = value; });
    await vi.advanceTimersByTimeAsync(5_001);
    expect(cancel).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
    expect(result).toBeNull();
  });

  it("uses a total deadline even when small chunks keep arriving", async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(value) { controller = value; }, cancel,
    });
    let settled = false;
    void boundedBody(requestFor(body)).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(4_000);
    controller.enqueue(new Uint8Array([32]));
    await vi.advanceTimersByTimeAsync(1_001);
    expect(settled).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
