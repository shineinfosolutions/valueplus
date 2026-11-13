/**
 * The small part of Cloudflare's D1 API the copy job uses. Declared here because the project does not load the
 * Workers type package; the real `env.DB` binding and Miniflare's local D1 (used by the tests) both fit it.
 */
export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  /** Runs the statements in order as one transaction: if one fails, none of them is applied. */
  batch(statements: D1PreparedStatementLike[]): Promise<D1Result[]>;
}
