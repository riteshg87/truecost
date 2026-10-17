"use client";

import { useEffect, useRef, useState } from "react";
import type { PrivateSessionAccess } from "./private-session";
import { getPrivateBrowserClearRevision, subscribeToPrivateBrowserClearSignal } from "../privacy/private-browser-clear-signal";

interface PrivateSessionObservation {
  subject: string | null;
  sessionId: string | null;
  authEpoch: number;
  identityLoaded: boolean;
  sessionActive: boolean;
  loadedUserId: string | null;
  /** Present only after Convex has authenticated and returned an active profile. */
  verifiedProfileId: string | null;
  /** An explicit rejected/inactive profile invalidates even an offline grant. */
  profileRejected: boolean;
  suspended: boolean;
  getToken: () => Promise<string | null>;
}

/** A live tab may retain its verified account offline. Nothing restores this grant from disk. */
export function usePrivateSession(observation: PrivateSessionObservation): PrivateSessionAccess | null {
  const [online, setOnline] = useState(false);
  const [privateClearRevision, setPrivateClearRevision] = useState(() => getPrivateBrowserClearRevision());
  const [access, setAccess] = useState<PrivateSessionAccess | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const previousKey = useRef<string | null>(null);
  const lastNonNullKey = useRef<string | null>(null);
  const hasSeenVerifiedLifetime = useRef(false);
  const browserClearSuspended = useRef(false);
  const key = observation.identityLoaded && observation.sessionActive && observation.subject && observation.sessionId &&
    observation.loadedUserId === observation.subject
    ? `${observation.subject}:${observation.sessionId}:${observation.authEpoch}` : null;

  // Invalidate synchronously during an identity render, before passive effects
  // can expose the new account with a previous account's cached fields.
  if (previousKey.current !== key) {
    const isNewVerifiedLifetime = key !== null && lastNonNullKey.current !== null && lastNonNullKey.current !== key;
    previousKey.current = key;
    generation.current += 1;
    // A new explicitly verified identity lifetime may establish a new grant.
    // Reloads start with revision zero; the old lifetime never self-restores.
    if (isNewVerifiedLifetime) browserClearSuspended.current = false;
    if (key !== null) lastNonNullKey.current = key;
  }
  if (key !== null) hasSeenVerifiedLifetime.current = true;
  const latestPrivateClearRevision = getPrivateBrowserClearRevision();
  if (latestPrivateClearRevision !== privateClearRevision) browserClearSuspended.current = true;
  const rejected = observation.profileRejected || observation.suspended || Boolean(
    access && observation.verifiedProfileId && observation.verifiedProfileId !== access.identity.profileId,
  ) || browserClearSuspended.current;
  const rejectionSeen = useRef(false);
  if (rejected && !rejectionSeen.current) generation.current += 1;
  rejectionSeen.current = rejected;
  const current = useRef({ observation, key, online, rejected, privateClearRevision });
  current.current = { observation, key, online, rejected, privateClearRevision };

  useEffect(() => {
    mounted.current = true;
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      mounted.current = false;
      generation.current += 1;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const subscription = subscribeToPrivateBrowserClearSignal(() => {
      // A signal received while a verified lifetime exists revokes it. A tab
      // that was signed out before the signal may establish its first fresh
      // verified lifetime afterward.
      if (hasSeenVerifiedLifetime.current || current.current.key !== null) browserClearSuspended.current = true;
      generation.current += 1;
      setPrivateClearRevision(getPrivateBrowserClearRevision());
    });
    return () => subscription.stop();
  }, []);

  useEffect(() => {
    if (!key || rejected) {
      setAccess(null);
      return;
    }
    if (!online || !observation.verifiedProfileId) return;
    if (access?.isCurrent()) return;
    const capturedGeneration = generation.current;
    const identity = Object.freeze({
      profileId: observation.verifiedProfileId,
      subject: observation.subject!,
      sessionId: observation.sessionId!,
      authEpoch: observation.authEpoch,
      verifiedOnline: true as const,
    });
    const isCurrent = () => {
      const latest = current.current;
      return mounted.current && generation.current === capturedGeneration && latest.key === key && !latest.rejected &&
        !browserClearSuspended.current && getPrivateBrowserClearRevision() === privateClearRevision &&
        (latest.online ? latest.observation.verifiedProfileId === identity.profileId :
          latest.observation.verifiedProfileId === null || latest.observation.verifiedProfileId === identity.profileId);
    };
    setAccess(Object.freeze({
      identity,
      isCurrent,
      getToken: async () => {
        // An earlier online listener can start the outbox before React renders
        // this hook's network update. Consult the live browser flag here so a
        // reconnect is not mistaken for missing authentication.
        if (!isCurrent() || !navigator.onLine) return null;
        try {
          const token = await current.current.observation.getToken();
          return isCurrent() && navigator.onLine ? token : null;
        } catch { return null; }
      },
    }));
  }, [key, rejected, online, privateClearRevision, observation.verifiedProfileId, observation.subject, observation.sessionId, observation.authEpoch, access]);

  return access?.isCurrent() ? access : null;
}
