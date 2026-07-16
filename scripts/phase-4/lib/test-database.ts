import {
  databaseName,
  databaseUser,
  readPhase3TestDatabaseUrls,
  withDatabaseName,
} from "../../phase-3/lib/test-database";

export const PHASE4_REHEARSAL_DATABASE = "ueb_core_phase4_rehearsal";

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface Phase4TestDatabaseUrls {
  readonly migrationUrl: string;
  readonly runtimeUrl: string;
}

/**
 * Reuses the Phase 3 local-host and split-role safety validation, then derives
 * one exact Phase 4-only database target. This function never connects to the
 * source database named in the environment.
 */
export function readPhase4TestDatabaseUrls(
  environment: Readonly<Record<string, string | undefined>>,
): Phase4TestDatabaseUrls {
  const phase3Urls = readPhase3TestDatabaseUrls(environment);
  const migrationUrl = withDatabaseName(
    phase3Urls.sourceMigrationUrl,
    PHASE4_REHEARSAL_DATABASE,
  );
  const runtimeUrl = withDatabaseName(
    phase3Urls.sourceRuntimeUrl,
    PHASE4_REHEARSAL_DATABASE,
  );

  assertExactPhase4TestDatabase(migrationUrl);
  assertExactPhase4TestDatabase(runtimeUrl);
  if (databaseUser(migrationUrl) === databaseUser(runtimeUrl)) {
    throw new Error("Phase 4 migration and runtime roles must be different.");
  }
  return { migrationUrl, runtimeUrl };
}

export function assertExactPhase4TestDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    !url.username ||
    databaseName(databaseUrl) !== PHASE4_REHEARSAL_DATABASE
  ) {
    throw new Error(
      `Refusing mutation outside the exact local ${PHASE4_REHEARSAL_DATABASE} database.`,
    );
  }
}
