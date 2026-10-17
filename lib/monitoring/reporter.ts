import { scrubMonitoringEvent, type MonitoringEnvironment, type MonitoringEvent, type MonitoringSource } from "./scrub";

export type MonitoringSink = (event: MonitoringEvent) => void;

export function reportMonitoringError(
  cause: unknown,
  context: {
    release: string;
    environment: MonitoringEnvironment;
    source: MonitoringSource;
    errorCode?: unknown;
    requestId?: unknown;
    jobId?: unknown;
  },
  sink?: MonitoringSink,
): MonitoringEvent {
  const event = scrubMonitoringEvent({ ...context, requestId: context.requestId, jobId: context.jobId }, context);
  try {
    sink?.(event);
  } catch {
    // Monitoring must never replace the user-facing recovery path.
  }
  return event;
}
