import type { PrivateSessionAccess } from "../auth/private-session";
import {
  ComparisonWorkspace,
  type CapturedFormerComparisonCleanup,
  type FormerComparisonCleanupResult,
} from "../comparison/private-workspace";
import {
  PrivateStorage,
  type CapturedFormerPartitionCleanup,
  type FormerPartitionCleanupResult,
} from "../private-storage/storage";

export type DeletionCleanupResult =
  | { kind: "cleared" }
  | { kind: "retry"; reasons: readonly ("storage-failure" | "runtime-changed")[] };

export interface DeletionCleanupOptions {
  access: PrivateSessionAccess;
  confirmed: boolean;
  privateStorage: PrivateStorage;
  comparisonWorkspace: ComparisonWorkspace;
}

export interface CapturedDeletionCleanup {
  run(): Promise<DeletionCleanupResult>;
}

type CapturedOperation = CapturedFormerPartitionCleanup | CapturedFormerComparisonCleanup;
type OperationResult = FormerPartitionCleanupResult | FormerComparisonCleanupResult;

function reasonOf(result: OperationResult & { kind: "retry" }): "storage-failure" | "runtime-changed" {
  return result.reason;
}

/**
 * Capture the two local account partitions while the verified session is live.
 * `confirmed` must represent the user's deletion confirmation before the
 * server request is submitted. Running the returned capability is local only;
 * it does not unlock, inspect, return, or transmit private data.
 */
export function captureDeletionCleanup(
  options: DeletionCleanupOptions,
): CapturedDeletionCleanup | null {
  const { access, confirmed } = options;
  if (!confirmed || !access.isCurrent()) return null;
  const privateCleanup = options.privateStorage.captureFormerAccountCleanup(access, true);
  const comparisonCleanup = options.comparisonWorkspace.captureFormerAccountCleanup(access, true);
  if (!privateCleanup || !comparisonCleanup) return null;

  let completed: DeletionCleanupResult | null = null;
  return {
    run: async () => {
      if (completed) return completed;
      const results = await Promise.all([
        runOperation(privateCleanup),
        runOperation(comparisonCleanup),
      ]);
      const failures = results.filter((result): result is OperationResult & { kind: "retry" } => result.kind === "retry");
      if (failures.length > 0) {
        return { kind: "retry", reasons: [...new Set(failures.map(reasonOf))] };
      }
      completed = { kind: "cleared" };
      return completed;
    },
  };
}

async function runOperation(operation: CapturedOperation): Promise<OperationResult> {
  return operation.run();
}
