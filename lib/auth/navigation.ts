/**
 * The provider owns post-verification navigation. Keeping the browser side
 * effect behind this tiny seam makes the callback testable without replacing
 * jsdom's Location implementation.
 */
export function navigateToAuthDestination(url: string): void {
  if (typeof window !== "undefined") window.location.assign(url);
}
