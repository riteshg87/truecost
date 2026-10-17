"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { LandingPage } from "@/components/landing/LandingPage";
import { useAuth } from "@/lib/auth/provider";

/**
 * The door.
 *
 * Anyone who already has a standing — signed in, or a guest who chose to look
 * around — goes straight past it. Making people re-announce themselves on every
 * launch is the fastest way to make an app feel like paperwork.
 */
export default function Welcome() {
  const router = useRouter();
  const { viewer, ready, continueAsGuest } = useAuth();
  const enteringComparison = useRef(false);

  useEffect(() => {
    if (ready && viewer !== "anonymous" && !enteringComparison.current) router.replace("/home");
  }, [ready, viewer, router]);

  return <LandingPage onCompare={() => {
    if (viewer === "member") {
      router.replace("/home");
      return;
    }
    enteringComparison.current = true;
    continueAsGuest();
    router.push("/compare");
  }} />;
}
