import type { Role } from "./domain.js";

export type UnknownRecord = Record<string, unknown>;
export type UserId = number | string;
export type NullableUserId = UserId | null;
export type OptionalUserId = NullableUserId | undefined;

export type RequestCookies = Record<string, string | undefined>;

export interface AuthenticatedUserContext {
  sub: UserId;
  role: Role;
  purpose?: string;
  username?: string;
  fullName?: string;
}
