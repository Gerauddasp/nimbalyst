/**
 * Plan progress roll-up orchestration.
 *
 * Derives a Plan's `progress` from the completion of its linked child tasks
 * (`plan.childTasks`). Kept I/O-agnostic via injected deps — mirroring
 * `inverseRelationshipWrites` — so it is unit-testable without a DB. The pure
 * percentage math lives in the runtime model (`computePlanProgress`).
 *
 * A Plan with no linked tasks is left untouched (its manual `progress` stands);
 * a write only happens when the computed value differs from the current one.
 */
import { computePlanProgress } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/planProgress';
import { normalizeRelationshipValue } from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { readStoredFieldValue } from './relationshipFieldStorage';

/**
 * Plans whose progress may have changed as a result of updating one item.
 *
 * A task carries `parentPlan`, so both its previous and current parent are
 * affected (a status change keeps the same parent; a re-link touches two). A
 * plan is affected by a direct edit to its own `childTasks`.
 */
export function affectedPlanIdsForUpdate(args: {
  sourceType: string;
  sourceId: string;
  oldData: Record<string, unknown>;
  newData: Record<string, unknown>;
  childTasksChanged?: boolean;
}): string[] {
  const ids = new Set<string>();
  for (const v of normalizeRelationshipValue(readStoredFieldValue(args.oldData, 'parentPlan'))) ids.add(v.itemId);
  for (const v of normalizeRelationshipValue(readStoredFieldValue(args.newData, 'parentPlan'))) ids.add(v.itemId);
  if (args.sourceType === 'plan' && args.childTasksChanged) ids.add(args.sourceId);
  return [...ids];
}

export interface PlanRollupDeps {
  /** The plan's linked child-task ids (from `plan.childTasks`); null if the plan is absent. */
  loadChildTaskIds: (planId: string) => Promise<string[] | null>;
  /** A child task's current workflow status; undefined if unresolved. */
  loadTaskStatus: (taskId: string) => Promise<string | undefined>;
  /** The plan's current `progress` value; undefined if unset. */
  loadPlanProgress: (planId: string) => Promise<number | undefined>;
  /** Persist the rolled-up progress on the plan. */
  writePlanProgress: (planId: string, progress: number) => Promise<void>;
}

export interface PlanRollupResult {
  /** True when nothing was computed (plan absent, or no linked children). */
  skipped: boolean;
  /** The computed progress, or null when skipped. */
  progress: number | null;
  /** True when a new progress value was written. */
  changed: boolean;
}

export async function recomputePlanProgress(planId: string, deps: PlanRollupDeps): Promise<PlanRollupResult> {
  const childIds = await deps.loadChildTaskIds(planId);
  if (childIds == null) return { skipped: true, progress: null, changed: false }; // plan gone

  const statuses = await Promise.all(childIds.map((id) => deps.loadTaskStatus(id)));
  const progress = computePlanProgress(statuses);
  if (progress == null) return { skipped: true, progress: null, changed: false }; // no children → keep manual

  const current = await deps.loadPlanProgress(planId);
  if (current === progress) return { skipped: false, progress, changed: false };

  await deps.writePlanProgress(planId, progress);
  return { skipped: false, progress, changed: true };
}
