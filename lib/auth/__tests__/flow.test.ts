import { describe, expect, it } from "vitest";
import { beginAuthFlow, cancelAuthFlow, isCurrentAuthFlow, newAuthFlow, transitionAuthFlow } from "../flow";
import { finalizeDisposition, isSignUpIfMissingTransfer, runCurrentAuthRequest, runCurrentAuthRequestWithTimeout } from "../requests";

describe("auth flow lifecycle", () => {
  it("invalidates deferred work after cancellation and accepts only the current generation", () => {
    const started = beginAuthFlow(newAuthFlow(), "signIn");
    const cancelled = cancelAuthFlow(started);
    expect(isCurrentAuthFlow(cancelled, started.generation)).toBe(false);
    expect(isCurrentAuthFlow(started, started.generation)).toBe(true);
    expect(transitionAuthFlow(cancelled, started.generation, "ready")).toEqual(cancelled);
  });

  it("keeps a resend recoverable while changing its phase", () => {
    const started = beginAuthFlow(newAuthFlow(), "signIn");
    const ready = transitionAuthFlow(started, started.generation, "ready");
    const resend = beginAuthFlow(ready, "signIn");
    expect(resend.kind).toBe("signIn");
    expect(resend.phase).toBe("sending");
    expect(resend.generation).toBeGreaterThan(ready.generation);
  });

  it("ignores a deferred callback after a newer attempt starts", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const first = beginAuthFlow(newAuthFlow(), "signIn");
    const second = beginAuthFlow(first, "signIn");
    finish();
    await pending;
    expect(isCurrentAuthFlow(second, first.generation)).toBe(false);
    expect(isCurrentAuthFlow(second, second.generation)).toBe(true);
  });

  it("keeps a failed resend ready for an explicit retry", () => {
    const first = beginAuthFlow(newAuthFlow(), "signIn");
    const ready = transitionAuthFlow(first, first.generation, "ready");
    const resend = beginAuthFlow(ready, "signIn");
    expect(transitionAuthFlow(resend, resend.generation, "ready").phase).toBe("ready");
  });

  it("marks send and verify callbacks stale after back or unmount", async () => {
    let releaseSend!: (value: string) => void;
    const send = new Promise<string>((resolve) => { releaseSend = resolve; });
    const ref = { current: beginAuthFlow(newAuthFlow(), "signIn") };
    const sendResult = runCurrentAuthRequest(ref, ref.current.generation, () => send);
    ref.current = cancelAuthFlow(ref.current);
    releaseSend("sent");
    expect(await sendResult).toEqual({ kind: "stale" });

    let releaseVerify!: (value: string) => void;
    const verify = new Promise<string>((resolve) => { releaseVerify = resolve; });
    ref.current = beginAuthFlow(ref.current, "signIn");
    const verifyResult = runCurrentAuthRequest(ref, ref.current.generation, () => verify);
    ref.current = cancelAuthFlow(ref.current);
    releaseVerify("verified");
    expect(await verifyResult).toEqual({ kind: "stale" });
  });

  it("fences a late send rejection after cancellation", async () => {
    let rejectSend!: (error: Error) => void;
    const send = new Promise<string>((_resolve, reject) => { rejectSend = reject; });
    const ref = { current: beginAuthFlow(newAuthFlow(), "signIn") };
    const sendResult = runCurrentAuthRequestWithTimeout(ref, ref.current.generation, () => send);
    ref.current = cancelAuthFlow(ref.current);
    rejectSend(new Error("late provider failure"));
    expect(await sendResult).toEqual({ kind: "stale" });
  });

  it("keeps provider finalize failures and setup tasks visible", () => {
    expect(finalizeDisposition({ error: { code: "bad_finalize" } }, false)).toBe("error");
    expect(finalizeDisposition({}, true)).toBe("blocked");
    expect(finalizeDisposition({}, false)).toBe("ok");
  });

  it("recognizes only Clerk's post-verification new-account transfer error", () => {
    expect(isSignUpIfMissingTransfer({ errors: [{ code: "sign_up_if_missing_transfer" }] })).toBe(true);
    expect(isSignUpIfMissingTransfer({ errors: [{ code: "form_code_incorrect" }] })).toBe(false);
    expect(isSignUpIfMissingTransfer({ code: "sign_up_if_missing_transfer" })).toBe(false);
    expect(isSignUpIfMissingTransfer(null)).toBe(false);
  });

  it("keeps a late transfer response stale after a newer verification starts", async () => {
    let release!: (value: { error: { errors: Array<{ code: string }> } }) => void;
    const transfer = new Promise<{ error: { errors: Array<{ code: string }> } }>((resolve) => { release = resolve; });
    const ref = { current: beginAuthFlow(newAuthFlow(), "signIn") };
    const first = runCurrentAuthRequest(ref, ref.current.generation, () => transfer);
    ref.current = beginAuthFlow(ref.current, "signIn");
    release({ error: { errors: [{ code: "sign_up_if_missing_transfer" }] } });
    expect(await first).toEqual({ kind: "stale" });
    expect(isSignUpIfMissingTransfer({ errors: [{ code: "sign_up_if_missing_transfer" }] })).toBe(true);
  });
});
