"use client";

import { useMemo } from "react";
import { useAuth } from "@/lib/auth/provider";
import { comparisonFeedbackContext } from "@/lib/feedback/context";
import { createSessionBoundFeedbackTransport } from "@/lib/feedback/transport";
import { FeedbackPrompt } from "./FeedbackPrompt";

/** Result identity stays stable through saving/reopening; the server owns deduplication. */
export function MemberComparisonFeedback({ resultId, routeName = "comparison_detail" }: { resultId: string; routeName?: "compare_results" | "comparison_detail" }) {
  const { privateSession } = useAuth();
  const binding = useMemo(() => {
    if (!privateSession?.isCurrent()) return null;
    try {
      return {
        context: comparisonFeedbackContext(resultId),
        transport: createSessionBoundFeedbackTransport({ session: privateSession }),
      };
    } catch { return null; }
  }, [privateSession, resultId]);

  if (!privateSession?.isCurrent() || !binding) return null;
  const { profileId, sessionId, authEpoch } = privateSession.identity;
  return <FeedbackPrompt
    key={`${profileId}:${sessionId}:${authEpoch}:${resultId}`}
    context={binding.context}
    transport={binding.transport}
    routeName={routeName}
    className="rounded-2xl border border-line bg-surface px-4 py-4"
  />;
}
