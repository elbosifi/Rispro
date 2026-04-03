export interface DbQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount?: number;
}

export interface DbExecutor {
  query: (sql: string, params?: unknown[]) => Promise<DbQueryResult>;
}
