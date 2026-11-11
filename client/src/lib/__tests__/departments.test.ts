import { describe, expect, it } from 'vitest';
import { ALL_DEPARTMENTS_LABEL, DEPARTMENTS, departmentFilterOptions } from '@/lib/departments';

describe('departments', () => {
  it('is one list for registration, directory, yearbook and nearby alumni', () => {
    expect(DEPARTMENTS).toContain('Computer Engineering');
    expect(DEPARTMENTS).toContain('Information Technology');
    expect(new Set(DEPARTMENTS).size).toBe(DEPARTMENTS.length);
    for (const name of DEPARTMENTS) expect(name).toBe(name.trim());
  });

  it('puts "All Departments" in front for the filter dropdowns', () => {
    expect(departmentFilterOptions()[0]).toBe(ALL_DEPARTMENTS_LABEL);
    expect(departmentFilterOptions().slice(1)).toEqual([...DEPARTMENTS]);
  });
});
