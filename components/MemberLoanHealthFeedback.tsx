"use client";

import { useMemo } from "react";
import { FeedbackPrompt } from "./FeedbackPrompt";
import { useAuth } from "../lib/auth/provider";
import { AUTH_CONFIG } from "../lib/auth/config";
import { loanHealthFeedbackContext } from "../lib/feedback/context";
import { createSessionBoundFeedbackTransport } from "../lib/feedback/transport";
import { useLoan } from "../lib/loanStore";

/** The member-only bridge for the current Loan Health suggestion. */
export function MemberLoanHealthFeedback() {
  const { privateSession, ready } = useAuth();
  const { loanHealthSuggestionId } = useLoan();
  const binding = useMemo(() => {
    if (!privateSession?.isCurrent() || !AUTH_CONFIG.convexUrl || !loanHealthSuggestionId) return null;
    try {
      return {
        context: loanHealthFeedbackContext(loanHealthSuggestionId),
        transport: createSessionBoundFeedbackTransport({ session: privateSession, url: AUTH_CONFIG.convexUrl }),
      };
    } catch { return null; }
  }, [privateSession, loanHealthSuggestionId]);
  if (!ready || !privateSession?.isCurrent() || !binding) return null;
  const { profileId, sessionId, authEpoch } = privateSession.identity;
  return <FeedbackPrompt
    key={`${profileId}:${sessionId}:${authEpoch}:${loanHealthSuggestionId}`}
    context={binding.context}
    transport={binding.transport}
    className="rounded-2xl border border-line bg-surface px-4 py-4"
  />;
}
