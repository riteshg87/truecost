/**
 * Who may open what.
 *
 * Kept as plain data and pure functions, deliberately away from React and away
 * from a provider. An access rule that can only be exercised by clicking through
 * a signed-in browser is a rule nobody tests, and this is the one part of the
 * app where being wrong is a privacy incident rather than a wrong number.
 */

export type Audience = "anyone" | "guest" | "member";

/** What the viewer currently is. Guest is a real state, not a missing one. */
export type Viewer = "anonymous" | "guest" | "member";

export interface FeatureDef {
  id: FeatureId;
  href: string;
  /** Short enough for a phone. The long version lives in the flow itself. */
  name: string;
  tagline: string;
  /** The lowest standing that may open it. */
  requires: Audience;
  available: boolean;
}

export type FeatureId = "compare" | "loan" | "insurance";

export const FEATURES: FeatureDef[] = [
  {
    id: "compare",
    href: "/compare",
    name: "Compare Loan Offers",
    tagline: "Rank home loan offers on what they really cost",
    requires: "anyone",
    available: true,
  },
  {
    id: "loan",
    href: "/loan",
    name: "Loan Health Monitor",
    // Sign-in is what lets the record follow you, so the reason is the label.
    tagline: "Track your rate, prepay, or move lender",
    requires: "member",
    available: true,
  },
  {
    id: "insurance",
    href: "/insurance",
    name: "Understand Your Policy",
    tagline: "Check what you hold is enough",
    requires: "member",
    available: false,
  },
];

export function featureById(id: FeatureId): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id);
}

/**
 * Kept as a compatibility parameter while provider configuration is rolled
 * out. Private routes stay closed in every mode; comparison is deliberately
 * available to a chosen guest.
 */
export type Gating = "enforced" | "open";

/** Does this viewer clear the bar a feature sets? */
export function canOpen(
  viewer: Viewer,
  feature: FeatureDef,
  gating: Gating = "enforced",
): boolean {
  void gating;
  if (!feature.available) return false;
  if (viewer === "anonymous") return false;
  if (feature.requires === "anyone" || feature.requires === "guest") return true;
  return viewer === "member";
}

/** Why a feature is shut, in the words shown on the card. */
export function lockReason(
  viewer: Viewer,
  feature: FeatureDef,
  gating: Gating = "enforced",
): string | null {
  if (!feature.available) return "Coming soon";
  if (canOpen(viewer, feature, gating)) return null;
  return "Sign in to use";
}

/** Routes a guest may reach. Everything else needs an account. */
const GUEST_ROUTES = ["/home", "/compare", "/account"];
const SAFE_NEXT_ROUTES = ["/", "/home", "/compare", "/comparisons", "/loan", "/prepay", "/account"];

/**
 * Whether a path is open to the viewer.
 *
 * Prefix matching, so /compare/results follows /compare without being listed
 * twice and drifting out of step with it.
 */
export function canVisit(
  viewer: Viewer,
  pathname: string,
  gating: Gating = "enforced",
): boolean {
  void gating;
  if (viewer === "anonymous") return false;
  if (viewer === "member") return true;
  return GUEST_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/** Where to send someone who cannot be where they are. */
export function redirectFor(
  viewer: Viewer,
  pathname: string,
  gating: Gating = "enforced",
): string | null {
  if (canVisit(viewer, pathname, gating)) return null;
  if (viewer === "anonymous") return "/";
  return `/signin?next=${encodeURIComponent(pathname)}`;
}

/** Guard a "next" parameter so a crafted link cannot bounce someone off-site. */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 512) return "/home";
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return "/home";
  if (!next.startsWith("/") || next.startsWith("//")) return "/home";

  // Decode once to catch encoded slashes, backslashes, and nested redirects.
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return "/home";
  }
  if (decoded !== next || /[\u0000-\u001f\u007f\\]/.test(decoded)) return "/home";

  try {
    const url = new URL(next, "https://truecost.invalid");
    if (url.origin !== "https://truecost.invalid") return "/home";
    if (url.pathname === "/signin" || url.pathname === "/verify") return "/home";
    if (!SAFE_NEXT_ROUTES.some((route) => url.pathname === route || (route !== "/" && url.pathname.startsWith(`${route}/`)))) return "/home";
    const allowed = new Set([
      "action",
      "requestId",
    ]);
    for (const [key, value] of url.searchParams) {
      if (!allowed.has(key) || !value || value.length > 128 || /[\u0000-\u001f\u007f\\]/.test(value)) {
        return "/home";
      }
      if (key === "action" && ![
        "save",
        "download",
        "new_comparison",
        "recalculate_existing_draft",
      ].includes(value)) return "/home";
      if (key === "requestId" && !/^[A-Za-z0-9_-]{12,128}$/.test(value)) return "/home";
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return "/home";
  }
}
