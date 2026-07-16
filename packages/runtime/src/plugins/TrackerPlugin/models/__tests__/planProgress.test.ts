import { describe, it, expect } from 'vitest';
import { computePlanProgress } from '../planProgress';

describe('computePlanProgress', () => {
  it('returns null when there are no resolvable children (keeps manual progress)', () => {
    expect(computePlanProgress([])).toBeNull();
    expect(computePlanProgress([undefined, null, ''])).toBeNull();
  });

  it('is 0 when nothing is done', () => {
    expect(computePlanProgress(['to-do', 'in-progress', 'in-review'])).toBe(0);
  });

  it('is 100 when every child is done', () => {
    expect(computePlanProgress(['done', 'done'])).toBe(100);
  });

  it('rounds the completed fraction', () => {
    expect(computePlanProgress(['done', 'to-do', 'to-do'])).toBe(33); // 1/3
    expect(computePlanProgress(['done', 'done', 'to-do'])).toBe(67); // 2/3
  });

  it('counts done/completed/complete, case-insensitively', () => {
    expect(computePlanProgress(['DONE', 'Completed', 'complete', 'to-do'])).toBe(75);
  });

  it('excludes unresolved children from the denominator', () => {
    expect(computePlanProgress(['done', undefined, 'to-do'])).toBe(50); // 1 of 2 known
  });

  it('does not count in-review as done', () => {
    expect(computePlanProgress(['in-review', 'in-review'])).toBe(0);
  });
});
