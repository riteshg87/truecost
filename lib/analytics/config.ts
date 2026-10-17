import type { AnalyticsEnvironment } from "./events";

export interface AnalyticsRuntimeConfig {
  readonly enabled: boolean;
  readonly token: string | null;
  readonly environment: AnalyticsEnvironment | null;
}

/** Build-time public settings. This switch never substitutes for user consent. */
export function resolveAnalyticsConfig(settings: {
  enabled?: string;
  token?: string;
  environment?: string;
}): AnalyticsRuntimeConfig {
  const environment = settings.environment === "development" || settings.environment === "preview" || settings.environment === "production"
    ? settings.environment : null;
  const token = settings.token && /^[a-f0-9]{32}$/i.test(settings.token) ? settings.token : null;
  const enabled = settings.enabled === "true" && token !== null && environment !== null;
  return Object.freeze({ enabled, token: enabled ? token : null, environment: enabled ? environment : null });
}

// Next.js requires direct property access to inline public values in the client.
export const ANALYTICS_CONFIG = resolveAnalyticsConfig({
  enabled: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED,
  token: process.env.NEXT_PUBLIC_MIXPANEL_TOKEN,
  environment: process.env.NEXT_PUBLIC_ANALYTICS_ENVIRONMENT,
});
