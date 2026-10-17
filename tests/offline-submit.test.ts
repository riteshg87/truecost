/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { queueCalculatorSubmit } from "../offline/submit";

describe("public calculator submit boundary", () => {
  it("cancels native navigation synchronously before queued persistence", () => {
    document.body.innerHTML = '<form action="/compare"><input name="amount" value="5000000"><button type="submit">Calculate</button></form>';
    const form = document.querySelector<HTMLFormElement>("form")!;
    const before = window.location.href;
    let calls = 0;
    queueCalculatorSubmit(form, () => ({ amount: form.elements.namedItem("amount") as HTMLInputElement }), async () => { calls += 1; await Promise.resolve(); });
    const canceled = !form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    expect(canceled).toBe(true);
    expect(window.location.href).toBe(before);
    expect(window.location.search).toBe("");
    expect(calls).toBe(0);
  });
});
