import { ContractValidationError, canonicalTimestamp, deepFreeze, exactKeys, finiteNumber, integerValue, stringValue, uuidValue } from "../contracts/errors";
import { CALCULATION_VERSION } from "../contracts/snapshot";

export const ANALYTICS_EVENT_VERSION = 1 as const;
export const TRUSTED_RELEASES = ["0.1.0"] as const;
export const TRUSTED_CALCULATION_VERSIONS = [CALCULATION_VERSION] as const;
export const TRUSTED_CONTEXT_VERSIONS = ["v1"] as const;

export const ANALYTICS_ENVIRONMENTS = ["development", "preview", "production"] as const;
export const ANALYTICS_AUTH_STATES = ["guest", "member"] as const;
export const ANALYTICS_FEATURES = ["comparison", "loan_health"] as const;
export const ANALYTICS_ROUTES = ["home", "compare", "compare_results", "comparisons", "comparison_detail", "loan", "loan_setup", "loan_rate", "loan_transfer", "prepay", "account", "signin", "verify"] as const;
export const ANALYTICS_ACTIONS = ["save", "download", "compare_again", "direct"] as const;
export const ANALYTICS_MODES = ["new", "recalculate"] as const;
export const ANALYTICS_ERROR_CODES = ["network", "auth_required", "validation", "conflict", "limited", "storage", "unknown"] as const;

export const ANALYTICS_EVENT_NAMES = [
  "comparison_started",
  "comparison_completed",
  "auth_prompt_viewed",
  "auth_completed",
  "auth_intent_resumed",
  "comparison_save_status",
  "comparison_saved",
  "report_generation_status",
  "report_download_initiated",
  "feedback_submitted",
  "web_vital",
] as const;

export type AnalyticsEventName = typeof ANALYTICS_EVENT_NAMES[number];
export type AnalyticsEnvironment = typeof ANALYTICS_ENVIRONMENTS[number];
export type AnalyticsAuthState = typeof ANALYTICS_AUTH_STATES[number];
export type AnalyticsFeature = typeof ANALYTICS_FEATURES[number];
export type AnalyticsRoute = typeof ANALYTICS_ROUTES[number];
export type AnalyticsAction = typeof ANALYTICS_ACTIONS[number];
export type AnalyticsMode = typeof ANALYTICS_MODES[number];
export type AnalyticsErrorCode = typeof ANALYTICS_ERROR_CODES[number];

export interface AnalyticsTrustedConfig {
  readonly releases: readonly string[];
  readonly calculationVersions: readonly string[];
  readonly contextVersions: readonly string[];
}

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsTrustedConfig = {
  releases: TRUSTED_RELEASES,
  calculationVersions: TRUSTED_CALCULATION_VERSIONS,
  contextVersions: TRUSTED_CONTEXT_VERSIONS,
};

interface CommonProperties {
  event_version: 1;
  environment: AnalyticsEnvironment;
  release: string;
  auth_state: AnalyticsAuthState;
  feature: AnalyticsFeature;
  route_name: AnalyticsRoute;
  event_id: string;
  occurred_at: string;
}

interface ComparisonStartedProperties extends CommonProperties { draft_id: string }
interface ComparisonCompletedProperties extends CommonProperties { draft_id: string; result_id: string; offer_count: number; calculation_version: string }
interface AuthPromptViewedProperties extends CommonProperties { session_id: string; result_id: string; action: "save" | "download" | "compare_again"; mode?: AnalyticsMode }
interface AuthCompletedProperties extends CommonProperties { flow_id: string; action: AnalyticsAction; mode?: AnalyticsMode; method: "email" }
interface AuthIntentResumedProperties extends CommonProperties { flow_id: string; action: AnalyticsAction; mode?: AnalyticsMode; status: "succeeded" | "failed"; error_code?: AnalyticsErrorCode }
interface ComparisonSaveStatusProperties extends CommonProperties { request_id: string; stage: "attempted" | "queued" | "failed"; error_code?: AnalyticsErrorCode }
interface ComparisonSavedProperties extends CommonProperties { request_id: string; path: "immediate" | "queued" }
interface ReportGenerationStatusProperties extends CommonProperties { request_id: string; stage: "requested" | "generated" | "failed"; source: "current" | "saved"; error_code?: AnalyticsErrorCode }
interface ReportDownloadInitiatedProperties extends CommonProperties { request_id: string }
interface FeedbackSubmittedProperties extends CommonProperties { result_id: string; answer: "yes" | "no"; context_version: string }
interface WebVitalProperties extends CommonProperties { metric_id: string; metric: "LCP" | "INP" | "CLS"; unit: "milliseconds" | "unitless"; value: number; device_class: "mobile" | "desktop" }

export interface AnalyticsEventMap {
  comparison_started: ComparisonStartedProperties;
  comparison_completed: ComparisonCompletedProperties;
  auth_prompt_viewed: AuthPromptViewedProperties;
  auth_completed: AuthCompletedProperties;
  auth_intent_resumed: AuthIntentResumedProperties;
  comparison_save_status: ComparisonSaveStatusProperties;
  comparison_saved: ComparisonSavedProperties;
  report_generation_status: ReportGenerationStatusProperties;
  report_download_initiated: ReportDownloadInitiatedProperties;
  feedback_submitted: FeedbackSubmittedProperties;
  web_vital: WebVitalProperties;
}

export type AnalyticsProperties = AnalyticsEventMap[AnalyticsEventName];
export type AnalyticsEvent = { [K in AnalyticsEventName]: { event: K; properties: AnalyticsEventMap[K] } }[AnalyticsEventName];

export type AnalyticsContractErrorCode =
  | "invalid_shape"
  | "unknown_event"
  | "unknown_property"
  | "invalid_enum"
  | "invalid_id"
  | "invalid_number"
  | "invalid_timestamp"
  | "auth_mismatch";

export type AnalyticsResult<T> =
  | { readonly ok: true; readonly value: Readonly<T> }
  | { readonly ok: false; readonly code: AnalyticsContractErrorCode };

const MEMBER_ONLY_EVENTS = new Set<AnalyticsEventName>([
  "comparison_save_status",
  "comparison_saved",
  "report_generation_status",
  "report_download_initiated",
  "feedback_submitted",
]);
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_shape");
  return value as Record<string, unknown>;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error("invalid_enum");
  return value as T;
}

function token(value: unknown, allowed: readonly string[]): string {
  const candidate = stringValue(value, "allowlist value", 64);
  if (!TOKEN_PATTERN.test(candidate) || !allowed.includes(candidate)) throw new Error("invalid_enum");
  return candidate;
}

function uuid(value: unknown): string {
  try { return uuidValue(value, "analytics correlation"); } catch { throw new Error("invalid_id"); }
}

function optionalError(properties: Record<string, unknown>): AnalyticsErrorCode | undefined {
  if (!("error_code" in properties)) return undefined;
  return enumValue(properties.error_code, ANALYTICS_ERROR_CODES);
}

function expectedKeys(event: AnalyticsEventName, properties: Record<string, unknown>): readonly string[] {
  const common = ["event_version", "environment", "release", "auth_state", "feature", "route_name", "event_id", "occurred_at"];
  switch (event) {
    case "comparison_started": return [...common, "draft_id"];
    case "comparison_completed": return [...common, "draft_id", "result_id", "offer_count", "calculation_version"];
    case "auth_prompt_viewed": return [...common, "session_id", "result_id", "action", ...(properties.action === "compare_again" ? ["mode"] : [])];
    case "auth_completed": return [...common, "flow_id", "action", ...(properties.action === "compare_again" ? ["mode"] : []), "method"];
    case "auth_intent_resumed": return [...common, "flow_id", "action", ...(properties.action === "compare_again" ? ["mode"] : []), "status", ...(Object.prototype.hasOwnProperty.call(properties, "error_code") ? ["error_code"] : [])];
    case "comparison_save_status": return [...common, "request_id", "stage", ...(Object.prototype.hasOwnProperty.call(properties, "error_code") ? ["error_code"] : [])];
    case "comparison_saved": return [...common, "request_id", "path"];
    case "report_generation_status": return [...common, "request_id", "stage", "source", ...(Object.prototype.hasOwnProperty.call(properties, "error_code") ? ["error_code"] : [])];
    case "report_download_initiated": return [...common, "request_id"];
    case "feedback_submitted": return [...common, "result_id", "answer", "context_version"];
    case "web_vital": return [...common, "metric_id", "metric", "unit", "value", "device_class"];
  }
}

function parseProperties(event: AnalyticsEventName, raw: Record<string, unknown>, config: AnalyticsTrustedConfig): AnalyticsProperties {
  exactKeys(raw, expectedKeys(event, raw), "analytics.properties");
  const common: CommonProperties = {
    event_version: integerValue(raw.event_version, "event_version", ANALYTICS_EVENT_VERSION, ANALYTICS_EVENT_VERSION) as 1,
    environment: enumValue(raw.environment, ANALYTICS_ENVIRONMENTS),
    release: token(raw.release, config.releases),
    auth_state: enumValue(raw.auth_state, ANALYTICS_AUTH_STATES),
    feature: enumValue(raw.feature, ANALYTICS_FEATURES),
    route_name: enumValue(raw.route_name, ANALYTICS_ROUTES),
    event_id: uuid(raw.event_id),
    occurred_at: canonicalTimestamp(raw.occurred_at, "occurred_at"),
  };
  if (MEMBER_ONLY_EVENTS.has(event) && common.auth_state !== "member") throw new Error("auth_mismatch");
  if ((event === "auth_completed" || event === "auth_intent_resumed") && common.auth_state !== "member") throw new Error("auth_mismatch");
  if (event === "auth_prompt_viewed" && common.auth_state !== "guest") throw new Error("auth_mismatch");
  if (event === "comparison_completed" && common.auth_state === "guest" && raw.offer_count !== 2) throw new Error("invalid_number");
  if (["comparison_started", "comparison_completed", "comparison_save_status", "comparison_saved", "report_generation_status", "report_download_initiated"].includes(event) && common.feature !== "comparison") throw new Error("invalid_enum");
  if (event === "auth_intent_resumed" && Object.prototype.hasOwnProperty.call(raw, "error_code") && raw.status !== "failed") throw new Error("invalid_enum");
  if (event === "comparison_save_status" && Object.prototype.hasOwnProperty.call(raw, "error_code") && raw.stage !== "failed") throw new Error("invalid_enum");
  if (event === "report_generation_status" && Object.prototype.hasOwnProperty.call(raw, "error_code") && raw.stage !== "failed") throw new Error("invalid_enum");

  const output: Record<string, string | number> = { ...common };
  const addUuid = (name: string): void => { output[name] = uuid(raw[name]); };
  switch (event) {
    case "comparison_started": addUuid("draft_id"); break;
    case "comparison_completed":
      addUuid("draft_id"); addUuid("result_id"); output.offer_count = integerValue(raw.offer_count, "offer_count", 2, 3); output.calculation_version = token(raw.calculation_version, config.calculationVersions); break;
    case "auth_prompt_viewed":
      addUuid("session_id"); addUuid("result_id"); output.action = enumValue(raw.action, ["save", "download", "compare_again"] as const); if (output.action === "compare_again") output.mode = enumValue(raw.mode, ANALYTICS_MODES); break;
    case "auth_completed":
      addUuid("flow_id"); output.action = enumValue(raw.action, ANALYTICS_ACTIONS); if (output.action === "compare_again") output.mode = enumValue(raw.mode, ANALYTICS_MODES); if (raw.method !== "email") throw new Error("invalid_enum"); output.method = "email"; break;
    case "auth_intent_resumed":
      addUuid("flow_id"); output.action = enumValue(raw.action, ANALYTICS_ACTIONS); if (output.action === "compare_again") output.mode = enumValue(raw.mode, ANALYTICS_MODES); output.status = enumValue(raw.status, ["succeeded", "failed"] as const); { const errorCode = optionalError(raw); if (errorCode) output.error_code = errorCode; } break;
    case "comparison_save_status":
      addUuid("request_id"); output.stage = enumValue(raw.stage, ["attempted", "queued", "failed"] as const); { const errorCode = optionalError(raw); if (errorCode) output.error_code = errorCode; } break;
    case "comparison_saved": addUuid("request_id"); output.path = enumValue(raw.path, ["immediate", "queued"] as const); break;
    case "report_generation_status":
      addUuid("request_id"); output.stage = enumValue(raw.stage, ["requested", "generated", "failed"] as const); output.source = enumValue(raw.source, ["current", "saved"] as const); { const errorCode = optionalError(raw); if (errorCode) output.error_code = errorCode; } break;
    case "report_download_initiated": addUuid("request_id"); break;
    case "feedback_submitted": addUuid("result_id"); output.answer = enumValue(raw.answer, ["yes", "no"] as const); output.context_version = token(raw.context_version, config.contextVersions); break;
    case "web_vital":
      addUuid("metric_id"); output.metric = enumValue(raw.metric, ["LCP", "INP", "CLS"] as const); output.unit = enumValue(raw.unit, ["milliseconds", "unitless"] as const); output.value = finiteNumber(raw.value, "value", 0, 86_400_000); output.device_class = enumValue(raw.device_class, ["mobile", "desktop"] as const);
      if ((output.metric === "CLS") !== (output.unit === "unitless")) throw new Error("invalid_enum");
      if (output.metric !== "CLS" && output.unit !== "milliseconds") throw new Error("invalid_enum");
      break;
  }
  return output as unknown as AnalyticsProperties;
}

function validConfig(config: AnalyticsTrustedConfig): void {
  for (const values of [config.releases, config.calculationVersions, config.contextVersions]) {
    if (!Array.isArray(values) || values.length === 0 || values.length > 32 || new Set(values).size !== values.length) throw new Error("invalid_shape");
    values.forEach((value) => { if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) throw new Error("invalid_enum"); });
  }
}

function mapContractError(error: ContractValidationError): AnalyticsContractErrorCode {
  if (error.code === "unknown_field") return "unknown_property";
  if (error.code === "invalid_enum") return "invalid_enum";
  if (error.code === "invalid_id") return "invalid_id";
  if (error.code === "invalid_number") return "invalid_number";
  if (error.code === "invalid_timestamp") return "invalid_timestamp";
  return "invalid_shape";
}

export function parseAnalyticsEvent(value: unknown, config: AnalyticsTrustedConfig = DEFAULT_ANALYTICS_CONFIG): AnalyticsResult<AnalyticsEvent> {
  try {
    validConfig(config);
    const input = record(value);
    exactKeys(input, ["event", "properties"], "analytics event");
    if (typeof input.event !== "string" || !ANALYTICS_EVENT_NAMES.includes(input.event as AnalyticsEventName)) throw new Error("unknown_event");
    const event = input.event as AnalyticsEventName;
    const properties = parseProperties(event, record(input.properties), config);
    return { ok: true, value: deepFreeze({ event, properties } as unknown as AnalyticsEvent) };
  } catch (error) {
    const code = error instanceof Error && ["invalid_shape", "unknown_event", "unknown_property", "invalid_enum", "invalid_id", "invalid_number", "invalid_timestamp", "auth_mismatch"].includes(error.message)
      ? error.message as AnalyticsContractErrorCode
      : error instanceof ContractValidationError
        ? mapContractError(error)
        : "invalid_shape";
    return { ok: false, code };
  }
}

export function buildAnalyticsEvent(value: unknown, config: AnalyticsTrustedConfig = DEFAULT_ANALYTICS_CONFIG): AnalyticsResult<AnalyticsEvent> {
  try {
    return parseAnalyticsEvent(structuredClone(value), config);
  } catch {
    return { ok: false, code: "invalid_shape" };
  }
}
