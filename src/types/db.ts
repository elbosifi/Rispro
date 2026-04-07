import type { UnknownRecord } from "./http.js";

export type DbNumeric = number | string;
export type NullableDbNumeric = DbNumeric | null;

export interface DbQueryResult<T = UnknownRecord> {
  rows: T[];
  rowCount?: number;
}

export interface DbExecutor {
  query: <T = UnknownRecord>(sql: string, params?: unknown[]) => Promise<DbQueryResult<T>>;
}
