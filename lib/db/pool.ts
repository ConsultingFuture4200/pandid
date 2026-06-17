/**
 * Shared Postgres connection pool (owned by the persistence task, DEV-1135).
 *
 * The persistence layer owns DB connections (per the auth task's note: the
 * Postgres-backed repository is delivered here). A single process-wide `Pool`
 * is reused so repositories do not each open their own connections.
 *
 * `DATABASE_URL` is required — there is no in-process fallback (project policy:
 * real data sources only, fail fast). Tests that need a real database inject a
 * `Pool` directly into a repository instead of relying on this singleton.
 */
import { Pool } from "pg";

let cachedPool: Pool | null = null;

function connectionStringFromEnv(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it to a Postgres connection string, e.g. " +
        "postgres://user:password@localhost:5432/pid_coeditor",
    );
  }
  return url;
}

/** Resolve the process-wide Postgres pool, creating it on first use. */
export function getPool(): Pool {
  cachedPool ??= new Pool({ connectionString: connectionStringFromEnv() });
  return cachedPool;
}
