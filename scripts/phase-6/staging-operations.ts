import { pathToFileURL } from "node:url";

import {
  backupStaging,
  clearStaleStagingRestoreLock,
  cleanupStagingBackups,
  cleanupStagingRestore,
  restoreStagingRehearsal,
  verifyStagingBackup,
} from "./lib/staging-backup";
import {
  bootstrapStagingDatabase,
  bootstrapStagingRole,
  fingerprintStaging,
  formatSecurityReport,
  grantStagingProvisioningPermissions,
  grantStagingRuntimePermissions,
  verifyStagingSecurity,
} from "./lib/staging-database";
import {
  parseDeploymentPreflightCommand,
  parseRollbackCommand,
  runDeploymentPreflight,
  formatRollbackReport,
  verifyRollbackImage,
} from "./lib/staging-deployment";
import {
  assertExactArguments,
  assertExternalArtifactPath,
  assertProductionStagingDatabase,
  assertStagingRestoreDatabase,
  normalizeArguments,
  parseBackupCommand,
  parseClearStaleRestoreLockCommand,
  parseCleanupBackupsCommand,
  parseCleanupRestoreCommand,
  parseConfirmedTargetCommand,
  parseRestoreCommand,
  SafePhase6StagingError,
  STAGING_DATABASE,
  STAGING_RESTORE_DATABASE_PREFIX,
  valuesFor,
  withDatabaseName,
} from "./lib/staging-contracts";

type Operation =
  | "bootstrap-database"
  | "bootstrap-runtime-role"
  | "bootstrap-provisioning-role"
  | "grant-runtime-permissions"
  | "grant-provisioning-permissions"
  | "verify-security"
  | "fingerprint"
  | "backup"
  | "verify-backup"
  | "cleanup-backups"
  | "restore-rehearsal"
  | "verify-restore"
  | "cleanup-restore"
  | "clear-stale-restore-lock"
  | "deployment-preflight"
  | "verify-rollback-image";

const OPERATIONS = new Set<Operation>([
  "bootstrap-database",
  "bootstrap-runtime-role",
  "bootstrap-provisioning-role",
  "grant-runtime-permissions",
  "grant-provisioning-permissions",
  "verify-security",
  "fingerprint",
  "backup",
  "verify-backup",
  "cleanup-backups",
  "restore-rehearsal",
  "verify-restore",
  "cleanup-restore",
  "clear-stale-restore-lock",
  "deployment-preflight",
  "verify-rollback-image",
]);

async function main(): Promise<void> {
  const operation = process.argv[2] as Operation | undefined;
  if (!operation || !OPERATIONS.has(operation)) {
    fail("UNKNOWN");
    return;
  }
  const args = process.argv.slice(3);
  try {
    switch (operation) {
      case "bootstrap-database": {
        const command = parseConfirmedTargetCommand({
          arguments_: args,
          confirmation: "--confirm-create-staging-database",
        });
        const result = await bootstrapStagingDatabase({
          environment: process.env,
          expectedDatabase: command.expectedDatabase as typeof STAGING_DATABASE,
        });
        print([
          `TARGET_DATABASE=${command.expectedDatabase}`,
          `DATABASE_OWNER=${result.databaseOwner}`,
          `BOOTSTRAP_CAN_SET_OWNER_ROLE=${result.bootstrapCanSetOwnerRoleBeforeCreate ? "YES" : "NO"}`,
          `BOOTSTRAP_OWNER_MEMBERSHIP_RETAINED=${result.temporaryMembershipRevoked ? "NO" : "YES"}`,
          `BOOTSTRAP_CAN_SET_OWNER_ROLE_AFTER=${result.bootstrapCanSetOwnerRoleAfter ? "YES" : "NO"}`,
          `MIGRATION_COUNT=${result.migrationCount}`,
          "PENDING_MIGRATIONS=0",
          "USERS_PROVISIONED=0",
          "APPLICATION_SESSIONS_CREATED=0",
          "STAGING_DATABASE_BOOTSTRAP=PASS",
        ]);
        break;
      }
      case "bootstrap-runtime-role": {
        const command = parseConfirmedTargetCommand({
          arguments_: args,
          confirmation: "--confirm-bootstrap-staging-runtime-role",
        });
        assertEnvironmentDatabase(command.expectedDatabase);
        const result = await bootstrapStagingRole({
          environment: process.env,
          role: "runtime",
        });
        print([
          `TARGET_DATABASE=${command.expectedDatabase}`,
          `RUNTIME_ROLE=${result.roleName}`,
          "STAGING_RUNTIME_ROLE_BOOTSTRAP=PASS",
        ]);
        break;
      }
      case "bootstrap-provisioning-role": {
        const command = parseConfirmedTargetCommand({
          arguments_: args,
          confirmation: "--confirm-bootstrap-staging-provisioning-role",
        });
        assertEnvironmentDatabase(command.expectedDatabase);
        const result = await bootstrapStagingRole({
          environment: process.env,
          role: "provisioner",
        });
        print([
          `TARGET_DATABASE=${command.expectedDatabase}`,
          `PROVISIONING_ROLE=${result.roleName}`,
          "STAGING_PROVISIONING_ROLE_BOOTSTRAP=PASS",
        ]);
        break;
      }
      case "grant-runtime-permissions": {
        const command = parseConfirmedTargetCommand({
          arguments_: args,
          confirmation: "--confirm-staging-runtime-grants",
        });
        assertEnvironmentDatabase(command.expectedDatabase);
        await grantStagingRuntimePermissions({ environment: process.env });
        print([
          `TARGET_DATABASE=${command.expectedDatabase}`,
          "STAGING_RUNTIME_ACL=PASS",
        ]);
        break;
      }
      case "grant-provisioning-permissions": {
        const command = parseConfirmedTargetCommand({
          arguments_: args,
          confirmation: "--confirm-staging-provisioning-grants",
        });
        assertEnvironmentDatabase(command.expectedDatabase);
        await grantStagingProvisioningPermissions({ environment: process.env });
        print([
          `TARGET_DATABASE=${command.expectedDatabase}`,
          "STAGING_PROVISIONING_ACL=PASS",
        ]);
        break;
      }
      case "verify-security": {
        const command = parseReadOnlyTarget(args);
        assertEnvironmentDatabase(command.expectedDatabase);
        const report = await verifyStagingSecurity({
          environment: process.env,
        });
        console.log(formatSecurityReport(report));
        break;
      }
      case "fingerprint": {
        const command = parseReadOnlyTarget(args);
        assertEnvironmentDatabase(command.expectedDatabase);
        const report = await fingerprintStaging({ environment: process.env });
        print([
          `STAGING_DATABASE_FINGERPRINT=${report.sha256}`,
          "DATABASE_WRITES=0",
          "FINGERPRINT_STATUS=PASS",
        ]);
        break;
      }
      case "backup": {
        const command = parseBackupCommand(args);
        const report = await backupStaging({
          environment: process.env,
          outputPath: command.outputPath,
        });
        print([
          `TARGET_DATABASE=${command.expectedDatabase}`,
          "BACKUP_FORMAT=CUSTOM",
          `BACKUP_SHA256=${report.checksum}`,
          "BACKUP_CATALOG_VALID=YES",
          `BACKUP_MODE=${report.mode}`,
          "BACKUP_STATUS=PASS",
        ]);
        break;
      }
      case "verify-backup": {
        const command = parseVerifyBackup(args);
        const report = await verifyStagingBackup(command);
        print([
          `BACKUP_SHA256=${report.checksum}`,
          "BACKUP_CATALOG_VALID=YES",
          "BACKUP_VERIFY=PASS",
        ]);
        break;
      }
      case "cleanup-backups": {
        const command = parseCleanupBackupsCommand(args);
        const report = await cleanupStagingBackups({
          backupDirectory: command.backupDirectory,
        });
        print([
          `BACKUPS_DELETED=${report.deleted}`,
          `BACKUPS_RETAINED=${report.retained}`,
          "BACKUP_CLEANUP=PASS",
        ]);
        break;
      }
      case "restore-rehearsal": {
        const command = parseRestoreCommand(args);
        const result = await restoreStagingRehearsal({
          environment: process.env,
          backupPath: command.backupPath,
          targetDatabase: command.targetDatabase,
        });
        print([
          `SOURCE_DATABASE=${command.sourceDatabase}`,
          `TARGET_DATABASE=${command.targetDatabase}`,
          `SOURCE_FINGERPRINT=${result.sourceFingerprint}`,
          `RESTORED_FINGERPRINT=${result.restoredFingerprint}`,
          `RESTORE_DATABASE_OWNER=${result.databaseOwner}`,
          `RESTORE_BOOTSTRAP_CAN_SET_OWNER_ROLE_BEFORE_CREATE=${result.restoreBootstrapCanSetOwnerRoleBeforeCreate ? "YES" : "NO"}`,
          `TEMPORARY_MEMBERSHIP_REVOKED=${result.temporaryMembershipRevoked ? "YES" : "NO"}`,
          `RESTORE_BOOTSTRAP_CAN_SET_OWNER_ROLE_AFTER=${result.restoreBootstrapCanSetOwnerRoleAfter ? "YES" : "NO"}`,
          `SOURCE_STAGING_FINGERPRINT_UNCHANGED=${result.sourceFingerprintUnchanged ? "YES" : "NO"}`,
          `SOURCE_RESTORE_FINGERPRINT_MATCH=${result.sourceRestoreFingerprintMatch ? "YES" : "NO"}`,
          "RESTORE_REHEARSAL=PASS",
        ]);
        break;
      }
      case "verify-restore": {
        const command = parseVerifyRestore(args);
        const environment = rewriteEnvironmentDatabase(
          process.env,
          command.targetDatabase,
        );
        const [fingerprint, security] = await Promise.all([
          fingerprintStaging({
            environment,
            databaseUrl: environment.MIGRATION_DATABASE_URL,
            expectedDatabase: command.targetDatabase,
          }),
          verifyStagingSecurity({ environment, allowRestore: true }),
        ]);
        print([
          `TARGET_DATABASE=${command.targetDatabase}`,
          `RESTORE_FINGERPRINT=${fingerprint.sha256}`,
          `RESTORE_SECURITY_VERIFY=${security.securityVerify}`,
          "DATABASE_WRITES=0",
          "RESTORE_VERIFY=PASS",
        ]);
        break;
      }
      case "cleanup-restore": {
        const command = parseCleanupRestoreCommand(args);
        const result = await cleanupStagingRestore({
          environment: process.env,
          targetDatabase: command.targetDatabase,
          backupPath: command.backupPath,
        });
        print([
          `TARGET_DATABASE=${command.targetDatabase}`,
          `CLEANUP_CAN_SET_OWNER_ROLE_BEFORE_DROP=${result.cleanupCanSetOwnerRoleBeforeDrop ? "YES" : "NO"}`,
          `TEMPORARY_MEMBERSHIP_REVOKED=${result.temporaryMembershipRevoked ? "YES" : "NO"}`,
          `CLEANUP_CAN_SET_OWNER_ROLE_AFTER=${result.cleanupCanSetOwnerRoleAfter ? "YES" : "NO"}`,
          `ACTIVE_RESTORE_PROCESS=${result.activeRestoreProcess ? "YES" : "NO"}`,
          `ACTIVE_CONNECTION_COUNT=${result.activeConnectionCount}`,
          `RESTORE_TARGET_EXISTS_AFTER=${result.targetExistsAfter ? "YES" : "NO"}`,
          `RESTORE_LOCK_STATUS=${result.restoreLockCleared ? "CLEARED" : "PRESENT"}`,
          "RESTORE_CLEANUP=PASS",
        ]);
        break;
      }
      case "clear-stale-restore-lock": {
        const command = parseClearStaleRestoreLockCommand(args);
        await clearStaleStagingRestoreLock({
          environment: process.env,
          targetDatabase: command.targetDatabase,
          backupPath: command.backupPath,
        });
        print([
          `TARGET_DATABASE=${command.targetDatabase}`,
          "RESTORE_TARGET_DATABASE=ABSENT",
          "ACTIVE_RESTORE_PROCESS=NO",
          "RESTORE_LOCK_CLEANUP=PASS",
        ]);
        break;
      }
      case "deployment-preflight": {
        const command = parseDeploymentPreflightCommand(args);
        await runDeploymentPreflight({ command, environment: process.env });
        print([
          `TARGET_HOST=${command.targetHost}`,
          `TARGET_DATABASE=${command.targetDatabase}`,
          `IMAGE_ARCHIVE_SHA256=${command.archiveSha256}`,
          `IMAGE_ID=${command.imageId}`,
          `OPERATOR_IMAGE_ARCHIVE_SHA256=${command.operatorArchiveSha256}`,
          `OPERATOR_IMAGE_ID=${command.operatorImageId}`,
          "SSH_MUTATIONS=0",
          "STAGING_DEPLOYMENT_PREFLIGHT=PASS",
        ]);
        break;
      }
      case "verify-rollback-image": {
        const command = parseRollbackCommand(args);
        const report = await verifyRollbackImage({
          command,
          environment: process.env,
        });
        console.log(formatRollbackReport(report));
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof SafePhase6StagingError)) {
      // Keep output redacted even for unexpected dependency errors.
    }
    fail(operation.toUpperCase().replaceAll("-", "_"));
  }
}

function parseReadOnlyTarget(args: readonly string[]): {
  readonly expectedDatabase: string;
} {
  const normalized = normalizeArguments(args);
  assertExactArguments(normalized, [], ["--expected-database="]);
  const databases = valuesFor(normalized, "--expected-database=");
  if (databases.length !== 1) {
    throw new SafePhase6StagingError(
      "Exactly one staging database is required.",
    );
  }
  assertProductionStagingDatabase(databases[0]!);
  return { expectedDatabase: databases[0]! };
}

function parseVerifyBackup(args: readonly string[]): {
  readonly backupPath: string;
  readonly recordOffHostCopy: boolean;
} {
  const normalized = normalizeArguments(args);
  const record = normalized.includes("--record-off-host-copy");
  const confirmation = "--confirm-record-off-host-copy";
  assertExactArguments(
    normalized,
    ["--record-off-host-copy", confirmation],
    ["--backup="],
  );
  const backups = valuesFor(normalized, "--backup=");
  if (
    backups.length !== 1 ||
    (record && !normalized.includes(confirmation)) ||
    (!record && normalized.includes(confirmation))
  ) {
    throw new SafePhase6StagingError(
      "Backup verification arguments are invalid.",
    );
  }
  return {
    backupPath: assertExternalArtifactPath(backups[0]!, ".dump"),
    recordOffHostCopy: record,
  };
}

function parseVerifyRestore(args: readonly string[]): {
  readonly targetDatabase: string;
} {
  const normalized = normalizeArguments(args);
  assertExactArguments(normalized, [], ["--target-database="]);
  const targets = valuesFor(normalized, "--target-database=");
  if (targets.length !== 1) {
    throw new SafePhase6StagingError("Exactly one restore target is required.");
  }
  assertStagingRestoreDatabase(targets[0]!);
  return { targetDatabase: targets[0]! };
}

function assertEnvironmentDatabase(expectedDatabase: string): void {
  if (
    (process.env.STAGING_EXPECTED_DATABASE ?? STAGING_DATABASE) !==
    expectedDatabase
  ) {
    throw new SafePhase6StagingError(
      "Environment database does not match the confirmed command target.",
    );
  }
}

function rewriteEnvironmentDatabase(
  environment: NodeJS.ProcessEnv,
  database: string,
): NodeJS.ProcessEnv {
  if (!database.startsWith(STAGING_RESTORE_DATABASE_PREFIX)) {
    throw new SafePhase6StagingError("Restore verification target is invalid.");
  }
  const rewrite = (value: string | undefined) =>
    value ? withDatabaseName(value, database) : value;
  return {
    ...environment,
    STAGING_EXPECTED_DATABASE: database,
    MIGRATION_DATABASE_URL: rewrite(environment.MIGRATION_DATABASE_URL),
    DATABASE_URL: rewrite(environment.DATABASE_URL),
    PHASE6_PROVISIONING_DATABASE_URL: rewrite(
      environment.PHASE6_PROVISIONING_DATABASE_URL,
    ),
  };
}

function print(lines: readonly string[]): void {
  console.log([...lines, "SECRETS_PRINTED=NO"].join("\n"));
}

function fail(operation: string): void {
  console.error(`${operation}=FAIL\nSECRETS_PRINTED=NO`);
  process.exitCode = 2;
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  await main();
}
