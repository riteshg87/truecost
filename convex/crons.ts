import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.hourly("expire feedback after twelve months", { minuteUTC: 20 }, internal.retention.purgeExpiredFeedback, {});
crons.hourly("purge expired privacy export state", { minuteUTC: 35 }, internal.accountExports.purgeExpiredState, {});
export default crons;
