import type { FeedbackContext } from "../feedback/context";

/**
 * Maps one visible feedback context to one analytics-only result token for a
 * single consent lifetime. The context ID is used only as an in-memory key;
 * callers must send the returned opaque token instead.
 */
export interface FeedbackAnalyticsResultMapping {
  readonly contextKey: string;
  readonly consentEpoch: number;
  readonly resultId: string;
}

export function feedbackAnalyticsContextKey(context: FeedbackContext): string {
  return `${context.feature}:${context.contextId}:${context.contextVersion}`;
}

export function reuseFeedbackAnalyticsResultId(
  previous: FeedbackAnalyticsResultMapping | null,
  context: FeedbackContext,
  consentEpoch: number,
  createId: () => string,
): FeedbackAnalyticsResultMapping {
  const contextKey = feedbackAnalyticsContextKey(context);
  if (previous?.contextKey === contextKey && previous.consentEpoch === consentEpoch) return previous;
  return Object.freeze({ contextKey, consentEpoch, resultId: createId() });
}
