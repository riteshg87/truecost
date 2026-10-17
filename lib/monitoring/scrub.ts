const ERROR_CODES = [
  "auth",
  "configuration",
  "network",
  "provider",
  "rate_limited",
  "storage",
  "timeout",
  "unknown",
  "validation",
] as const;

const SOURCES = ["client", "server", "job"] as const;
const ENVIRONMENTS = ["development", "preview", "production", "test", "unknown"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RELEASE = /^[A-Za-z0-9._-]{1,80}$/;

export type MonitoringErrorCode = (typeof ERROR_CODES)[number];
export type MonitoringSource = (typeof SOURCES)[number];
export type MonitoringEnvironment = (typeof ENVIRONMENTS)[number];

export type MonitoringEvent = {
  release: string;
  environment: MonitoringEnvironment;
  source: MonitoringSource;
  errorCode: MonitoringErrorCode;
  requestId?: string;
  jobId?: string;
};

type MonitoringInput = {
  release?: unknown;
  environment?: unknown;
  source?: unknown;
  errorCode?: unknown;
  requestId?: unknown;
  jobId?: unknown;
};

function record(input: unknown): MonitoringInput {
  return input && typeof input === "object" && !Array.isArray(input) ? input as MonitoringInput : {};
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function safeRelease(value: unknown, fallback: string): string {
  return typeof value === "string" && RELEASE.test(value) ? value : fallback;
}

function safeUuid(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

/**
 * Keeps operational error reports to release, environment, source, stable code
 * and opaque UUIDs. Messages, URLs, request bodies, user data and Error objects
 * are intentionally ignored so a provider adapter cannot forward them later.
 */
export function scrubMonitoringEvent(input: unknown, defaults: { release: string; environment: MonitoringEnvironment; source: MonitoringSource }): MonitoringEvent {
  const value = record(input);
  const errorCode = enumValue(value.errorCode, ERROR_CODES) ?? "unknown";
  const environment = enumValue(value.environment, ENVIRONMENTS) ?? defaults.environment;
  const source = enumValue(value.source, SOURCES) ?? defaults.source;
  const event: MonitoringEvent = {
    release: safeRelease(value.release, safeRelease(defaults.release, "unknown")),
    environment,
    source,
    errorCode,
  };
  const requestId = safeUuid(value.requestId);
  const jobId = safeUuid(value.jobId);
  if (requestId) event.requestId = requestId;
  if (jobId) event.jobId = jobId;
  return event;
}
