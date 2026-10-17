import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { readPublicKey } from "@/lib/auth/config";
import { serverClerkConfigured } from "@/lib/auth/server-config";

// Clerk's request context is available to server routes when the public key is
// configured. Client RouteGuard remains the product routing convenience; the
// Convex functions are the data boundary.
const hasClerkKey = Boolean(readPublicKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && serverClerkConfigured);

export default hasClerkKey
  ? clerkMiddleware()
  : () => NextResponse.next();

export const config = {
  matcher: [
    "/((?!_next|.*\\..*).*)",
    "/(api|trpc)(.*)",
  ],
};
