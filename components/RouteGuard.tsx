"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { redirectFor } from "@/lib/auth/access";
import { useAuth } from "@/lib/auth/provider";

/**
 * Keeps people out of screens their standing does not reach.
 *
 * This is a client guard on a client-rendered app, so it is a routing
 * convenience rather than a security boundary — the real boundary is the
 * row-level policy on the database, which is where it belongs. Anything the
 * guard protects that the database does not is protected by nothing.
 */
const OPEN_PATHS = ["/", "/signin", "/verify"];

export function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { viewer, ready, gating } = useAuth();

  const open = OPEN_PATHS.includes(pathname);
  const target = ready && !open ? redirectFor(viewer, pathname, gating) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  // Hold the paint rather than flashing a screen that is about to be replaced.
  if (!open && (!ready || target)) {
    return (
      <div className="mx-auto w-full max-w-[560px] px-4 pt-20">
        <div className="h-40 animate-pulse rounded-2xl border border-line bg-surface-2" />
      </div>
    );
  }

  return <>{children}</>;
}
