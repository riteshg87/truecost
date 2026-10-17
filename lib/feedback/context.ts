import { randomUuid, uuidValue } from "../contracts/errors";
import type { FeedbackFeature } from "../contracts/feedback";

/** The first feedback contract version. Keep this separate from calculation versions. */
export const FEEDBACK_CONTEXT_VERSION = "v1" as const;
export type FeedbackContextVersion = typeof FEEDBACK_CONTEXT_VERSION;

export interface FeedbackContext {
  readonly feature: FeedbackFeature;
  readonly contextId: string;
  readonly contextVersion: FeedbackContextVersion;
}

function context(feature: FeedbackFeature, id: unknown, label: string): FeedbackContext {
  return Object.freeze({
    feature,
    contextId: uuidValue(id, label),
    contextVersion: FEEDBACK_CONTEXT_VERSION,
  });
}

/** A comparison result UUID is the durable identity of its feedback prompt. */
export function comparisonFeedbackContext(resultId: string): FeedbackContext {
  return context("comparison", resultId, "comparison resultId");
}

/**
 * Loan health owns the suggestion identity. It must be opaque and UUID-shaped;
 * the caller should issue a new value when the suggestion changes.
 */
export function loanHealthFeedbackContext(suggestionId: string): FeedbackContext {
  return context("loan_health", suggestionId, "loan health suggestionId");
}

export function createLoanHealthFeedbackContext(): FeedbackContext {
  return loanHealthFeedbackContext(randomUuid());
}

/** Stable metadata slots used by Loan Health continuity. They contain IDs only. */
export function loanHealthContextSlot(kind: "revision" | "draft" | "pending", value: number | string): string {
  const suffix = typeof value === "number" ? String(value) : value;
  if (!/^\d+$/.test(suffix) && kind === "revision") throw new TypeError("Loan revision is invalid");
  if (!/^[A-Za-z0-9._~-]{1,160}$/.test(suffix)) throw new TypeError("Loan context identity is invalid");
  return `loan-health-${kind}-${suffix}`;
}

const STORAGE_PREFIX = "truecost.feedback.context.v1";
const SAFE_STORAGE_PART = /^[A-Za-z0-9._~-]{1,160}$/;

function storageKey(accountKey: string, slot: string): string {
  if (!SAFE_STORAGE_PART.test(accountKey) || !SAFE_STORAGE_PART.test(slot)) {
    throw new TypeError("Feedback context storage key is invalid");
  }
  return `${STORAGE_PREFIX}.${accountKey}.${slot}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Retains only context metadata in this tab across an ordinary reload. The
 * account key should be an opaque profile ID, and slot should identify the
 * feature surface. No result, loan, answer, or comment is written.
 */
export function rememberFeedbackContext(accountKey: string, slot: string, value: FeedbackContext): void {
  const stable = context(value.feature, value.contextId, "feedback contextId");
  const target = storage();
  if (!target) return;
  try {
    target.setItem(storageKey(accountKey, slot), JSON.stringify(stable));
  } catch {
    // Private browsing and quota failures do not affect the in-memory prompt.
  }
}

export function readRememberedFeedbackContext(accountKey: string, slot: string): FeedbackContext | null {
  const target = storage();
  if (!target) return null;
  try {
    const raw = target.getItem(storageKey(accountKey, slot));
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.contextVersion !== FEEDBACK_CONTEXT_VERSION) return null;
    if (value.feature !== "comparison" && value.feature !== "loan_health") return null;
    return context(value.feature, value.contextId, "remembered feedback contextId");
  } catch {
    return null;
  }
}

/** Clear one account-scoped context when sign-out or account switch is confirmed. */
export function forgetRememberedFeedbackContext(accountKey: string, slot: string): void {
  const target = storage();
  if (!target) return;
  try { target.removeItem(storageKey(accountKey, slot)); } catch { /* best effort */ }
}

/** Remove only this account's opaque prompt metadata after confirmed replacement/sign-out. */
export function forgetRememberedFeedbackContexts(accountKey: string): void {
  const target = storage();
  if (!target || !SAFE_STORAGE_PART.test(accountKey)) return;
  const prefix = `${STORAGE_PREFIX}.${accountKey}.`;
  try {
    for (let index = target.length - 1; index >= 0; index -= 1) {
      const key = target.key(index);
      if (key?.startsWith(prefix)) target.removeItem(key);
    }
  } catch {
    // Storage access can be denied in private browsing; metadata is advisory.
  }
}

/** Remove only feedback context metadata; guest results and preferences use other keys. */
export function clearRememberedFeedbackContexts(): boolean {
  const target = storage();
  if (!target) return typeof window === "undefined";
  try {
    for (let index = target.length - 1; index >= 0; index -= 1) {
      const key = target.key(index);
      if (key?.startsWith(`${STORAGE_PREFIX}.`)) target.removeItem(key);
    }
    return true;
  } catch { return false; }
}
