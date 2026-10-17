"use client";

import { useEffect, useRef, useState } from "react";
import { randomUuid } from "../lib/contracts/errors";
import type { FeedbackContext } from "../lib/feedback/context";
import {
  FeedbackTransportError,
  type FeedbackSubmission,
  type FeedbackTransport,
} from "../lib/feedback/transport";
import { useOptionalAnalytics } from "../lib/analytics/provider";
import { ANALYTICS_CONFIG } from "../lib/analytics/config";
import { reuseFeedbackAnalyticsResultId, type FeedbackAnalyticsResultMapping } from "../lib/analytics/feedback";

export interface FeedbackPromptProps {
  readonly context: FeedbackContext;
  readonly transport: FeedbackTransport;
  /** The concrete member route where this prompt is mounted. */
  readonly routeName?: "compare_results" | "comparison_detail" | "loan";
  readonly className?: string;
}

type Answer = FeedbackSubmission["answer"];
type ViewState = "checking" | "available" | "submitting" | "error" | "resolved";

function messageFor(error: unknown): string {
  if (!(error instanceof FeedbackTransportError)) return "We could not send that feedback. Try again when your connection is working.";
  switch (error.code) {
    case "unauthorized": return "Your session changed. Sign in again before sending feedback.";
    case "rate_limited": return "Feedback is temporarily limited. Try again later.";
    case "already_resolved": return "This feedback was already recorded.";
    case "request_reuse": return "This retry changed. Start a new feedback response.";
    case "invalid_shape":
    case "invalid_id": return "This feedback prompt is no longer available.";
    default: return "We could not send that feedback. Try again when your connection is working.";
  }
}

/**
 * A member-only prompt. It intentionally receives a session-bound transport;
 * route/provider code decides whether the member grant is currently valid.
 */
export function FeedbackPrompt({ context, transport, routeName, className }: FeedbackPromptProps) {
  const analytics = useOptionalAnalytics();
  const analyticsRef = useRef(analytics);
  analyticsRef.current = analytics;
  const [state, setState] = useState<ViewState>("checking");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [comment, setComment] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const operation = useRef(0);
  const submitRequestId = useRef<string | null>(null);
  const dismissRequestId = useRef<string | null>(null);
  const renderedIdentity = useRef<{ key: string; transport: FeedbackTransport; routeName?: FeedbackPromptProps["routeName"] } | null>(null);
  const feedbackAnalyticsMapping = useRef<FeedbackAnalyticsResultMapping | null>(null);
  const feedbackAnalyticsSent = useRef(false);
  const key = `${context.feature}:${context.contextId}:${context.contextVersion}`;
  // Render-time identity closes the gap before React runs the effect cleanup
  // for a changed account/context. An old acknowledgement must not publish
  // into the newly rendered prompt during that gap.
  const renderIdentity = useRef<{ key: string; transport: FeedbackTransport; routeName?: FeedbackPromptProps["routeName"] } | null>(null);
  renderIdentity.current = { key, transport, routeName };

  useEffect(() => {
    let active = true;
    const currentOperation = ++operation.current;
    setState("checking");
    setAnswer(null);
    setComment("");
    setErrorMessage(null);
    submitRequestId.current = null;
    dismissRequestId.current = null;
    feedbackAnalyticsMapping.current = null;
    feedbackAnalyticsSent.current = false;
    renderedIdentity.current = { key, transport, routeName };
    void transport.getStatus(context).then((result) => {
      if (!active || operation.current !== currentOperation) return;
      setState(result.status === "available" ? "available" : "resolved");
    }).catch((error: unknown) => {
      if (!active || operation.current !== currentOperation) return;
      setState("error");
      setErrorMessage(messageFor(error));
    });
    return () => {
      active = false;
      if (operation.current === currentOperation) operation.current += 1;
    };
  }, [key, routeName, transport]);

  if (renderedIdentity.current?.key !== key || renderedIdentity.current?.transport !== transport || renderedIdentity.current?.routeName !== routeName || state === "checking" || state === "resolved") return null;

  const retryOrSubmit = async () => {
    if (!answer || state === "submitting") return;
    const id = submitRequestId.current ?? randomUuid();
    submitRequestId.current = id;
    setState("submitting");
    setErrorMessage(null);
    const currentOperation = operation.current;
    const analyticsAtSubmit = analyticsRef.current;
    const consentEpochAtSubmit = analyticsAtSubmit?.status === "accepted" ? analyticsAtSubmit.consentEpoch : null;
    const submissionIdentity = { key, transport, routeName };
    const isCurrentSubmission = () => operation.current === currentOperation &&
      renderIdentity.current?.key === submissionIdentity.key &&
      renderIdentity.current?.transport === submissionIdentity.transport &&
      renderIdentity.current?.routeName === submissionIdentity.routeName;
    try {
      const acknowledgement = await transport.submit({
        requestId: id,
        context,
        answer,
        comment: comment.length > 0 ? comment : null,
      });
      if (!isCurrentSubmission()) return;
      if ((acknowledgement.status === "submitted" || acknowledgement.status === "replayed") &&
        !feedbackAnalyticsSent.current && analyticsAtSubmit && consentEpochAtSubmit !== null) {
        const currentAnalytics = analyticsRef.current;
        if (currentAnalytics?.status === "accepted" && currentAnalytics.consentEpoch === consentEpochAtSubmit && ANALYTICS_CONFIG.environment) {
          // Analytics is an observer of the successful product operation. A
          // collector failure must never turn that operation into a feedback
          // error or prevent its terminal UI state.
          try {
            const tracked = currentAnalytics.track(({ eventId, newCorrelationId }) => {
              const mapping = reuseFeedbackAnalyticsResultId(
                feedbackAnalyticsMapping.current,
                context,
                consentEpochAtSubmit,
                newCorrelationId,
              );
              feedbackAnalyticsMapping.current = mapping;
              return { event: "feedback_submitted", properties: {
                event_version: 1,
                environment: ANALYTICS_CONFIG.environment,
                release: "0.1.0",
                auth_state: "member",
                feature: context.feature,
                route_name: routeName ?? (context.feature === "comparison" ? "comparison_detail" : "loan"),
                event_id: eventId,
                occurred_at: new Date().toISOString(),
                result_id: mapping.resultId,
                answer,
                context_version: context.contextVersion,
              } };
            });
            if (tracked.ok) feedbackAnalyticsSent.current = true;
          } catch {
            // The feedback acknowledgement already succeeded. Leave the
            // analytics failure invisible to the product operation.
          }
        }
      }
      setState("resolved");
    } catch (error: unknown) {
      if (!isCurrentSubmission()) return;
      if (error instanceof FeedbackTransportError && error.code === "already_resolved") {
        setState("resolved");
        return;
      }
      setState("error");
      setErrorMessage(messageFor(error));
    }
  };

  const dismiss = async () => {
    if (state === "submitting") return;
    const id = dismissRequestId.current ?? randomUuid();
    dismissRequestId.current = id;
    setState("submitting");
    setErrorMessage(null);
    const currentOperation = operation.current;
    try {
      await transport.dismiss(context, id);
      if (operation.current !== currentOperation) return;
      setState("resolved");
    } catch (error: unknown) {
      if (operation.current !== currentOperation) return;
      if (error instanceof FeedbackTransportError && error.code === "already_resolved") {
        setState("resolved");
        return;
      }
      setState("error");
      setErrorMessage(messageFor(error));
    }
  };

  const resetRequest = () => { submitRequestId.current = null; };
  const actionClass = "min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-surface-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
  const choiceClass = "min-h-11 rounded-lg border px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
  return (
    <section className={`my-4 rounded-xl bg-surface-2 p-4 text-sm leading-relaxed text-ink-2 ${className ?? ""}`} aria-label="Feedback" data-feedback-context={context.contextId}>
      <p className="font-semibold text-ink">Was this useful?</p>
      <div role="group" aria-label="Feedback answer" className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${choiceClass} ${answer === "yes" ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface-2 text-ink"}`} disabled={state === "submitting"} aria-pressed={answer === "yes"} onClick={() => { setAnswer("yes"); resetRequest(); }}>Yes</button>
        <button type="button" className={`${choiceClass} ${answer === "no" ? "border-accent bg-accent-soft text-ink" : "border-line bg-surface-2 text-ink"}`} disabled={state === "submitting"} aria-pressed={answer === "no"} onClick={() => { setAnswer("no"); resetRequest(); }}>No</button>
      </div>
      <label className="mt-3 block font-medium text-ink">
        Optional comment
        <textarea
          className="mt-1 block min-h-11 w-full rounded-lg border border-line bg-surface p-2 font-normal text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          value={comment}
          maxLength={1000}
          disabled={state === "submitting"}
          onChange={(event) => { setComment(event.target.value); resetRequest(); }}
          placeholder="Tell us what would help."
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="min-h-11 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50" disabled={!answer || state === "submitting"} onClick={() => void retryOrSubmit()}>
          {state === "error" ? "Try again" : "Send feedback"}
        </button>
        <button type="button" className={actionClass} disabled={state === "submitting"} onClick={() => void dismiss()}>Dismiss</button>
      </div>
      {errorMessage ? <p className="mt-2 text-danger" role="alert">{errorMessage}</p> : null}
    </section>
  );
}
