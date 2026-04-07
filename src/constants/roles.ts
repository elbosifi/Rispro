import type { Role } from '../types/domain.js';

export const ROLE_VALUES: readonly Role[] = ["receptionist", "supervisor", "modality_staff"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLE_VALUES.includes(value as Role);
}
