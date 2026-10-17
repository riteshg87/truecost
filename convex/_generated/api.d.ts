/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountExports from "../accountExports.js";
import type * as analytics from "../analytics.js";
import type * as comparisons from "../comparisons.js";
import type * as crons from "../crons.js";
import type * as exportRevision from "../exportRevision.js";
import type * as feedback from "../feedback.js";
import type * as privacyApprovals from "../privacyApprovals.js";
import type * as privacyGrants from "../privacyGrants.js";
import type * as retention from "../retention.js";
import type * as savedLoans from "../savedLoans.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountExports: typeof accountExports;
  analytics: typeof analytics;
  comparisons: typeof comparisons;
  crons: typeof crons;
  exportRevision: typeof exportRevision;
  feedback: typeof feedback;
  privacyApprovals: typeof privacyApprovals;
  privacyGrants: typeof privacyGrants;
  retention: typeof retention;
  savedLoans: typeof savedLoans;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
