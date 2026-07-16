import { describe, it, expect, beforeEach } from 'vitest';
import { globalRegistry } from '../TrackerDataModel';
import { loadBuiltinTrackers } from '../ModelLoader';
import { computeInverseFieldDeltas, isRelationshipField } from '../trackerRelationships';

/**
 * Built-in task <-> plan hierarchy link (parentPlan / childTasks).
 *
 * Tasks can be linked up to their umbrella Plan via the `parentPlan` relationship
 * field; the inverse `childTasks` field on the Plan is materialized by the
 * inverse-write path. This covers the schema wiring (both directions declare the
 * matching relationship + inverse field) and the pure delta math the service uses
 * to keep the two sides in sync.
 */
describe('built-in task <-> plan hierarchy link', () => {
  beforeEach(() => loadBuiltinTrackers());

  it('task declares a single-value parentPlan relationship targeting plan', () => {
    const def = globalRegistry.get('task')!.fields.find((f) => f.name === 'parentPlan');
    expect(def).toBeDefined();
    expect(isRelationshipField(def!)).toBe(true);
    expect(def!.relationshipTypeKey).toBe('child-of');
    expect(def!.inverseRelationshipTypeKey).toBe('parent-of');
    expect(def!.inverseFieldId).toBe('childTasks');
    expect(def!.targetTrackerTypes).toEqual(['plan']);
    expect(def!.multiValue).toBe(false);
    expect(def!.childRelationship).toBe(true);
  });

  it('plan declares a multi-value childTasks relationship that inverses parentPlan', () => {
    const def = globalRegistry.get('plan')!.fields.find((f) => f.name === 'childTasks');
    expect(def).toBeDefined();
    expect(isRelationshipField(def!)).toBe(true);
    expect(def!.relationshipTypeKey).toBe('parent-of');
    expect(def!.inverseRelationshipTypeKey).toBe('child-of');
    expect(def!.inverseFieldId).toBe('parentPlan');
    expect(def!.targetTrackerTypes).toEqual(['task']);
    expect(def!.multiValue).toBe(true);
  });

  it('the two fields are mutual inverses (round-trip)', () => {
    const task = globalRegistry.get('task')!.fields.find((f) => f.name === 'parentPlan')!;
    const plan = globalRegistry.get('plan')!.fields.find((f) => f.name === 'childTasks')!;
    expect(task.inverseFieldId).toBe(plan.name);
    expect(plan.inverseFieldId).toBe(task.name);
    expect(task.relationshipTypeKey).toBe(plan.inverseRelationshipTypeKey);
    expect(plan.relationshipTypeKey).toBe(task.inverseRelationshipTypeKey);
  });

  it('linking a task to a plan yields an inverse childTasks "add" delta on the plan', () => {
    const def = globalRegistry.get('task')!.fields.find((f) => f.name === 'parentPlan')!;
    const deltas = computeInverseFieldDeltas(
      def,
      { itemId: 'tsk_1', trackerType: 'task', title: 'Phase 1' },
      undefined, // no prior link
      { itemId: 'pln_1' }, // now linked to the plan
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ targetItemId: 'pln_1', inverseFieldId: 'childTasks', op: 'add' });
    expect(deltas[0].value.itemId).toBe('tsk_1');
    expect(deltas[0].value.relationshipTypeKey).toBe('parent-of');
  });

  it('unlinking a task removes it from the plan (remove delta)', () => {
    const def = globalRegistry.get('task')!.fields.find((f) => f.name === 'parentPlan')!;
    const deltas = computeInverseFieldDeltas(
      def,
      { itemId: 'tsk_1', trackerType: 'task' },
      { itemId: 'pln_1' }, // was linked
      undefined, // now cleared
    );
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ targetItemId: 'pln_1', inverseFieldId: 'childTasks', op: 'remove' });
  });
});
