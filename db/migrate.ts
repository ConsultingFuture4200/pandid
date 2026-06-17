/**
 * Migration runner for the Extraction P&ID Co-Editor.
 *
 * Schema-migration mechanics ONLY. This is deliberately NOT a data-access layer
 * (that is DEV-1135 / DEV-1136): it discovers ordered `*.up.sql` / `*.down.sql`
 * pairs in `db/migrations`, applies or rolls them back inside a transaction, and
 * records applied migrations in a `schema_migrations` ledger table.
 *
 * Each migration version is a numeric prefix (e.g. `0001`) shared by its
 * `<version>_<name>.up.sql` and `<version>_<name>.down.sql` files.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type ClientConfig } from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export interface Migration {
  /** Numeric version prefix, e.g. "0001". Defines apply order. */
  readonly version: string;
  /** Human-readable name, e.g. "init". */
  readonly name: string;
  readonly upSql: string;
  readonly downSql: string;
}

const MIGRATION_FILE = /^(\d+)_(.+)\.(up|down)\.sql$/;

/** Discover and order all migration pairs on disk. */
export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<Migration[]> {
  const entries = await readdir(dir);
  const byVersion = new Map<string, { name: string; up?: string; down?: string }>();

  for (const file of entries) {
    const match = MIGRATION_FILE.exec(file);
    if (!match) continue;
    const [, version, name, kind] = match;
    const record = byVersion.get(version) ?? { name };
    const sql = await readFile(join(dir, file), "utf8");
    if (kind === "up") record.up = sql;
    else record.down = sql;
    byVersion.set(version, record);
  }

  const migrations: Migration[] = [];
  for (const [version, record] of byVersion) {
    if (record.up === undefined) {
      throw new Error(`Migration ${version} is missing its .up.sql file`);
    }
    if (record.down === undefined) {
      throw new Error(`Migration ${version} is missing its .down.sql file`);
    }
    migrations.push({ version, name: record.name, upSql: record.up, downSql: record.down });
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version));
  return migrations;
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  return new Set(rows.map((r) => r.version));
}

/** Apply every pending migration in order. Returns the versions applied. */
export async function migrateUp(client: Client, dir?: string): Promise<string[]> {
  await ensureLedger(client);
  const applied = await appliedVersions(client);
  const migrations = await loadMigrations(dir);
  const ran: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    await client.query("BEGIN");
    try {
      await client.query(migration.upSql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
        migration.version,
      ]);
      await client.query("COMMIT");
      ran.push(migration.version);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
  return ran;
}

/**
 * Roll back the most recently applied migrations, newest first.
 * `steps` defaults to rolling back everything that has been applied.
 * Returns the versions rolled back.
 */
export async function migrateDown(
  client: Client,
  steps?: number,
  dir?: string,
): Promise<string[]> {
  await ensureLedger(client);
  const applied = await appliedVersions(client);
  const migrations = (await loadMigrations(dir))
    .filter((m) => applied.has(m.version))
    .sort((a, b) => b.version.localeCompare(a.version));

  const target = steps === undefined ? migrations : migrations.slice(0, steps);
  const rolledBack: string[] = [];

  for (const migration of target) {
    await client.query("BEGIN");
    try {
      await client.query(migration.downSql);
      await client.query("DELETE FROM schema_migrations WHERE version = $1", [migration.version]);
      await client.query("COMMIT");
      rolledBack.push(migration.version);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }
  return rolledBack;
}

/** Open a client, run a callback, and always close. */
export async function withClient<T>(
  config: ClientConfig,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client(config);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

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

/** CLI entry: `tsx db/migrate.ts up` | `tsx db/migrate.ts down [steps]`. */
async function main(): Promise<void> {
  const command = process.argv[2];
  const connectionString = connectionStringFromEnv();

  if (command === "up") {
    const ran = await withClient({ connectionString }, (c) => migrateUp(c));
    process.stdout.write(
      ran.length ? `Applied: ${ran.join(", ")}\n` : "No pending migrations.\n",
    );
    return;
  }

  if (command === "down") {
    const stepsArg = process.argv[3];
    const steps = stepsArg === undefined ? undefined : Number.parseInt(stepsArg, 10);
    if (steps !== undefined && (Number.isNaN(steps) || steps < 1)) {
      throw new Error(`Invalid step count: ${stepsArg}. Pass a positive integer or omit it.`);
    }
    const rolledBack = await withClient({ connectionString }, (c) => migrateDown(c, steps));
    process.stdout.write(
      rolledBack.length ? `Rolled back: ${rolledBack.join(", ")}\n` : "Nothing to roll back.\n",
    );
    return;
  }

  throw new Error(`Unknown command: ${command ?? "(none)"}. Usage: migrate.ts <up|down [steps]>`);
}

// Only run as a CLI when invoked directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
