"use client";

import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { redirectFor } from "@/lib/auth/access";
import { useAuth } from "@/lib/auth/provider";

/**
 * Keeps people out of screens their standing does not reach.
 *
 * This is a client guard on a client-rendered app, so it is a routing
 * convenience rather than a security boundary — the real boundary is the
 * ownership check in each Convex function. Anything the
 * guard protects that the database does not is protected by nothing.
 */
const OPEN_PATHS = ["/", "/signin", "/verify"];

export function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { viewer, ready, gating, privateSession, guestIntent } = useAuth();
  const grant = useRef({ value: privateSession, generation: 0 });
  if (grant.current.value !== privateSession) {
    grant.current = { value: privateSession, generation: grant.current.generation + 1 };
  }

  const open = OPEN_PATHS.includes(pathname);
  // An explicit guest action may open only the public comparison flow while
  // Clerk/Convex is still settling. It never opens home, account or any
  // private feature, and an acquired private grant ends this exception.
  const guestCompare = Boolean(
    guestIntent && !privateSession &&
      (pathname === "/compare" || pathname.startsWith("/compare/")),
  );
  const routeReady = ready || guestCompare;
  const effectiveViewer = guestCompare ? "guest" : viewer;
  const target = routeReady && !open ? redirectFor(effectiveViewer, pathname, gating) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  // Hold the paint rather than flashing a screen that is about to be replaced.
  if (!open && (!routeReady || target)) {
    return (
      <div className="mx-auto w-full max-w-[560px] px-4 pt-20">
        <p role="status" className="mb-4 text-sm leading-relaxed text-ink-2">Verifying your account. A connection is needed to open private pages.</p>
        <div className="h-40 animate-pulse rounded-2xl border border-line bg-surface-2" />
      </div>
    );
  }

  // Drafts in page components must not survive a private session change.
  const identity = privateSession?.identity;
  const scope = open ? "public-auth" : identity
    ? JSON.stringify([identity.profileId, identity.sessionId, identity.authEpoch, grant.current.generation])
    : effectiveViewer;
  return <Fragment key={scope}>{children}</Fragment>;
}
