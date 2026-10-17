// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateBrowserClearPanel, type PrivateBrowserClearAvailability, type PrivateBrowserClearOutcome } from "../components/PrivateBrowserClearPanel";

function setup(initial: PrivateBrowserClearAvailability = { isLoaded: true, isSignedOut: true, isCurrent: true }) {
  let live = initial;
  const availability = () => live;
  const setAvailability = (next: PrivateBrowserClearAvailability) => { live = next; };
  const onClear = vi.fn<() => Promise<PrivateBrowserClearOutcome>>();
  onClear.mockResolvedValue({ kind: "cleared" });
  const view = render(<PrivateBrowserClearPanel availability={availability} onClear={onClear} />);
  return { view, availability, setAvailability, onClear };
}

afterEach(() => cleanup());

describe("PrivateBrowserClearPanel", () => {
  it("renders only for a loaded signed-out session", () => {
    const signedIn = setup({ isLoaded: true, isSignedOut: false, isCurrent: true });
    expect(screen.queryByRole("region", { name: "Clear private browser data" })).toBeNull();
    signedIn.view.unmount();
    const loading = setup({ isLoaded: false, isSignedOut: true, isCurrent: true });
    expect(screen.queryByRole("region", { name: "Clear private browser data" })).toBeNull();
    loading.view.unmount();
    setup();
    expect(screen.getByRole("region", { name: "Clear private browser data" })).toBeTruthy();
  });

  it("requires confirmation and leaves storage untouched on cancel", async () => {
    const { onClear } = setup();
    const trigger = screen.getByRole("button", { name: "Clear private browser data" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Confirm browser data removal" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClear).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear private browser data" }));
  });

  it("does not move focus when it first mounts and closes with Escape when idle", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Clear private browser data" });
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Confirm browser data removal" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear private browser data" }));
  });

  it("explains the all-account browser scope and disables duplicate confirmation", async () => {
    let resolveClear!: (outcome: PrivateBrowserClearOutcome) => void;
    const { onClear } = setup();
    onClear.mockImplementation(() => new Promise((resolve) => { resolveClear = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm browser data removal" });
    expect(dialog.textContent).toMatch(/all member private saved copies and unsynced queues for every account on this browser/i);
    expect(dialog.textContent).toMatch(/guest result stays available/i);
    expect(dialog.textContent).toMatch(/cloud data and downloaded files are unaffected/i);
    expect(dialog.textContent).toMatch(/minimal deletion recovery record remains/i);
    const confirm = screen.getByRole("button", { name: "Confirm and clear" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Clearing…" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolveClear({ kind: "cleared" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/private browser data was cleared/i));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Clear private browser data" }));
  });

  it("keeps a failed aggregate clear retryable and reports no false success", async () => {
    const { onClear } = setup();
    onClear.mockResolvedValueOnce({ kind: "retry" }).mockResolvedValueOnce({ kind: "cleared" });
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and clear" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not be cleared/i));
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and clear" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/private browser data was cleared/i));
    expect(onClear).toHaveBeenCalledTimes(2);
  });

  it("checks live availability before confirming and closes an open confirmation on transition", () => {
    const { view, setAvailability, onClear } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    setAvailability({ isLoaded: true, isSignedOut: false, isCurrent: false });
    fireEvent.click(screen.getByRole("button", { name: "Confirm and clear" }));
    expect(onClear).not.toHaveBeenCalled();
    view.rerender(<PrivateBrowserClearPanel availability={() => ({ isLoaded: true, isSignedOut: false, isCurrent: false })} onClear={onClear} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides during loading and leaves nonmodal confirmation focusable", () => {
    const { view, setAvailability, availability, onClear } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm and clear" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    setAvailability({ isLoaded: false, isSignedOut: false, isCurrent: false });
    view.rerender(<PrivateBrowserClearPanel availability={availability} onClear={onClear} />);
    expect(screen.queryByRole("region", { name: "Clear private browser data" })).toBeNull();
  });

  it("ignores a late clear result after the signed-out lifetime changes", async () => {
    let resolveClear!: (outcome: PrivateBrowserClearOutcome) => void;
    const { view, availability, setAvailability, onClear } = setup();
    onClear.mockImplementation(() => new Promise((resolve) => { resolveClear = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Clear private browser data" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);

    setAvailability({ isLoaded: true, isSignedOut: false, isCurrent: false });
    view.rerender(<PrivateBrowserClearPanel availability={availability} onClear={onClear} />);
    expect(screen.queryByRole("region", { name: "Clear private browser data" })).toBeNull();
    setAvailability({ isLoaded: true, isSignedOut: true, isCurrent: false });
    view.rerender(<PrivateBrowserClearPanel availability={availability} onClear={onClear} />);
    await act(async () => resolveClear({ kind: "cleared" }));
    expect(screen.queryByRole("status")).toBeNull();

    setAvailability({ isLoaded: true, isSignedOut: true, isCurrent: true });
    view.rerender(<PrivateBrowserClearPanel availability={availability} onClear={onClear} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
