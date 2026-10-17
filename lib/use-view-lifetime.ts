"use client";

import { useCallback, useEffect, useRef } from "react";

/** Async page actions must not navigate after their page has gone away. */
export function useViewLifetime(): () => boolean {
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return useCallback(() => live.current, []);
}
