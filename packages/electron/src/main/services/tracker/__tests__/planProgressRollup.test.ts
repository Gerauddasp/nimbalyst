import { describe, it, expect } from 'vitest';
import { recomputePlanProgress, affectedPlanIdsForUpdate, type PlanRollupDeps } from '../planProgressRollup';

describe('affectedPlanIdsForUpdate', () => {
  const task = (parentPlan?: unknown) => (parentPlan === undefined ? {} : { parentPlan });

  it('returns the parent plan when a linked task changes (e.g. status)', () => {
    expect(
      affectedPlanIdsForUpdate({
        sourceType: 'task',
        sourceId: 'tsk_1',
        oldData: task({ itemId: 'pln_1' }),
        newData: task({ itemId: 'pln_1' }),
      }),
    ).toEqual(['pln_1']);
  });

  it('returns BOTH the old and new plan when a task is re-linked', () => {
    const ids = affectedPlanIdsForUpdate({
      sourceType: 'task',
      sourceId: 'tsk_1',
      oldData: task({ itemId: 'pln_old' }),
      newData: task({ itemId: 'pln_new' }),
    });
    expect(new Set(ids)).toEqual(new Set(['pln_old', 'pln_new']));
  });

  it('returns the old plan when a task is unlinked', () => {
    expect(
      affectedPlanIdsForUpdate({
        sourceType: 'task',
        sourceId: 'tsk_1',
        oldData: task({ itemId: 'pln_1' }),
        newData: task(),
      }),
    ).toEqual(['pln_1']);
  });

  it('returns nothing for an unlinked task', () => {
    expect(
      affectedPlanIdsForUpdate({ sourceType: 'task', sourceId: 'tsk_1', oldData: task(), newData: task() }),
    ).toEqual([]);
  });

  it('includes the plan itself when its childTasks was edited directly', () => {
    expect(
      affectedPlanIdsForUpdate({
        sourceType: 'plan',
        sourceId: 'pln_1',
        oldData: {},
        newData: {},
        childTasksChanged: true,
      }),
    ).toEqual(['pln_1']);
  });

  it('ignores an unrelated plan edit that does not touch childTasks', () => {
    expect(
      affectedPlanIdsForUpdate({ sourceType: 'plan', sourceId: 'pln_1', oldData: {}, newData: {}, childTasksChanged: false }),
    ).toEqual([]);
  });

  it('reads relationship values nested under customFields (synced shape)', () => {
    expect(
      affectedPlanIdsForUpdate({
        sourceType: 'task',
        sourceId: 'tsk_1',
        oldData: {},
        newData: { customFields: { parentPlan: { itemId: 'pln_9' } } },
      }),
    ).toEqual(['pln_9']);
  });
});

/**
 * Roll-up orchestration wiring. The pure percentage math is covered in the
 * runtime model tests; here we verify the service contract: writes only on a
 * real change, and a plan with no children (or an absent plan) is left untouched.
 */
function makeDeps(over: Partial<PlanRollupDeps> = {}): { deps: PlanRollupDeps; writes: Array<[string, number]> } {
  const writes: Array<[string, number]> = [];
  const statuses: Record<string, string> = { t1: 'done', t2: 'to-do', t3: 'to-do' };
  const deps: PlanRollupDeps = {
    loadChildTaskIds: async () => ['t1', 't2', 't3'],
    loadTaskStatus: async (id) => statuses[id],
    loadPlanProgress: async () => 0,
    writePlanProgress: async (pid, p) => {
      writes.push([pid, p]);
    },
    ...over,
  };
  return { deps, writes };
}

describe('recomputePlanProgress', () => {
  it('writes the rolled-up progress when it changes', async () => {
    const { deps, writes } = makeDeps({ loadPlanProgress: async () => 0 });
    const r = await recomputePlanProgress('pln_1', deps);
    expect(r).toMatchObject({ changed: true, skipped: false, progress: 33 });
    expect(writes).toEqual([['pln_1', 33]]);
  });

  it('does not write when progress is already correct', async () => {
    const { deps, writes } = makeDeps({ loadPlanProgress: async () => 33 });
    const r = await recomputePlanProgress('pln_1', deps);
    expect(r.changed).toBe(false);
    expect(writes).toEqual([]);
  });

  it('skips (keeps manual progress) when the plan has no linked children', async () => {
    const { deps, writes } = makeDeps({ loadChildTaskIds: async () => [] });
    const r = await recomputePlanProgress('pln_1', deps);
    expect(r).toMatchObject({ skipped: true, progress: null, changed: false });
    expect(writes).toEqual([]);
  });

  it('skips when the plan is absent', async () => {
    const { deps, writes } = makeDeps({ loadChildTaskIds: async () => null });
    const r = await recomputePlanProgress('pln_1', deps);
    expect(r.skipped).toBe(true);
    expect(writes).toEqual([]);
  });

  it('reaches 100 when all children are done', async () => {
    const { deps, writes } = makeDeps({
      loadTaskStatus: async () => 'done',
      loadPlanProgress: async () => 0,
    });
    const r = await recomputePlanProgress('pln_1', deps);
    expect(r.progress).toBe(100);
    expect(writes).toEqual([['pln_1', 100]]);
  });
});
