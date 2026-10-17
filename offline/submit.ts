/**
 * Capture a public calculator draft synchronously, then serialize persistence.
 * Preventing the browser's native submit before awaiting storage avoids a
 * query-string navigation if IndexedDB is slow or unavailable.
 */
export function queueCalculatorSubmit<T>(
  form: HTMLFormElement,
  readDraft: () => T,
  submitDraft: (draft: T) => Promise<void> | void,
): () => void {
  let queue = Promise.resolve();
  const listener = (event: SubmitEvent) => {
    event.preventDefault();
    const draft = readDraft();
    queue = queue.then(() => submitDraft(draft)).catch(() => undefined);
  };
  form.addEventListener("submit", listener);
  return () => form.removeEventListener("submit", listener);
}
