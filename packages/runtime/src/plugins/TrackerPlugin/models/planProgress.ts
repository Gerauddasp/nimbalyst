/**
 * Plan progress roll-up (pure).
 *
 * A Plan's `progress` can be derived from the completion of its linked child
 * tasks (the `childTasks` relationship) rather than maintained by hand: the
 * percentage of children whose status is terminal-complete. Kept I/O-free so it
 * is unit-testable; the service layer supplies the child statuses.
 */

/** Task statuses that count as "done" for roll-up (case-insensitive). */
export const DONE_STATUSES: ReadonlySet<string> = new Set(['done', 'completed', 'complete']);

/**
 * Percentage (0–100, rounded) of `childStatuses` that are complete. Returns
 * `null` when there are no resolvable children, so a Plan with no linked tasks
 * keeps its manually-set `progress` instead of being forced to 0. Unresolvable
 * (missing/empty) statuses are excluded from both numerator and denominator.
 */
export function computePlanProgress(
  childStatuses: readonly (string | undefined | null)[],
  doneStatuses: ReadonlySet<string> = DONE_STATUSES,
): number | null {
  const known = childStatuses.filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (known.length === 0) return null;
  const done = known.filter((s) => doneStatuses.has(s.toLowerCase())).length;
  return Math.round((done / known.length) * 100);
}
