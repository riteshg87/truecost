"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComparisonSnapshot } from "../contracts/snapshot";
import type { PrivateSessionAccess } from "../auth/private-session";
import { useOptionalAnalytics } from "../analytics/provider";
import { ANALYTICS_CONFIG } from "../analytics/config";
import { renderComparisonReport } from "./render";

export type ComparisonReportSource = "current" | "saved";
export type ComparisonReportStatus = "idle" | "generating" | "ready" | "error" | "locked";

export interface ComparisonReportState {
  status: ComparisonReportStatus;
  url: string | null;
  error: string | null;
  generate: () => Promise<void>;
  allowDownload: () => boolean;
  allowPrint: () => boolean;
  canPrint: boolean;
}

function revoke(url: string | null): void {
  if (!url || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(url);
}

function grantKey(access: PrivateSessionAccess | null): string | null {
  if (!access) return null;
  const identity = access.identity;
  return [identity.profileId, identity.subject, identity.sessionId, identity.authEpoch].join("\u001f");
}

function reportRoute(source: ComparisonReportSource): "compare_results" | "comparison_detail" {
  return source === "saved" ? "comparison_detail" : "compare_results";
}

function reportErrorCode(cause: unknown): "network" | "auth_required" | "validation" | "limited" | "storage" | "unknown" {
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (/network|offline|fetch/.test(message)) return "network";
  if (/auth|grant|session|verify/.test(message)) return "auth_required";
  if (/valid|snapshot|input/.test(message)) return "validation";
  if (/quota|storage|object_url|blob/.test(message)) return "storage";
  if (/limit|unsupported/.test(message)) return "limited";
  return "unknown";
}

export function useComparisonReport(
  snapshot: Readonly<ComparisonSnapshot> | null,
  source: ComparisonReportSource,
  access: PrivateSessionAccess | null,
): ComparisonReportState {
  const analytics = useOptionalAnalytics();
  const key = snapshot ? JSON.stringify(snapshot) : null;
  const identityKey = grantKey(access);
  const scopeKey = key && identityKey ? `${key}\u0000${identityKey}` : null;
  const [status, setStatus] = useState<ComparisonReportStatus>("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorScopeKey, setErrorScopeKey] = useState<string | null>(null);
  const [urlKey, setUrlKey] = useState<string | null>(null);
  const runtime = useRef({ alive: true, lifecycle: 0, request: 0, scopeKey, url: null as string | null, analyticsScope: null as string | null, analyticsRequestId: null as string | null, analyticsRequestScope: null as string | null });
  runtime.current.scopeKey = scopeKey;
  runtime.current.analyticsScope = analytics?.status === "accepted" && identityKey ? `${identityKey}\u0000${analytics.consentEpoch}` : null;

  useEffect(() => {
    const lifecycle = ++runtime.current.lifecycle;
    ++runtime.current.request;
    runtime.current.alive = true;
    revoke(runtime.current.url);
    runtime.current.url = null;
    runtime.current.analyticsRequestId = null;
    runtime.current.analyticsRequestScope = null;
    setUrl(null);
    setUrlKey(null);
    setError(null);
    setErrorScopeKey(null);
    setStatus(access?.isCurrent() && snapshot ? "idle" : "locked");
    return () => {
      runtime.current.alive = false;
      if (runtime.current.lifecycle === lifecycle) ++runtime.current.lifecycle;
      ++runtime.current.request;
      revoke(runtime.current.url);
      runtime.current.url = null;
      runtime.current.analyticsRequestId = null;
      runtime.current.analyticsRequestScope = null;
    };
  }, [key, identityKey, source]);

  useEffect(() => {
    if (!access) return;
    const timer = window.setInterval(() => {
      if (!access.isCurrent()) {
        revoke(runtime.current.url);
        runtime.current.url = null;
        setUrl(null);
        setStatus("locked");
        setError("Your verified session changed. Verify your account again before generating this report.");
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [identityKey]);

  const generate = useCallback(async () => {
    const current = runtime.current;
    if (!snapshot || !access || !access.isCurrent()) {
      setStatus("locked");
      setError("A verified account session is needed to generate this report.");
      return;
    }
    const request = ++current.request;
    const capturedScopeKey = current.scopeKey;
    const capturedAnalyticsScope = current.analyticsScope;
    current.analyticsRequestId = null;
    current.analyticsRequestScope = null;
    const environment = ANALYTICS_CONFIG.environment;
    if (capturedAnalyticsScope && analytics?.status === "accepted" && environment && access.isCurrent()) {
      let analyticsRequestId: string | null = null;
      const tracked = analytics.track(({ eventId, newCorrelationId }) => {
        analyticsRequestId = newCorrelationId();
        return { event: "report_generation_status", properties: {
          event_version: 1,
          environment,
          release: "0.1.0",
          auth_state: "member",
          feature: "comparison",
          route_name: reportRoute(source),
          event_id: eventId,
          occurred_at: new Date().toISOString(),
          request_id: analyticsRequestId,
          stage: "requested",
          source,
        } };
      });
      if (tracked.ok && analyticsRequestId) {
        current.analyticsRequestId = analyticsRequestId;
        current.analyticsRequestScope = capturedAnalyticsScope;
      }
    }
    setStatus("generating");
    setError(null);
    try {
      const blob = await renderComparisonReport(snapshot);
      if (!runtime.current.alive || runtime.current.request !== request || runtime.current.scopeKey !== capturedScopeKey || !access.isCurrent()) {
        return;
      }
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("object_url_unavailable");
      const nextUrl = URL.createObjectURL(blob);
      revoke(runtime.current.url);
      runtime.current.url = nextUrl;
      setUrl(nextUrl);
      setUrlKey(capturedScopeKey);
      setStatus("ready");
      if (current.analyticsRequestId && current.analyticsRequestScope === runtime.current.analyticsScope && analytics?.status === "accepted" && environment && access.isCurrent()) {
        analytics.track(({ eventId }) => ({ event: "report_generation_status", properties: {
          event_version: 1,
          environment,
          release: "0.1.0",
          auth_state: "member",
          feature: "comparison",
          route_name: reportRoute(source),
          event_id: eventId,
          occurred_at: new Date().toISOString(),
          request_id: current.analyticsRequestId!,
          stage: "generated",
          source,
        } }));
      }
    } catch (cause) {
      if (!runtime.current.alive || runtime.current.request !== request || runtime.current.scopeKey !== capturedScopeKey) return;
      if (!access.isCurrent()) {
        setStatus("locked");
        setError("Your verified session changed. Verify your account again before generating this report.");
        return;
      }
      setStatus("error");
      setError("The report could not be generated. Try again or use the print option.");
      setErrorScopeKey(capturedScopeKey);
      if (current.analyticsRequestId && current.analyticsRequestScope === runtime.current.analyticsScope && analytics?.status === "accepted" && environment && access.isCurrent()) {
        analytics.track(({ eventId }) => ({ event: "report_generation_status", properties: {
          event_version: 1,
          environment,
          release: "0.1.0",
          auth_state: "member",
          feature: "comparison",
          route_name: reportRoute(source),
          event_id: eventId,
          occurred_at: new Date().toISOString(),
          request_id: current.analyticsRequestId!,
          stage: "failed",
          source,
          error_code: reportErrorCode(cause),
        } }));
      }
    }
  }, [access, analytics, snapshot, source, scopeKey]);

  const allowDownload = useCallback(() => {
    if (!snapshot || !access || !access.isCurrent() || status !== "ready" || !url || urlKey !== scopeKey) {
      revoke(runtime.current.url);
      runtime.current.url = null;
      setUrl(null);
      setUrlKey(null);
      setStatus("locked");
      setError("Your verified session changed. Verify your account again before downloading this report.");
      return false;
    }
    const environment = ANALYTICS_CONFIG.environment;
    if (runtime.current.analyticsRequestId && runtime.current.analyticsRequestScope === runtime.current.analyticsScope && analytics?.status === "accepted" && environment && access.isCurrent()) {
      analytics.track(({ eventId }) => ({ event: "report_download_initiated", properties: {
        event_version: 1,
        environment,
        release: "0.1.0",
        auth_state: "member",
        feature: "comparison",
        route_name: reportRoute(source),
        event_id: eventId,
        occurred_at: new Date().toISOString(),
        request_id: runtime.current.analyticsRequestId!,
      } }));
    }
    return true;
  }, [access, analytics, scopeKey, snapshot, source, status, url, urlKey]);

  const allowPrint = useCallback(() => {
    if (snapshot && access?.isCurrent() && status === "error" && errorScopeKey === scopeKey) return true;
    setStatus("locked");
    setError("Your verified session changed. Verify your account again before printing this report.");
    return false;
  }, [access, errorScopeKey, scopeKey, snapshot, status]);

  const currentUrl = access?.isCurrent() && urlKey === scopeKey ? url : null;
  const canPrint = Boolean(snapshot && access?.isCurrent() && status === "error" && errorScopeKey === scopeKey);
  return { status, url: currentUrl, error, generate, allowDownload, allowPrint, canPrint };
}
