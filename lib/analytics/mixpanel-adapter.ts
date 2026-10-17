import type { BeforeSendHookPayload, Config, Mixpanel, Response } from "mixpanel-browser/src/index";
import { randomUuid } from "../contracts/errors";
import { ANALYTICS_EVENT_NAMES, parseAnalyticsEvent, type AnalyticsEvent } from "./events";
import type { AnalyticsIdentity, AnalyticsTransport, AnalyticsTransportFactory } from "./controller";

export const MIXPANEL_API_HOST = "https://api-js.mixpanel.com";
export const MIXPANEL_SDK_VERSION = "2.83.0";

type MixpanelErrorCode = "network" | "limited" | "unknown";

export class MixpanelTransportError extends Error {
  readonly code: MixpanelErrorCode;

  constructor(code: MixpanelErrorCode) {
    super("analytics transport failed");
    this.name = "MixpanelTransportError";
    this.code = code;
  }
}

export type MixpanelLoader = () => Promise<Mixpanel>;

type MixpanelConsentClient = Mixpanel & {
  opt_in_tracking(options?: { readonly track?: () => void; readonly enable_persistence?: boolean }): void;
  opt_out_tracking(options?: { readonly delete_user?: boolean; readonly clear_persistence?: boolean }): void;
};

export interface MixpanelAdapterOptions {
  readonly token: string;
  readonly loadSdk?: MixpanelLoader;
  readonly requestTimeoutMs?: number;
}

const SDK_PROPERTY_BLACKLIST = [
  "$browser",
  "$current_url",
  "$device",
  "$initial_referrer",
  "$initial_referring_domain",
  "$lib_version",
  "$mp_api_endpoint",
  "$mp_api_timestamp",
  "$os",
  "$referrer",
  "$referring_domain",
  "$search_engine",
  "$wifi",
  "mp_lib",
  "mp_loader",
  "mp_sent_by_lib_version",
];

const APPROVED_PROPERTY_KEYS = new Set([
  "event_version",
  "environment",
  "release",
  "auth_state",
  "feature",
  "route_name",
  "session_id",
  "draft_id",
  "result_id",
  "flow_id",
  "request_id",
  "offer_count",
  "calculation_version",
  "action",
  "mode",
  "method",
  "status",
  "error_code",
  "stage",
  "path",
  "source",
  "answer",
  "context_version",
  "metric_id",
  "metric",
  "unit",
  "value",
  "device_class",
  "occurred_at",
  "$insert_id",
  "distinct_id",
  "$device_id",
  "$user_id",
  "token",
  "time",
]);

const ANALYTICS_EVENT_NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES);
let nextInstanceNumber = 1;

function defaultLoader(): Promise<Mixpanel> {
  return import("mixpanel-browser/src/loaders/loader-module-core").then((module) => (module as unknown as { default: Mixpanel }).default);
}

function timeoutMs(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value >= 1 && value <= 60_000 ? value : 10_000;
}

function distinctId(identity: AnalyticsIdentity): string {
  const value = identity.memberAnalyticsId ?? identity.anonymousId;
  if (!value) throw new MixpanelTransportError("unknown");
  return value;
}

function sanitizePayload(payload: BeforeSendHookPayload): BeforeSendHookPayload | null {
  if (!payload || typeof payload.event !== "string" || !payload.properties || typeof payload.properties !== "object") return null;
  if (!ANALYTICS_EVENT_NAME_SET.has(payload.event)) return null;
  const properties: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(payload.properties)) {
    if (!APPROVED_PROPERTY_KEYS.has(key)) continue;
    if ((typeof value === "string" && value.length <= 256) || (typeof value === "number" && Number.isFinite(value))) properties[key] = value;
  }
  if (typeof properties.distinct_id !== "string" || typeof properties.$insert_id !== "string") return null;
  return { event: payload.event, properties };
}

function sdkConfig(instanceName: string): Partial<Config> & { readonly track_marketing: false } {
  return {
    api_host: MIXPANEL_API_HOST,
    api_payload_format: "json",
    api_transport: "XHR",
    autocapture: false,
    track_pageview: false,
    track_marketing: false,
    skip_first_touch_marketing: true,
    store_google: false,
    stop_utm_persistence: true,
    save_referrer: false,
    ip: false,
    property_blacklist: SDK_PROPERTY_BLACKLIST,
    opt_out_tracking_by_default: true,
    opt_out_persistence_by_default: true,
    opt_out_tracking_persistence_type: "localStorage",
    opt_out_tracking_cookie_prefix: `__truecost_mixpanel_opt_${instanceName}_`,
    persistence: "localStorage",
    disable_persistence: true,
    disable_cookie: true,
    batch_requests: false,
    batch_autostart: false,
    record_heatmap_data: false,
    record_sessions_percent: 0,
    record_console: false,
    record_network: false,
    record_collect_fonts: false,
    remote_settings_mode: "disabled",
    flags: false,
    hooks: { before_send_events: sanitizePayload },
  };
}

function callbackSucceeded(response: Response | unknown): boolean {
  if (response === 1) return true;
  return !!response && typeof response === "object" && "status" in response && response.status === 1;
}

class MixpanelTransport implements AnalyticsTransport {
  private disposed = false;
  private readonly timeout: number;

  constructor(private readonly client: MixpanelConsentClient, private readonly boundIdentity: AnalyticsIdentity, timeout: number) {
    this.timeout = timeout;
  }

  send(event: Readonly<AnalyticsEvent>, identity: Readonly<AnalyticsIdentity>): Promise<void> {
    if (this.disposed) return Promise.reject(new MixpanelTransportError("unknown"));
    const parsed = parseAnalyticsEvent(event);
    if (!parsed.ok) return Promise.reject(new MixpanelTransportError("unknown"));
    if (identity.anonymousId !== this.boundIdentity.anonymousId || identity.memberAnalyticsId !== this.boundIdentity.memberAnalyticsId) return Promise.reject(new MixpanelTransportError("unknown"));
    const id = distinctId(identity);
    const validatedEvent = parsed.value;
    const properties = { ...validatedEvent.properties, "$insert_id": validatedEvent.properties.event_id, distinct_id: id, time: Math.floor(Date.parse(validatedEvent.properties.occurred_at) / 1000) } as Record<string, string | number>;
    delete properties.event_id;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: MixpanelTransportError): void => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const timer = globalThis.setTimeout(() => finish(new MixpanelTransportError("network")), this.timeout);
      const callback = (response: Response): void => {
        globalThis.clearTimeout(timer);
        finish(callbackSucceeded(response) ? undefined : new MixpanelTransportError("network"));
      };
      try {
        this.client.track(event.event, properties, { send_immediately: true }, callback);
      } catch {
        globalThis.clearTimeout(timer);
        finish(new MixpanelTransportError("unknown"));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try { this.client.opt_out_tracking({ delete_user: false, clear_persistence: true }); } catch { /* SDK cleanup is best effort. */ }
    try { this.client.disable(); } catch { /* SDK cleanup is best effort. */ }
  }
}

export function createMixpanelTransportFactory(options: MixpanelAdapterOptions): AnalyticsTransportFactory {
  const loadSdk = options.loadSdk ?? defaultLoader;
  const requestTimeout = timeoutMs(options.requestTimeoutMs);
  return async (identity: Readonly<AnalyticsIdentity>): Promise<AnalyticsTransport> => {
    if (typeof options.token !== "string" || options.token.length === 0) throw new MixpanelTransportError("unknown");
    const sdk = await loadSdk();
    const instanceName = `truecost_${nextInstanceNumber++}`;
    const client = sdk.init(options.token, sdkConfig(instanceName), instanceName) as MixpanelConsentClient;
    client.opt_in_tracking({ track: undefined, enable_persistence: false });
    // A fresh member session still needs an opaque device identity. Reusing the
    // member ID as `$device_id` makes Mixpanel retain the device-prefixed ID even
    // when `$user_id` and `distinct_id` are supplied. A guest ID, including one
    // carried through a valid member join, remains the device identity.
    const deviceId = identity.anonymousId ?? randomUuid();
    const identityProperties: Record<string, string> = { distinct_id: distinctId(identity), "$device_id": deviceId };
    if (identity.memberAnalyticsId) identityProperties.$user_id = identity.memberAnalyticsId;
    client.register(identityProperties, { persistent: false });
    return new MixpanelTransport(client, { anonymousId: identity.anonymousId, memberAnalyticsId: identity.memberAnalyticsId }, requestTimeout);
  };
}
