/**
 * The departments of the college, in one place: the registration form, the directory, the yearbook and the
 * nearby-alumni search all use this list, so a department a member signs up with is one they can be found by.
 */
export const DEPARTMENTS = [
  'Computer Engineering',
  'Computer Science',
  'Information Technology',
  'Electronics',
  'Electrical',
  'Mechanical',
  'Civil',
  'Chemical',
] as const;

export const ALL_DEPARTMENTS_LABEL = 'All Departments';

/** Options for a filter dropdown: "All Departments" first, then every department. */
export const departmentFilterOptions = (): string[] => [ALL_DEPARTMENTS_LABEL, ...DEPARTMENTS];
