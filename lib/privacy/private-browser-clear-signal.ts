"use client";

/**
 * Browser-local coordination for the explicit all-account private-data clear.
 * The wire value deliberately has no account, session, owner, or auth fields.
 */
export const PRIVATE_BROWSER_CLEAR_SIGNAL_KEY = "truecost.private.browser-clear.v1";
export const PRIVATE_BROWSER_CLEAR_SIGNAL_CHANNEL = "truecost.private.browser-clear.v1";

export interface PrivateBrowserClearSignal {
  readonly type: "private-browser-clear";
  readonly nonce: string;
}

export type PrivateBrowserClearSignalListener = (signal: PrivateBrowserClearSignal) => void;

export interface PrivateBrowserClearSignalSubscription {
  stop(): void;
}

export interface PrivateBrowserClearSignalOptions {
  channelFactory?: (name: string) => BroadcastChannel;
}

const listeners = new Set<PrivateBrowserClearSignalListener>();
const seenNonces = new Set<string>();
let revision = 0;
let nonceCounter = 0;

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isPrivateBrowserClearSignal(value: unknown): value is PrivateBrowserClearSignal {
  if (!value || typeof value !== "object" || !exactKeys(value, ["type", "nonce"])) return false;
  const signal = value as Partial<PrivateBrowserClearSignal>;
  return signal.type === "private-browser-clear" && typeof signal.nonce === "string" &&
    signal.nonce.length > 0 && signal.nonce.length <= 128 && signal.nonce.trim().length > 0;
}

/** Changes synchronously on receipt, before any React subscriber is notified. */
export function getPrivateBrowserClearRevision(): number {
  return revision;
}

function receive(value: unknown): void {
  if (!isPrivateBrowserClearSignal(value) || seenNonces.has(value.nonce)) return;
  seenNonces.add(value.nonce);
  // Keep a bounded deduplication set. A duplicate from BroadcastChannel and
  // the storage fallback must coalesce, while old nonces must not grow memory.
  if (seenNonces.size > 512) {
    const oldest = seenNonces.values().next().value;
    if (typeof oldest === "string") seenNonces.delete(oldest);
  }
  revision += 1;
  for (const listener of [...listeners]) {
    try { listener(value); } catch { /* observers cannot weaken local clearing */ }
  }
}

function newNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  nonceCounter += 1;
  return `${Date.now().toString(36)}-${nonceCounter.toString(36)}`;
}

/**
 * Subscribe through same-page delivery, BroadcastChannel, and storage events.
 * `stop` is idempotent and removes every browser listener owned by the caller.
 */
export function subscribeToPrivateBrowserClearSignal(
  listener: PrivateBrowserClearSignalListener,
  options: PrivateBrowserClearSignalOptions = {},
): PrivateBrowserClearSignalSubscription {
  let stopped = false;
  let channel: BroadcastChannel | null = null;
  const receiveForSubscription = (value: unknown) => {
    if (!stopped) receive(value);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PRIVATE_BROWSER_CLEAR_SIGNAL_KEY || !event.newValue) return;
    try { receiveForSubscription(JSON.parse(event.newValue) as unknown); } catch { /* malformed storage is ignored */ }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  const create = options.channelFactory ?? ((name) => new BroadcastChannel(name));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = create(PRIVATE_BROWSER_CLEAR_SIGNAL_CHANNEL);
      channel.onmessage = (event) => receiveForSubscription(event.data);
    } catch { channel = null; /* storage fallback remains available */ }
  }
  // The channel callback has to invoke the caller's listener, while the
  // shared receiver owns validation, deduplication, and revision increments.
  // Registering a forwarding listener keeps same-page and cross-tab behavior
  // identical without exposing any identity-bearing context.
  listeners.delete(listener);
  const forward: PrivateBrowserClearSignalListener = (signal) => {
    if (!stopped) listener(signal);
  };
  if (typeof window !== "undefined") listeners.add(forward);

  return { stop: () => {
    if (stopped) return;
    stopped = true;
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    listeners.delete(forward);
    channel?.close();
    channel = null;
  } };
}

/**
 * Publish before touching private storage. Same-page invalidation is always
 * synchronous. The return value reports whether a cross-tab transport was
 * available; false means other tabs may remain unaware.
 */
export function publishPrivateBrowserClearSignal(): boolean {
  const signal: PrivateBrowserClearSignal = Object.freeze({ type: "private-browser-clear", nonce: newNonce() });
  receive(signal);
  let externalDelivery = false;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(PRIVATE_BROWSER_CLEAR_SIGNAL_CHANNEL);
      channel.postMessage(signal);
      channel.close();
      externalDelivery = true;
    } catch { /* storage fallback still gets a chance */ }
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PRIVATE_BROWSER_CLEAR_SIGNAL_KEY, JSON.stringify(signal));
      window.localStorage.removeItem(PRIVATE_BROWSER_CLEAR_SIGNAL_KEY);
      externalDelivery = true;
    } catch { /* notification-unavailable is reported by the false return */ }
  }
  return externalDelivery;
}
