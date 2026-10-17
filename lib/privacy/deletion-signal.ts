import type { PrivateSessionAccess } from "../auth/private-session";

export const DELETION_SIGNAL_KEY = "truecost.private.deletion.v1";
export const DELETION_SIGNAL_CHANNEL = "truecost.private.deletion.v1";

export interface AccountDeletionSignal {
  type: "account-deletion";
  profileId: string;
}

export interface AccountDeletionCleanup {
  run(): Promise<{ kind: "cleared" } | { kind: "retry"; reasons?: readonly string[] }>;
}

export interface DeletionSignalSubscription {
  stop(): void;
}

export interface CapturedDeletionSignal {
  /** Publish the captured account scope after the deletion request is accepted. */
  publish(): boolean;
}

export interface DeletionSignalOptions {
  access: PrivateSessionAccess;
  onRevoke: () => void;
  channelFactory?: (name: string) => BroadcastChannel;
}

export interface DeletionCleanupScope {
  readonly profileId: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly authEpoch: number;
  /** An opaque page-lifetime fence, never an auth credential. */
  readonly runtime: string;
}

export type DeletionCleanupStatus = "idle" | "pending" | "cleared" | "retry";

export interface DeletionCleanupSnapshot {
  readonly scope: DeletionCleanupScope;
  readonly status: DeletionCleanupStatus;
  readonly reasons: readonly ("storage-failure" | "runtime-changed")[];
}

export interface DeletionCleanupRegistration { stop(): void; }
export type DeletionCleanupListener = (snapshot: DeletionCleanupSnapshot) => void;
export type DeletionCleanupScopeOrAccess = DeletionCleanupScope | PrivateSessionAccess;
export type DeletionCleanupRole = "loan" | "comparison";

const localListeners = new Set<(value: unknown) => void>();
const cleanupStates = new Map<string, CleanupState>();
const runtimeScope = `runtime-${Math.random().toString(36).slice(2)}`;

interface CleanupEntry {
  readonly access: PrivateSessionAccess;
  readonly cleanup: AccountDeletionCleanup;
  readonly role?: DeletionCleanupRole;
  active: boolean;
  done: boolean;
}

interface CleanupState {
  readonly scope: DeletionCleanupScope;
  readonly entries: Set<CleanupEntry>;
  readonly requiredRoles: Set<DeletionCleanupRole>;
  readonly completedRoles: Set<DeletionCleanupRole>;
  readonly listeners: Set<DeletionCleanupListener>;
  status: DeletionCleanupStatus;
  reasons: readonly ("storage-failure" | "runtime-changed")[];
  inFlight: Promise<DeletionCleanupSnapshot> | null;
  signalSeen: boolean;
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function isAccountDeletionSignal(value: unknown): value is AccountDeletionSignal {
  if (!value || typeof value !== "object" || !exactKeys(value, ["type", "profileId"])) return false;
  const signal = value as Partial<AccountDeletionSignal>;
  return signal.type === "account-deletion" && typeof signal.profileId === "string" &&
    signal.profileId.length > 0 && signal.profileId.length <= 200 && signal.profileId.trim().length > 0;
}

function validAccess(access: PrivateSessionAccess): boolean {
  try {
    const identity = access.identity;
    return access.isCurrent() && identity.verifiedOnline === true &&
      typeof identity.profileId === "string" && identity.profileId.length > 0 && identity.profileId.length <= 200 &&
      typeof identity.subject === "string" && identity.subject.length > 0 && identity.subject.length <= 256 &&
      typeof identity.sessionId === "string" && identity.sessionId.length > 0 && identity.sessionId.length <= 256 &&
      Number.isSafeInteger(identity.authEpoch) && identity.authEpoch >= 0;
  } catch { return false; }
}

function scopeFrom(access: PrivateSessionAccess): DeletionCleanupScope {
  const identity = access.identity;
  return Object.freeze({ profileId: identity.profileId, subject: identity.subject, sessionId: identity.sessionId, authEpoch: identity.authEpoch, runtime: runtimeScope });
}

function scopeKey(scope: DeletionCleanupScope): string {
  return JSON.stringify([scope.runtime, scope.profileId, scope.subject, scope.sessionId, scope.authEpoch]);
}

function scopeFor(value: DeletionCleanupScopeOrAccess): DeletionCleanupScope {
  return "identity" in value ? scopeFrom(value) : Object.freeze({ ...value });
}

function stateFor(value: DeletionCleanupScopeOrAccess): CleanupState {
  const scope = scopeFor(value);
  const key = scopeKey(scope);
  const existing = cleanupStates.get(key);
  if (existing) return existing;
  const state: CleanupState = { scope, entries: new Set(), requiredRoles: new Set(), completedRoles: new Set(), listeners: new Set(), status: "idle", reasons: [], inFlight: null, signalSeen: false };
  cleanupStates.set(key, state);
  return state;
}

function snapshot(state: CleanupState): DeletionCleanupSnapshot {
  return Object.freeze({ scope: state.scope, status: state.status, reasons: state.reasons });
}

function notify(state: CleanupState): DeletionCleanupSnapshot {
  const next = snapshot(state);
  for (const listener of [...state.listeners]) {
    try { listener(next); } catch { /* observers cannot weaken cleanup */ }
  }
  return next;
}

function normalizeReasons(value: unknown): ("storage-failure" | "runtime-changed")[] {
  if (!Array.isArray(value)) return ["storage-failure"];
  const reasons = value.filter((reason): reason is "storage-failure" | "runtime-changed" => reason === "storage-failure" || reason === "runtime-changed");
  return reasons.length > 0 ? [...new Set(reasons)] : ["storage-failure"];
}

function matchingEntries(signal: AccountDeletionSignal): Map<CleanupState, CleanupEntry[]> {
  const matches = new Map<CleanupState, CleanupEntry[]>();
  for (const state of cleanupStates.values()) {
    if (state.scope.profileId !== signal.profileId || state.status === "cleared" || state.signalSeen) continue;
    const entries: CleanupEntry[] = [];
    for (const entry of state.entries) {
      if (!entry.active || entry.done) continue;
      try {
        // This is the last access check before the captured capability is
        // snapshotted. The capability itself performs removal only.
        if (entry.access.isCurrent() && entry.access.identity.profileId === signal.profileId) entries.push(entry);
      } catch { /* revoked or malformed access is ignored */ }
    }
    if (entries.length > 0) {
      state.signalSeen = true;
      matches.set(state, entries);
    }
  }
  return matches;
}

async function runState(state: CleanupState, captured: readonly CleanupEntry[]): Promise<DeletionCleanupSnapshot> {
  const results = await Promise.all(captured.map(async (entry) => {
    try { return await entry.cleanup.run(); }
    catch { return { kind: "retry" as const, reasons: ["storage-failure" as const] }; }
  }));
  const failures = results.filter((result) => result.kind === "retry");
  if (failures.length > 0) {
    state.status = "retry";
    state.reasons = [...new Set(failures.flatMap((result) => normalizeReasons(result.reasons)))];
  } else {
    captured.forEach((entry) => {
      entry.done = true;
      if (entry.role) state.completedRoles.add(entry.role);
      state.entries.delete(entry);
    });
    const complete = [...state.requiredRoles].every((role) => state.completedRoles.has(role));
    state.status = complete ? "cleared" : "pending";
    state.reasons = [];
  }
  state.inFlight = null;
  const next = notify(state);
  if (state.status === "pending" && [...state.entries].some((entry) => !entry.done)) {
    queueMicrotask(() => startState(state, [...state.entries].filter((entry) => !entry.done)));
  }
  return next;
}

function startState(state: CleanupState, captured: readonly CleanupEntry[]): void {
  if (captured.length === 0 || state.inFlight || state.status === "cleared") return;
  state.status = "pending";
  state.reasons = [];
  notify(state);
  const promise = runState(state, captured);
  state.inFlight = promise;
  void promise.catch(() => undefined);
}

/** Register a removal-only capability while this verified session is live. */
export function registerAccountDeletionCleanup(access: PrivateSessionAccess, cleanup: AccountDeletionCleanup | null, role?: DeletionCleanupRole): DeletionCleanupRegistration | null {
  if (!cleanup || typeof cleanup.run !== "function" || !validAccess(access)) return null;
  const state = stateFor(access);
  if (role) {
    state.requiredRoles.add("loan");
    state.requiredRoles.add("comparison");
  }
  const entry: CleanupEntry = { access, cleanup, role, active: true, done: false };
  state.entries.add(entry);
  if (state.signalSeen && (state.status === "pending" || state.status === "retry")) {
    queueMicrotask(() => startState(state, [...state.entries].filter((candidate) => !candidate.done)));
  }
  return { stop: () => {
    entry.active = false;
    // Keep captured callbacks after unmount while an accepted signal is
    // pending or retryable. They are removed only after successful cleanup.
    if (state.status === "idle" && !state.signalSeen && !state.inFlight) state.entries.delete(entry);
  } };
}

export function getAccountDeletionCleanupScope(access: PrivateSessionAccess): DeletionCleanupScope | null {
  try { return validAccess(access) ? scopeFrom(access) : null; } catch { return null; }
}

export function getAccountDeletionCleanupSnapshot(value: DeletionCleanupScopeOrAccess): DeletionCleanupSnapshot {
  return snapshot(stateFor(value));
}

export function subscribeToAccountDeletionCleanup(value: DeletionCleanupScopeOrAccess, listener: DeletionCleanupListener): DeletionSignalSubscription {
  const state = stateFor(value);
  state.listeners.add(listener);
  listener(snapshot(state));
  return { stop: () => { state.listeners.delete(listener); } };
}

export function retryAccountDeletionCleanup(value: DeletionCleanupScopeOrAccess): Promise<DeletionCleanupSnapshot> {
  const state = stateFor(value);
  if (state.inFlight) return state.inFlight;
  if (state.status !== "retry") return Promise.resolve(snapshot(state));
  const pending = [...state.entries].filter((entry) => !entry.done);
  if (pending.length === 0) return Promise.resolve(snapshot(state));
  startState(state, pending);
  return state.inFlight ?? Promise.resolve(snapshot(state));
}

function scopeMatches(signal: AccountDeletionSignal, access: PrivateSessionAccess): boolean {
  return signal.profileId === access.identity.profileId;
}

function dispatchSignal(value: unknown): void {
  if (!isAccountDeletionSignal(value)) return;
  const matches = matchingEntries(value);
  // Queue after all sync listeners, including auth's revoke callback. The
  // matching capability list has already been snapshotted above.
  queueMicrotask(() => { for (const [state, entries] of matches) startState(state, entries); });
}

/** Subscribe to the current verified account using both browser channels. */
export function subscribeToAccountDeletionSignal(options: DeletionSignalOptions): DeletionSignalSubscription {
  const { access, onRevoke } = options;
  let stopped = false;
  let revoked = false;
  let channel: BroadcastChannel | null = null;
  const receive = (value: unknown) => {
    dispatchSignal(value);
    if (!stopped && !revoked && access.isCurrent() && isAccountDeletionSignal(value) && scopeMatches(value, access)) {
      revoked = true;
      onRevoke();
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DELETION_SIGNAL_KEY || !event.newValue) return;
    try { receive(JSON.parse(event.newValue) as unknown); } catch { /* malformed storage events are ignored */ }
  };
  window.addEventListener("storage", onStorage);
  const listener = receive;
  localListeners.add(listener);
  const create = options.channelFactory ?? ((name) => new BroadcastChannel(name));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = create(DELETION_SIGNAL_CHANNEL);
      channel.onmessage = (event) => receive(event.data);
    } catch { channel = null; }
  }
  return { stop: () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("storage", onStorage);
    localListeners.delete(listener);
    channel?.close();
    channel = null;
  } };
}

/** Capture a verified account scope before a deletion request starts. */
export function captureAccountDeletionSignal(access: PrivateSessionAccess, confirmed: boolean): CapturedDeletionSignal | null {
  if (!confirmed || !validAccess(access)) return null;
  const profileId = access.identity.profileId;
  return Object.freeze({ publish: () => publishAccountDeletionProfile(profileId) });
}

function publishAccountDeletionProfile(profileId: string): boolean {
  const signal: AccountDeletionSignal = { type: "account-deletion", profileId };
  let delivered = false;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(DELETION_SIGNAL_CHANNEL);
      channel.postMessage(signal);
      channel.close();
      delivered = true;
    } catch { /* storage fallback still reaches other tabs */ }
  }
  try {
    window.localStorage.setItem(DELETION_SIGNAL_KEY, JSON.stringify(signal));
    window.localStorage.removeItem(DELETION_SIGNAL_KEY);
    delivered = true;
  } catch { /* unavailable localStorage does not make BroadcastChannel fail */ }
  for (const listener of [...localListeners]) listener(signal);
  return delivered;
}

/** Notify the sender and other tabs after the server accepted deletion. */
export function publishAccountDeletionSignal(access: PrivateSessionAccess): boolean {
  if (!validAccess(access)) return false;
  return publishAccountDeletionProfile(access.identity.profileId);
}
