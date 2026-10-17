"use client";

import { ClerkProvider, useAuth as useClerkAuth, useSignIn, useSignUp, useUser } from "@clerk/nextjs";
import { ConvexReactClient, useConvex, useConvexAuth, useMutation } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { authProviderConfigured, AUTH_CONFIG, authUnavailableMessage } from "./config";
import { safeNext } from "./access";
import type { Gating, Viewer } from "./access";
import { readableProviderError } from "./errors";
import { beginAuthFlow, cancelAuthFlow, isCurrentAuthFlow, newAuthFlow, transitionAuthFlow, type AuthFlowState } from "./flow";
import { parseIdentifier, type ParsedIdentifier } from "./identifier";
import { AuthRequestTimeoutError, finalizeDisposition, isSignUpIfMissingTransfer, runCurrentAuthRequest, runCurrentAuthRequestWithTimeout } from "./requests";
import { navigateToAuthDestination } from "./navigation";
import { PENDING_TTL_MS, parsePendingRecord, storageGet, storageRemove, storageSet } from "./storage";
import { usePrivateSession } from "./use-private-session";
import type { PrivateSessionAccess } from "./private-session";
import { subscribeToAccountDeletionSignal } from "../privacy/deletion-signal";
import { subscribeToPrivateBrowserClearSignal } from "../privacy/private-browser-clear-signal";
import { markConfirmedAnalyticsLogout, revokeAcceptedLocalAnalyticsPreference } from "../analytics/storage";

export interface Account {
  id: string;
  email: string | null;
  phone: string | null;
}

export type AuthResult = { ok: true } | { ok: false; error: string };

export interface AuthValue {
  viewer: Viewer;
  account: Account | null;
  ready: boolean;
  /** Explicit public comparison intent. This never grants a private session. */
  guestIntent: boolean;
  configured: boolean;
  gating: Gating;
  demoMode: false;
  pendingEmail: string | null;
  pendingNext: string;
  verificationReady: boolean;
  verificationPhase: AuthFlowState["phase"];
  /** Opaque Convex profile id for the verified current account. */
  accountKey: string | null;
  authEpoch: number;
  /** Increments only after an email verification flow completes. Reloads and token refreshes do not change it. */
  authCompletionEpoch: number;
  /** Session that produced the completion marker, used to fence account changes. */
  authCompletionSessionId: string | null;
  privateSession: PrivateSessionAccess | null;
  initiatingTabId: string;
  unavailableReason: string | null;
  retryProvisioning: () => void;
  sendCode: (id: ParsedIdentifier, next?: string) => Promise<AuthResult>;
  verifyCode: (id: ParsedIdentifier, code: string, next?: string) => Promise<AuthResult>;
  continueAsGuest: () => void;
  signOut: () => Promise<void>;
  cancelVerification: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);
const GUEST_KEY = "truecost.auth.guest";
const PENDING_KEY = "truecost.auth.pending-email";
const AUTH_COMPLETION_MARKER_KEY = "truecost.auth.completion.v1";
const AUTH_COMPLETION_MARKER_TTL_MS = 10 * 60 * 1000;
const ANALYTICS_AUTH_FLOW_KEY = "truecost.analytics.auth-flow.v1";
const ANALYTICS_SAVE_KEY = "truecost.analytics.save.v1";
const ANALYTICS_AUTH_COMPLETED_KEY = "truecost.analytics.auth-completed.v1";
const ANALYTICS_GUEST_JOIN_KEY = "truecost.analytics.guest-join.v1";
let volatileTabId: string | null = null;

function clearAnalyticsSessionMarkers(): void {
  try {
    window.sessionStorage.removeItem(AUTH_COMPLETION_MARKER_KEY);
    window.sessionStorage.removeItem(ANALYTICS_AUTH_FLOW_KEY);
    window.sessionStorage.removeItem(ANALYTICS_SAVE_KEY);
    window.sessionStorage.removeItem(ANALYTICS_AUTH_COMPLETED_KEY);
    window.sessionStorage.removeItem(ANALYTICS_GUEST_JOIN_KEY);
  } catch { /* privacy cleanup is best effort when storage is unavailable */ }
}

function writeAuthCompletionMarker(sessionId: string): void {
  try { window.sessionStorage.setItem(AUTH_COMPLETION_MARKER_KEY, JSON.stringify({ sessionId, createdAt: Date.now() })); } catch { /* optional continuity marker */ }
}
function consumeAuthCompletionMarker(sessionId: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(AUTH_COMPLETION_MARKER_KEY);
    if (!raw) return false;
    const value = JSON.parse(raw) as { sessionId?: unknown; createdAt?: unknown };
    const valid = value.sessionId === sessionId && typeof value.createdAt === "number" && Number.isFinite(value.createdAt) && value.createdAt <= Date.now() + 60_000 && Date.now() - value.createdAt <= AUTH_COMPLETION_MARKER_TTL_MS;
    window.sessionStorage.removeItem(AUTH_COMPLETION_MARKER_KEY);
    return valid;
  } catch { return false; }
}

function newTabIdentity(): string | null {
  if (typeof crypto === "undefined") return null;
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto.getRandomValues !== "function") return null;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function tabId(): string {
  if (typeof window === "undefined") return "server";
  const key = "truecost.auth.tab";
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
    const next = newTabIdentity();
    if (!next) return "unavailable";
    window.sessionStorage.setItem(key, next);
    return next;
  } catch {
    volatileTabId ??= newTabIdentity();
    return volatileTabId ?? "unavailable";
  }
}

export function readPending(): { email: string; next: string } | null {
  if (typeof window === "undefined") return null;
  const raw = storageGet(() => window.sessionStorage, PENDING_KEY);
  const parsed = parsePendingRecord(raw);
  if (!parsed && raw !== null) storageRemove(() => window.sessionStorage, PENDING_KEY);
  return parsed;
}

function writePending(email: string | null, next = "/home"): void {
  if (typeof window === "undefined") return;
  if (!email) {
    storageRemove(() => window.sessionStorage, PENDING_KEY);
    return;
  }
  const parsed = parseIdentifier(email);
  if (!parsed.ok) return;
  storageSet(() => window.sessionStorage, PENDING_KEY, JSON.stringify({ email: parsed.id.value, next: safeNext(next), expiresAt: Date.now() + PENDING_TTL_MS }));
}

function UnconfiguredAuthProvider({ children }: { children: ReactNode }) {
  const [guest, setGuest] = useState(false);
  const [ready, setReady] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingNext, setPendingNext] = useState("/home");
  const [verificationReady] = useState(false);
  const [tab, setTab] = useState("server");

  useEffect(() => {
    setTab(tabId());
    setGuest(storageGet(() => window.localStorage, GUEST_KEY) === "1");
    const pending = readPending();
    setPendingEmail(pending?.email ?? null);
    setPendingNext(pending?.next ?? "/home");
    setReady(true);
  }, []);

  const value = useMemo<AuthValue>(() => ({
    viewer: guest ? "guest" : "anonymous",
    account: null,
    ready,
    guestIntent: guest,
    configured: false,
    gating: "enforced",
    demoMode: false,
    pendingEmail,
    pendingNext,
    verificationReady,
    verificationPhase: "idle",
    accountKey: null,
    authEpoch: 0,
    authCompletionEpoch: 0,
    authCompletionSessionId: null,
    privateSession: null,
    initiatingTabId: tab,
    unavailableReason: authUnavailableMessage,
    retryProvisioning: () => undefined,
    sendCode: async () => ({ ok: false, error: authUnavailableMessage }),
    verifyCode: async () => ({ ok: false, error: authUnavailableMessage }),
    cancelVerification: () => undefined,
    continueAsGuest: () => {
      storageSet(() => window.localStorage, GUEST_KEY, "1");
      setGuest(true);
    },
    signOut: async () => {
      storageRemove(() => window.localStorage, GUEST_KEY);
      setGuest(false);
    },
  }), [guest, ready, pendingEmail, pendingNext, tab]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ConfiguredAuthProvider({ children }: { children: ReactNode }) {
  const clerk = useClerkAuth();
  const { user } = useUser();
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const convexAuth = useConvexAuth();
  const convex = useConvex();
  const [profile, setProfile] = useState<{ _id: string; status: "active" | "deleting" | "deleted" } | null | undefined>(undefined);
  const [profileWatchFailed, setProfileWatchFailed] = useState(false);
  const [profileIdentity, setProfileIdentity] = useState<string | null>(null);
  const ensureCurrentUser = useMutation(api.users.ensureCurrentUser);
  const [guest, setGuest] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingNext, setPendingNext] = useState("/home");
  const [verificationReady, setVerificationReady] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionRetry, setProvisionRetry] = useState(0);
  const [authEpoch, setAuthEpoch] = useState(0);
  const [authCompletionEpoch, setAuthCompletionEpoch] = useState(0);
  const [authCompletionSessionId, setAuthCompletionSessionId] = useState<string | null>(null);
  const [privateSuspended, setPrivateSuspended] = useState(false);
  const [tab, setTab] = useState("server");
  const previousIdentity = useRef<string | null>(null);
  const currentIdentity = useRef<string | null>(null);
  const browserClearSuspended = useRef(false);
  const browserClearIdentity = useRef<string | null>(null);
  const provisionErrorIdentity = useRef<string | null>(null);
  // Store ownership with the request generation. A late completion from an
  // older finalize must not clear the marker for a newer finalize.
  const finalizingGeneration = useRef<number | null>(null);
  const flow = useRef<AuthFlowState>(newAuthFlow());
  const [verificationPhase, setVerificationPhase] = useState<AuthFlowState["phase"]>("idle");
  const request = useRef(0);
  const provisionedFor = useRef<string | null>(null);
  const profileRequest = useRef(0);

  useEffect(() => {
    setTab(tabId());
    setGuest(storageGet(() => window.localStorage, GUEST_KEY) === "1");
    const pending = readPending();
    setPendingEmail(pending?.email ?? null);
    setPendingNext(pending?.next ?? "/home");
  }, []);

  const identity = clerk.userId && clerk.sessionId ? `${clerk.userId}:${clerk.sessionId}` : null;
  currentIdentity.current = identity;
  useEffect(() => {
    if (previousIdentity.current !== identity) {
      if (previousIdentity.current !== null && previousIdentity.current !== identity) clearAnalyticsSessionMarkers();
      previousIdentity.current = identity;
      setAuthEpoch((value) => value + 1);
      setAuthCompletionEpoch(0);
      setAuthCompletionSessionId(null);
      const sameBrowserClearLifetime = browserClearSuspended.current && (identity === null || identity === browserClearIdentity.current);
      if (!sameBrowserClearLifetime) {
        browserClearSuspended.current = false;
        browserClearIdentity.current = null;
        setPrivateSuspended(false);
      }
      provisionedFor.current = null;
      provisionErrorIdentity.current = null;
      setProvisionError(null);
      setProfileIdentity(null);
      setProvisioning(false);
      if (finalizingGeneration.current === null) {
        flow.current = cancelAuthFlow(flow.current);
        request.current = flow.current.generation;
      }
      setVerificationPhase("idle");
      setVerificationReady(false);
    }
  }, [identity]);

  // Subscribe through the client so profile changes invalidate member state.
  // Reading the local result is wrapped because server query errors are part of
  // the auth state surface, rather than an error to expose to the whole app.
  useEffect(() => {
    const current = ++profileRequest.current;
    if (!clerk.isSignedIn || !convexAuth.isAuthenticated || convexAuth.isRefreshing || !identity) {
      setProfile(null);
      setProfileIdentity(null);
      setProfileWatchFailed(false);
      return;
    }
    setProfile(undefined);
    setProfileIdentity(null);
    const watch = convex.watchQuery(api.users.currentUser, { expectedSubject: clerk.userId, sessionMarker: clerk.sessionId });
    const update = () => {
      if (current !== profileRequest.current) return;
      try {
        const result = watch.localQueryResult();
        if (result !== undefined) {
          setProfile(result);
          setProfileIdentity(currentIdentity.current === identity ? identity : null);
          setProfileWatchFailed(false);
          if (result && result.status !== "active") {
            provisionErrorIdentity.current = identity;
            setProvisionError("Your account is currently unavailable. Try again later.");
          } else if (result?.status === "active") {
            provisionErrorIdentity.current = null;
            setProvisionError(null);
          }
        }
      } catch {
        setProfile(null);
        setProfileIdentity(null);
        setProfileWatchFailed(true);
        provisionErrorIdentity.current = identity;
        setProvisionError("Your account state is unavailable. Try again.");
      }
    };
    const stop = watch.onUpdate(update);
    update();
    return () => {
      profileRequest.current += 1;
      stop();
    };
  }, [clerk.isSignedIn, convexAuth.isAuthenticated, convexAuth.isRefreshing, identity, convex, provisionRetry]);

  useEffect(() => {
    if (!clerk.isLoaded || !clerk.isSignedIn || !convexAuth.isAuthenticated || convexAuth.isRefreshing || (profile !== undefined && profile !== null) || profileWatchFailed || provisioning || !identity || (provisionErrorIdentity.current === identity && provisionError)) return;
    if (provisionedFor.current === identity) return;
    provisionedFor.current = identity;
    const identityAtStart = identity;
    setProvisioning(true);
    if (provisionErrorIdentity.current !== identity) setProvisionError(null);
    // ensureCurrentUser only provisions. The bound currentUser subscription
    // owns the profile read, so a fast watch update cannot be overwritten by
    // the later mutation resolution.
    void ensureCurrentUser()
      .catch(() => {
        if (currentIdentity.current === identityAtStart && provisionedFor.current === identityAtStart) {
          provisionErrorIdentity.current = identityAtStart;
          setProvisionError("Your account could not be prepared. Try again.");
        }
      })
      .finally(() => {
        if (currentIdentity.current === identityAtStart && provisionedFor.current === identityAtStart) setProvisioning(false);
      });
  }, [clerk.isLoaded, clerk.isSignedIn, convexAuth.isAuthenticated, convexAuth.isRefreshing, profile, profileWatchFailed, provisioning, identity, provisionError, ensureCurrentUser, provisionRetry]);

  const sendCode = useCallback(async (id: ParsedIdentifier, next = "/home"): Promise<AuthResult> => {
    const destination = safeNext(next);
    const resend = flow.current.phase === "ready" && pendingEmail === id.value && flow.current.kind !== null;
    flow.current = beginAuthFlow(flow.current, resend ? flow.current.kind! : "signIn");
    const token = flow.current.generation;
    request.current = token;
    if (!resend) setVerificationReady(false);
    setVerificationPhase("sending");
    if (!clerk.isLoaded || !signIn || !signUp) {
      flow.current = transitionAuthFlow(flow.current, token, resend ? "ready" : "idle");
      setVerificationPhase(resend ? "ready" : "idle");
      return { ok: false, error: authUnavailableMessage };
    }
    const fail = (message: string): AuthResult => {
      if (isCurrentAuthFlow(flow.current, token)) {
        flow.current = transitionAuthFlow(flow.current, token, resend ? "ready" : "idle");
        setVerificationPhase(resend ? "ready" : "idle");
      }
      return { ok: false, error: message };
    };
    try {
      const createdRequest = await runCurrentAuthRequestWithTimeout(flow, token, () => signIn.create({ identifier: id.value, signUpIfMissing: true }));
      if (createdRequest.kind === "stale") return { ok: false, error: "This request is no longer current." };
      if (createdRequest.kind === "error") return fail(createdRequest.error instanceof AuthRequestTimeoutError
        ? "We could not send a verification code in time. Check your connection and try again."
        : readableProviderError(createdRequest.error));
      const created = createdRequest.value;
      if (created.error) return fail(readableProviderError(created.error));
      // signUpIfMissing always sends the code through sign-in. Clerk reveals
      // that the identifier is new only after a successful code verification.
      const sentRequest = await runCurrentAuthRequestWithTimeout(flow, token, () => signIn.emailCode.sendCode());
      if (sentRequest.kind === "stale") return { ok: false, error: "This request is no longer current." };
      if (sentRequest.kind === "error") return fail(sentRequest.error instanceof AuthRequestTimeoutError
        ? "We could not send a verification code in time. Check your connection and try again."
        : readableProviderError(sentRequest.error));
      const sent = sentRequest.value;
      if (sent.error) return fail(readableProviderError(sent.error));
      flow.current = { ...flow.current, kind: "signIn" };
      setVerificationReady(true);
      writePending(id.value, destination);
      setPendingEmail(id.value);
      setPendingNext(destination);
      flow.current = transitionAuthFlow(flow.current, token, "ready");
      setVerificationPhase("ready");
      return { ok: true };
    } catch (error) {
      if (isCurrentAuthFlow(flow.current, token)) {
        flow.current = transitionAuthFlow(flow.current, token, resend ? "ready" : "idle");
        setVerificationPhase(resend ? "ready" : "idle");
      }
      return { ok: false, error: readableProviderError(error) };
    }
  }, [clerk.isLoaded, pendingEmail, signIn, signUp]);

  const verifyCode = useCallback(async (id: ParsedIdentifier, code: string, next = pendingNext): Promise<AuthResult> => {
    const destination = safeNext(next);
    const token = request.current;
    if (!/^[0-9]{6}$/.test(code) || pendingEmail !== id.value) return { ok: false, error: "Enter the six digit code from your email." };
    if (!isCurrentAuthFlow(flow.current, token) || flow.current.kind === null || flow.current.phase !== "ready") return { ok: false, error: "This verification request has expired. Start again." };
    flow.current = transitionAuthFlow(flow.current, token, "verifying");
    setVerificationPhase("verifying");
    try {
      const recoverVerification = (message: string): AuthResult => {
        flow.current = transitionAuthFlow(flow.current, token, "ready");
        setVerificationPhase("ready");
        return { ok: false, error: message };
      };
      const finalizeVerified = async (active: typeof signIn | typeof signUp): Promise<AuthResult> => {
        if (active.status !== "complete") return recoverVerification("Additional verification is required before continuing.");
        let blockedByTask = false;
        let navigationRejected = false;
        // Clerk owns the in-flight finalize side effect. If cancellation races
        // it, the callback cannot navigate and the stale result cannot be
        // reported as success; the next identity/profile readiness check still
        // decides whether the session is usable.
        const identityAtFinalize = currentIdentity.current;
        finalizingGeneration.current = token;
        const finalizedRequest = await runCurrentAuthRequest(flow, token, () => active.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (!isCurrentAuthFlow(flow.current, token)) {
              navigationRejected = true;
              return;
            }
            const sessionId = typeof session?.id === "string" ? session.id : null;
            const identityStillBelongsToFinalize = currentIdentity.current === identityAtFinalize || Boolean(sessionId && currentIdentity.current?.endsWith(`:${sessionId}`));
            if (!identityStillBelongsToFinalize) {
              navigationRejected = true;
              return;
            }
            if (session.currentTask) {
              blockedByTask = true;
              return;
            }
            const url = decorateUrl(destination);
            if (url.startsWith("/") || url.startsWith("https://")) {
              if (sessionId) writeAuthCompletionMarker(sessionId);
              navigateToAuthDestination(url);
            }
          },
        }));
        if (finalizingGeneration.current === token) finalizingGeneration.current = null;
        if (finalizedRequest.kind === "stale") return { ok: false, error: "This request is no longer current." };
        if (finalizedRequest.kind === "error") return recoverVerification(readableProviderError(finalizedRequest.error));
        const finalized = finalizedRequest.value;
        const disposition = finalizeDisposition(finalized, blockedByTask);
        if (disposition === "error") return recoverVerification(readableProviderError(finalized.error));
        if (disposition === "blocked") return recoverVerification("Finish the account setup before continuing.");
        if (navigationRejected) return recoverVerification("Your account changed before verification finished. Try again.");
        writePending(null);
        setPendingEmail(null);
        setPendingNext("/home");
        setVerificationReady(false);
        setGuest(false);
        flow.current = transitionAuthFlow(flow.current, token, "idle");
        setVerificationPhase("idle");
        setAuthCompletionSessionId(currentIdentity.current?.split(":").slice(1).join(":") || null);
        setAuthCompletionEpoch((value) => value + 1);
        return { ok: true };
      };
      const transferToSignUp = async (): Promise<AuthResult> => {
        const transferRequest = await runCurrentAuthRequest(flow, token, () => signUp.create({ transfer: true }));
        if (transferRequest.kind === "stale") return { ok: false, error: "This request is no longer current." };
        if (transferRequest.kind === "error") return recoverVerification(readableProviderError(transferRequest.error));
        const transfer = transferRequest.value;
        if (transfer.error) return recoverVerification(readableProviderError(transfer.error));
        if (signUp.status !== "complete") {
          flow.current = { ...flow.current, kind: "signUp" };
          return recoverVerification("Your email is verified. Complete the remaining account details to continue.");
        }
        flow.current = { ...flow.current, kind: "signUp" };
        return finalizeVerified(signUp);
      };
      const resultRequest = await runCurrentAuthRequest(flow, token, () => flow.current.kind === "signUp"
        ? signUp.verifications.verifyEmailCode({ code })
        : signIn.emailCode.verifyCode({ code }));
      if (resultRequest.kind === "stale") return { ok: false, error: "This request is no longer current." };
      if (resultRequest.kind === "error") {
        if (flow.current.kind === "signIn" && isSignUpIfMissingTransfer(resultRequest.error)) return transferToSignUp();
        return recoverVerification(readableProviderError(resultRequest.error));
      }
      const result = resultRequest.value;
      if (result.error) {
        if (flow.current.kind === "signIn" && isSignUpIfMissingTransfer(result.error)) return transferToSignUp();
        return recoverVerification(readableProviderError(result.error));
      }
      return finalizeVerified(flow.current.kind === "signUp" ? signUp : signIn);
    } catch (error) {
      if (isCurrentAuthFlow(flow.current, token)) {
        flow.current = transitionAuthFlow(flow.current, token, "ready");
        setVerificationPhase("ready");
      }
      return { ok: false, error: readableProviderError(error) };
    }
  }, [pendingEmail, pendingNext, signIn, signUp]);

  const continueAsGuest = useCallback(() => {
    flow.current = cancelAuthFlow(flow.current);
    request.current = flow.current.generation;
    setVerificationReady(false);
    setVerificationPhase("idle");
    storageSet(() => window.localStorage, GUEST_KEY, "1");
    setGuest(true);
  }, []);

  const cancelVerification = useCallback(() => {
    flow.current = cancelAuthFlow(flow.current);
    request.current = flow.current.generation;
    finalizingGeneration.current = null;
    setVerificationReady(false);
    setVerificationPhase("idle");
  }, []);

  const retryProvisioning = useCallback(() => {
    if (!identity) return;
    provisionedFor.current = null;
    provisionErrorIdentity.current = null;
    setProfileWatchFailed(false);
    setProvisionError(null);
    setProvisionRetry((value) => value + 1);
  }, [identity]);

  const signOut = useCallback(async () => {
    setPrivateSuspended(true);
    cancelVerification();
    writePending(null);
    setPendingEmail(null);
    setPendingNext("/home");
    setVerificationReady(false);
    setGuest(false);
    storageRemove(() => window.localStorage, GUEST_KEY);
    try {
      await clerk.signOut();
      // Suspension above can also represent expiry, cleanup, or a failed
      // exit. Only a resolved provider sign-out is an authoritative logout.
      const markerPersisted = markConfirmedAnalyticsLogout();
      // If quota or browser policy rejected the durable marker, revoke the
      // accepted local grant synchronously. Declined choices remain intact.
      if (!markerPersisted) revokeAcceptedLocalAnalyticsPreference();
    }
    catch (error) { setPrivateSuspended(false); throw error; }
  }, [cancelVerification, clerk]);

  const member = Boolean(
    clerk.isLoaded &&
      clerk.isSignedIn &&
      clerk.userId &&
      user?.id === clerk.userId &&
      identity &&
      convexAuth.isAuthenticated &&
      !convexAuth.isRefreshing &&
      !privateSuspended &&
      profileIdentity === identity &&
      profile?.status === "active",
  );
  useEffect(() => {
    if (!member || !clerk.sessionId || !consumeAuthCompletionMarker(clerk.sessionId)) return;
    setAuthCompletionSessionId(clerk.sessionId);
    setAuthCompletionEpoch((value) => value + 1);
  }, [clerk.sessionId, member]);
  // Clerk, its user resource and Convex settle independently after a reload.
  // Keep the requested route while the signed-in identity is being bound;
  // an intermediate anonymous render is not a completed sign-out decision.
  const currentProvisionError = provisionErrorIdentity.current === identity ? provisionError : null;
  const memberBindingPending = Boolean(clerk.isSignedIn) && !member && !currentProvisionError;
  const loading = !clerk.isLoaded || convexAuth.isLoading || convexAuth.isRefreshing || memberBindingPending || provisioning;
  const privateSession = usePrivateSession({
    subject: clerk.userId ?? null,
    sessionId: clerk.sessionId ?? null,
    authEpoch,
    identityLoaded: clerk.isLoaded,
    sessionActive: Boolean(clerk.isSignedIn),
    loadedUserId: user?.id ?? null,
    verifiedProfileId: member ? profile?._id ?? null : null,
    profileRejected: profileWatchFailed || Boolean(profileIdentity === identity && profile !== undefined && (!profile || profile.status !== "active")),
    suspended: privateSuspended,
    // Match ConvexProviderWithClerk's installed integration/template choice.
    getToken: () => clerk.getToken(clerk.sessionClaims?.aud === "convex" ? {} : { template: "convex" }),
  });
  useEffect(() => {
    const subscription = subscribeToPrivateBrowserClearSignal(() => {
      // Browser cleanup is local coordination only. It revokes the current
      // runtime grant and leaves Clerk/server authority untouched.
      browserClearSuspended.current = true;
      browserClearIdentity.current = currentIdentity.current;
      setPrivateSuspended(true);
    });
    return () => subscription.stop();
  }, []);
  useEffect(() => {
    const access = privateSession;
    if (!access) return undefined;
    let alive = true;
    const subscription = subscribeToAccountDeletionSignal({
      access,
      onRevoke: () => {
        // The signal is local coordination only. Existing auth/session
        // invalidation performs the actual private-store teardown.
        if (alive && access.isCurrent()) setPrivateSuspended(true);
      },
    });
    return () => {
      alive = false;
      subscription.stop();
    };
  }, [privateSession]);
  const usableMember = member || privateSession !== null;
  // Restore this tab's pending email/return before any page decides to redirect.
  const ready = tab !== "server" && (privateSession !== null || !loading);
  const value = useMemo<AuthValue>(() => ({
    // A verified session whose profile cannot be used gets the safe guest
    // surface, so the user can retry without a redirect loop. This does not
    // grant member access: all private checks still require `member`.
    viewer: usableMember ? "member" : guest || Boolean(currentProvisionError) ? "guest" : "anonymous",
    account: usableMember && user ? { id: user.id, email: user.primaryEmailAddress?.emailAddress ?? null, phone: user.primaryPhoneNumber?.phoneNumber ?? null } : null,
    ready,
    guestIntent: guest,
    configured: true,
    gating: "enforced",
    demoMode: false,
    pendingEmail,
    pendingNext,
    verificationReady,
    verificationPhase,
    accountKey: member ? profile?._id ?? null : privateSession?.identity.profileId ?? null,
    authEpoch,
    authCompletionEpoch,
    authCompletionSessionId,
    privateSession,
    initiatingTabId: tab,
    unavailableReason: currentProvisionError,
    retryProvisioning,
    sendCode,
    verifyCode,
    continueAsGuest,
    signOut,
    cancelVerification,
  }), [member, usableMember, privateSession, user, profile?._id, ready, guest, pendingEmail, pendingNext, verificationReady, verificationPhase, authEpoch, authCompletionEpoch, authCompletionSessionId, tab, currentProvisionError, retryProvisioning, sendCode, verifyCode, continueAsGuest, signOut, cancelVerification]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const convexClient = authProviderConfigured && AUTH_CONFIG.convexUrl
  ? new ConvexReactClient(AUTH_CONFIG.convexUrl)
  : null;

/** Keeps provider ordering explicit: Clerk, then Convex, then app auth state. */
export function AuthShell({ children, serverConfigured = true }: { children: ReactNode; serverConfigured?: boolean }) {
  if (!serverConfigured || !authProviderConfigured || !convexClient || !AUTH_CONFIG.clerkPublishableKey) {
    return <UnconfiguredAuthProvider>{children}</UnconfiguredAuthProvider>;
  }
  return (
    <ClerkProvider publishableKey={AUTH_CONFIG.clerkPublishableKey} signInUrl="/signin">
      <ConvexProviderWithClerk client={convexClient} useAuth={useClerkAuth}>
        <ConfiguredAuthProvider>{children}</ConfiguredAuthProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

export function AuthProvider({ children, serverConfigured = true }: { children: ReactNode; serverConfigured?: boolean }) {
  return <AuthShell serverConfigured={serverConfigured}>{children}</AuthShell>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
