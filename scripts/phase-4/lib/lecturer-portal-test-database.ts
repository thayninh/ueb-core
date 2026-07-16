import {
  databaseName,
  databaseUser,
  readPhase3TestDatabaseUrls,
  withDatabaseName,
} from "../../phase-3/lib/test-database";

export const PHASE4_LECTURER_PORTAL_DATABASE = "ueb_core_phase4_e2e";

const LOCAL_DATABASE_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface Phase4LecturerPortalDatabaseUrls {
  readonly migrationUrl: string;
  readonly runtimeUrl: string;
}

export function readPhase4LecturerPortalDatabaseUrls(
  environment: Readonly<Record<string, string | undefined>>,
): Phase4LecturerPortalDatabaseUrls {
  const phase3Urls = readPhase3TestDatabaseUrls(environment);
  const migrationUrl = withDatabaseName(
    phase3Urls.sourceMigrationUrl,
    PHASE4_LECTURER_PORTAL_DATABASE,
  );
  const runtimeUrl = withDatabaseName(
    phase3Urls.sourceRuntimeUrl,
    PHASE4_LECTURER_PORTAL_DATABASE,
  );
  assertExactPhase4LecturerPortalDatabase(migrationUrl);
  assertExactPhase4LecturerPortalDatabase(runtimeUrl);
  if (databaseUser(migrationUrl) === databaseUser(runtimeUrl)) {
    throw new Error(
      "Phase 4 lecturer portal migration and runtime roles must differ.",
    );
  }
  return { migrationUrl, runtimeUrl };
}

export function assertExactPhase4LecturerPortalDatabase(
  databaseUrl: string,
): void {
  const url = new URL(databaseUrl);
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !LOCAL_DATABASE_HOSTS.has(url.hostname) ||
    !url.username ||
    databaseName(databaseUrl) !== PHASE4_LECTURER_PORTAL_DATABASE
  ) {
    throw new Error(
      "Refusing mutation outside the exact local Phase 4 lecturer portal test database.",
    );
  }
}
