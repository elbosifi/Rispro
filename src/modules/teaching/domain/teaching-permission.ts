export const TEACHING_PERMISSIONS = [
  "teaching.access",
  "teaching.learn",
  "teaching.author",
  "teaching.review",
  "teaching.publish",
  "teaching.manage_taxonomy",
  "teaching.manage_sources",
  "teaching.manage_users",
  "teaching.view_cohort_analytics",
  "teaching.admin",
] as const;

export type TeachingPermission = (typeof TEACHING_PERMISSIONS)[number];

export function isTeachingPermission(value: string): value is TeachingPermission {
  return TEACHING_PERMISSIONS.includes(value as TeachingPermission);
}
