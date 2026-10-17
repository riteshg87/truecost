import {
  contractFail,
  exactKeys,
  recordOf,
  stringValue,
  uuidValue,
} from "./errors";

export const FEEDBACK_FEATURES = ["comparison", "loan_health"] as const;
export type FeedbackFeature = (typeof FEEDBACK_FEATURES)[number];
export type FeedbackAnswer = "yes" | "no";

export const FEEDBACK_MAX_COMMENT_LENGTH = 1_000;
export const FEEDBACK_MAX_CONTEXT_VERSION_LENGTH = 32;

const FEEDBACK_KEYS = [
  "requestId",
  "feature",
  "contextId",
  "contextVersion",
  "answer",
  "comment",
] as const;

export interface FeedbackInput {
  requestId: string;
  feature: FeedbackFeature;
  contextId: string;
  contextVersion: string;
  answer: FeedbackAnswer;
  comment: string | null;
}

function enumValue<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    contractFail("invalid_enum", `${label} is not supported`);
  }
  return value as T;
}

export function parseFeedbackInput(value: unknown): FeedbackInput {
  const record = recordOf(value, "feedback");
  exactKeys(record, FEEDBACK_KEYS, "feedback");
  const commentValue = record.comment;
  if (commentValue !== undefined && commentValue !== null && typeof commentValue !== "string") {
    contractFail("invalid_shape", "feedback.comment must be a string");
  }
  if (typeof commentValue === "string" && commentValue.length > FEEDBACK_MAX_COMMENT_LENGTH) {
    contractFail("invalid_shape", "feedback.comment is too long");
  }
  return {
    requestId: uuidValue(record.requestId, "feedback.requestId"),
    feature: enumValue(record.feature, "feedback.feature", FEEDBACK_FEATURES),
    contextId: uuidValue(record.contextId, "feedback.contextId"),
    contextVersion: stringValue(
      record.contextVersion,
      "feedback.contextVersion",
      FEEDBACK_MAX_CONTEXT_VERSION_LENGTH,
    ),
    answer: enumValue(record.answer, "feedback.answer", ["yes", "no"]),
    comment: commentValue === undefined || commentValue === null ? null : commentValue,
  };
}

export function canonicalFeedbackPayload(input: FeedbackInput): string {
  return JSON.stringify([
    input.feature,
    input.contextId,
    input.contextVersion,
    input.answer,
    input.comment,
  ]);
}

export function parseFeedbackDismissal(value: unknown): Omit<FeedbackInput, "answer" | "comment"> {
  const record = recordOf(value, "feedbackDismissal");
  exactKeys(record, ["requestId", "feature", "contextId", "contextVersion"], "feedbackDismissal");
  return {
    requestId: uuidValue(record.requestId, "feedbackDismissal.requestId"),
    feature: enumValue(record.feature, "feedbackDismissal.feature", FEEDBACK_FEATURES),
    contextId: uuidValue(record.contextId, "feedbackDismissal.contextId"),
    contextVersion: stringValue(
      record.contextVersion,
      "feedbackDismissal.contextVersion",
      FEEDBACK_MAX_CONTEXT_VERSION_LENGTH,
    ),
  };
}

export function canonicalFeedbackDismissalPayload(
  input: Omit<FeedbackInput, "answer" | "comment">,
): string {
  return JSON.stringify(["dismiss", input.feature, input.contextId, input.contextVersion]);
}
