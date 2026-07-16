export const PHASE3_REHEARSAL_DATABASE = "ueb_core_phase3_rehearsal";
export const PHASE3_E2E_DATABASE = "ueb_core_phase3_e2e";

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface Phase3TestDatabaseUrls {
  readonly sourceMigrationUrl: string;
  readonly sourceRuntimeUrl: string;
  readonly rehearsalMigrationUrl: string;
  readonly rehearsalRuntimeUrl: string;
  readonly e2eMigrationUrl: string;
  readonly e2eRuntimeUrl: string;
}

export function readPhase3TestDatabaseUrls(
  environment: Readonly<Record<string, string | undefined>>,
): Phase3TestDatabaseUrls {
  const sourceMigrationUrl = requireLocalDatabaseUrl(
    environment.MIGRATION_DATABASE_URL,
    "MIGRATION_DATABASE_URL",
  );
  const sourceRuntimeUrl = requireLocalDatabaseUrl(
    environment.DATABASE_URL,
    "DATABASE_URL",
  );
  const sourceMigrationDatabase = databaseName(sourceMigrationUrl);
  const sourceRuntimeDatabase = databaseName(sourceRuntimeUrl);

  if (sourceMigrationDatabase !== sourceRuntimeDatabase) {
    throw new Error(
      "MIGRATION_DATABASE_URL and DATABASE_URL must target the same source database.",
    );
  }
  if (
    sourceMigrationDatabase === PHASE3_REHEARSAL_DATABASE ||
    sourceMigrationDatabase === PHASE3_E2E_DATABASE
  ) {
    throw new Error("The Phase 3 source database must not be a test database.");
  }
  if (databaseUser(sourceMigrationUrl) === databaseUser(sourceRuntimeUrl)) {
    throw new Error("Migration and runtime roles must be different.");
  }

  return {
    sourceMigrationUrl,
    sourceRuntimeUrl,
    rehearsalMigrationUrl: withDatabaseName(
      sourceMigrationUrl,
      PHASE3_REHEARSAL_DATABASE,
    ),
    rehearsalRuntimeUrl: withDatabaseName(
      sourceRuntimeUrl,
      PHASE3_REHEARSAL_DATABASE,
    ),
    e2eMigrationUrl: withDatabaseName(sourceMigrationUrl, PHASE3_E2E_DATABASE),
    e2eRuntimeUrl: withDatabaseName(sourceRuntimeUrl, PHASE3_E2E_DATABASE),
  };
}

export function assertExactPhase3TestDatabase(
  databaseUrl: string,
  expected: typeof PHASE3_REHEARSAL_DATABASE | typeof PHASE3_E2E_DATABASE,
): void {
  requireLocalDatabaseUrl(databaseUrl, "Phase 3 test database URL");
  if (databaseName(databaseUrl) !== expected) {
    throw new Error(`Refusing mutation outside the ${expected} database.`);
  }
}

export function withDatabaseName(value: string, name: string): string {
  const url = new URL(value);
  url.pathname = `/${name}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function databaseName(value: string): string {
  return decodeURIComponent(new URL(value).pathname.slice(1));
}

export function databaseUser(value: string): string {
  return decodeURIComponent(new URL(value).username);
}

function requireLocalDatabaseUrl(
  value: string | undefined,
  variableName: string,
): string {
  if (!value) throw new Error(`${variableName} is required.`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid local PostgreSQL URL.`);
  }
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    url.pathname.length <= 1 ||
    !url.username
  ) {
    throw new Error(
      `${variableName} must target a named local PostgreSQL database.`,
    );
  }
  return value;
}
