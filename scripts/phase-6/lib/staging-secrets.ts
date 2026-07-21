import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  assertMonitoringEmail,
  assertRoleSeparation,
  assertStagingUrl,
  SafePhase6StagingError,
  STAGING_DATABASE,
  STAGING_DATABASE_HOST,
  STAGING_OWNER_ROLE,
  STAGING_PROVISIONING_ROLE,
  STAGING_RUNTIME_ROLE,
  STAGING_URL,
  STAGING_VPS_HOST,
} from "./staging-contracts";

export const STAGING_BOOTSTRAP_ROLE = "ueb_core_staging_bootstrap";
export const STAGING_CLUSTER_ADMIN_ROLE = "ueb_core_staging_cluster_admin";
export const STAGING_PUBLIC_URL = STAGING_URL;
export const STAGING_SECRET_FILE_NAMES = [
  "postgres-bootstrap.env",
  "database-owner.env",
  "app-runtime.env",
  "provisioner.env",
  "monitoring.env",
] as const;
export const STAGING_SECRET_MANIFEST = "secrets-manifest.json";

const SECRET_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const FORBIDDEN_SECRET_REFERENCE = /ueb_core_uat_|phase[-_]?5.*uat/iu;

type SecretFileName = (typeof STAGING_SECRET_FILE_NAMES)[number];

export interface GenerateStagingSecretsInput {
  readonly outputDirectory: string;
  readonly databaseHost: string;
  readonly databasePort: string;
  readonly databaseName: string;
  readonly publicUrl: string;
  readonly monitoringEmail: string | undefined;
  readonly repositoryDirectory?: string;
  readonly now?: Date;
}

export interface SecretValidationReport {
  readonly fileCount: number;
  readonly manifestSha256: string;
}

interface SecretManifest {
  readonly version: 1;
  readonly databaseName: typeof STAGING_DATABASE;
  readonly publicUrl: typeof STAGING_PUBLIC_URL;
  readonly generatedAt: string;
  readonly roles: {
    readonly clusterAdmin: typeof STAGING_CLUSTER_ADMIN_ROLE;
    readonly bootstrap: typeof STAGING_BOOTSTRAP_ROLE;
    readonly owner: typeof STAGING_OWNER_ROLE;
    readonly runtime: typeof STAGING_RUNTIME_ROLE;
    readonly provisioner: typeof STAGING_PROVISIONING_ROLE;
  };
  readonly files: readonly {
    readonly name: SecretFileName;
    readonly mode: "0600";
    readonly sha256: string;
  }[];
}

export async function generateStagingSecrets(
  input: GenerateStagingSecretsInput,
): Promise<SecretValidationReport> {
  assertGeneratorContract(input);
  const outputDirectory = await assertNewExternalDirectory(
    input.outputDirectory,
    input.repositoryDirectory ?? process.cwd(),
  );
  const monitoringEmail = assertMonitoringEmail(input.monitoringEmail);
  const clusterAdminPassword = randomSecret(48);
  const bootstrapPassword = randomSecret(48);
  const ownerPassword = randomSecret(48);
  const runtimePassword = randomSecret(48);
  const provisionerPassword = randomSecret(48);
  const databaseUrl = (role: string, password: string) =>
    buildDatabaseUrl({
      role,
      password,
      host: input.databaseHost,
      port: input.databasePort,
      database: STAGING_DATABASE,
    });

  const files: Readonly<Record<SecretFileName, string>> = {
    "postgres-bootstrap.env": formatEnvironment({
      POSTGRES_DB: "postgres",
      POSTGRES_USER: STAGING_CLUSTER_ADMIN_ROLE,
      POSTGRES_PASSWORD: clusterAdminPassword,
      POSTGRES_INITDB_ARGS: "--data-checksums",
      STAGING_TARGET_DATABASE: STAGING_DATABASE,
      STAGING_BOOTSTRAP_PASSWORD: bootstrapPassword,
    }),
    "database-owner.env": formatEnvironment({
      STAGING_TARGET_HOST: STAGING_VPS_HOST,
      STAGING_DATABASE_HOST: STAGING_DATABASE_HOST,
      STAGING_DATABASE_PORT: "5432",
      STAGING_EXPECTED_DATABASE: STAGING_DATABASE,
      STAGING_MIGRATION_OWNER_ROLE: STAGING_OWNER_ROLE,
      APP_DATABASE_USER: STAGING_RUNTIME_ROLE,
      PHASE6_PROVISIONING_USER: STAGING_PROVISIONING_ROLE,
      STAGING_AUTHORIZED_BOOTSTRAP_ROLE: STAGING_BOOTSTRAP_ROLE,
      STAGING_BOOTSTRAP_DATABASE_URL: databaseUrl(
        STAGING_BOOTSTRAP_ROLE,
        bootstrapPassword,
      ),
      STAGING_ROLE_ADMIN_DATABASE_URL: databaseUrl(
        STAGING_BOOTSTRAP_ROLE,
        bootstrapPassword,
      ),
      MIGRATION_DATABASE_URL: databaseUrl(STAGING_OWNER_ROLE, ownerPassword),
      STAGING_MIGRATION_OWNER_PASSWORD: ownerPassword,
      STAGING_RUNTIME_PASSWORD: runtimePassword,
      STAGING_PROVISIONING_PASSWORD: provisionerPassword,
    }),
    "app-runtime.env": formatEnvironment({
      NODE_ENV: "production",
      POSTGRES_DB: STAGING_DATABASE,
      APP_DATABASE_USER: STAGING_RUNTIME_ROLE,
      APP_DATABASE_PASSWORD: runtimePassword,
      DATABASE_URL: databaseUrl(STAGING_RUNTIME_ROLE, runtimePassword),
      BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      BETTER_AUTH_URL: STAGING_PUBLIC_URL,
      AUTH_TRUSTED_ORIGINS: STAGING_PUBLIC_URL,
      AUDIT_HMAC_SECRET: randomBytes(48).toString("hex"),
    }),
    "provisioner.env": formatEnvironment({
      PHASE6_PROVISIONING_USER: STAGING_PROVISIONING_ROLE,
      PHASE6_PROVISIONING_DATABASE_URL: databaseUrl(
        STAGING_PROVISIONING_ROLE,
        provisionerPassword,
      ),
    }),
    "monitoring.env": formatEnvironment({
      STAGING_MONITORING_EMAIL: monitoringEmail,
    }),
  };

  await mkdir(outputDirectory, { mode: DIRECTORY_MODE });
  const manifestFiles: Array<SecretManifest["files"][number]> = [];
  for (const name of STAGING_SECRET_FILE_NAMES) {
    const content = files[name];
    await writeFile(join(outputDirectory, name), content, {
      encoding: "utf8",
      mode: SECRET_MODE,
      flag: "wx",
    });
    manifestFiles.push({
      name,
      mode: "0600",
      sha256: sha256(content),
    });
  }
  const manifest: SecretManifest = {
    version: 1,
    databaseName: STAGING_DATABASE,
    publicUrl: STAGING_PUBLIC_URL,
    generatedAt: (input.now ?? new Date()).toISOString(),
    roles: {
      clusterAdmin: STAGING_CLUSTER_ADMIN_ROLE,
      bootstrap: STAGING_BOOTSTRAP_ROLE,
      owner: STAGING_OWNER_ROLE,
      runtime: STAGING_RUNTIME_ROLE,
      provisioner: STAGING_PROVISIONING_ROLE,
    },
    files: manifestFiles,
  };
  await writeFile(
    join(outputDirectory, STAGING_SECRET_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: SECRET_MODE, flag: "wx" },
  );
  return validateStagingSecrets({
    inputDirectory: outputDirectory,
    repositoryDirectory: input.repositoryDirectory,
  });
}

export async function validateStagingSecrets(input: {
  readonly inputDirectory: string;
  readonly repositoryDirectory?: string;
}): Promise<SecretValidationReport> {
  const directory = await assertExistingExternalDirectory(
    input.inputDirectory,
    input.repositoryDirectory ?? process.cwd(),
  );
  const directoryStat = await lstat(directory);
  assertMode(directoryStat.mode, DIRECTORY_MODE, "Secret directory");
  const expectedFiles = [
    ...STAGING_SECRET_FILE_NAMES,
    STAGING_SECRET_MANIFEST,
  ].sort();
  const actualFiles = (await readdir(directory)).sort();
  if (actualFiles.join("\n") !== expectedFiles.join("\n")) {
    throw new SafePhase6StagingError("Secret directory file set is invalid.");
  }

  const manifestPath = join(directory, STAGING_SECRET_MANIFEST);
  await assertRegularSecretFile(manifestPath);
  const manifestContent = await readFile(manifestPath, "utf8");
  const manifest = parseManifest(manifestContent);
  assertManifestContract(manifest);

  const environments = new Map<SecretFileName, Record<string, string>>();
  for (const expectedName of STAGING_SECRET_FILE_NAMES) {
    const manifestFile = manifest.files.find(
      (candidate) => candidate.name === expectedName,
    );
    if (!manifestFile || manifestFile.mode !== "0600") {
      throw new SafePhase6StagingError("Secret manifest file set is invalid.");
    }
    const path = join(directory, expectedName);
    await assertRegularSecretFile(path);
    const content = await readFile(path, "utf8");
    if (sha256(content) !== manifestFile.sha256) {
      throw new SafePhase6StagingError("Secret file checksum is invalid.");
    }
    if (FORBIDDEN_SECRET_REFERENCE.test(content)) {
      throw new SafePhase6StagingError(
        "A forbidden UAT credential reference was detected.",
      );
    }
    environments.set(expectedName, parseEnvironment(content));
  }
  assertEnvironmentContracts(environments);

  return {
    fileCount: STAGING_SECRET_FILE_NAMES.length + 1,
    manifestSha256: sha256(manifestContent),
  };
}

function assertGeneratorContract(input: GenerateStagingSecretsInput): void {
  assertStagingUrl(input.publicUrl);
  if (
    input.databaseHost !== STAGING_DATABASE_HOST ||
    input.databasePort !== "5432" ||
    input.databaseName !== STAGING_DATABASE
  ) {
    throw new SafePhase6StagingError(
      "Staging secret generation target does not match the approved contract.",
    );
  }
  assertRoleSeparation({
    owner: STAGING_OWNER_ROLE,
    runtime: STAGING_RUNTIME_ROLE,
    provisioner: STAGING_PROVISIONING_ROLE,
  });
}

function assertEnvironmentContracts(
  environments: ReadonlyMap<SecretFileName, Record<string, string>>,
): void {
  const postgres = requiredEnvironment(environments, "postgres-bootstrap.env");
  const owner = requiredEnvironment(environments, "database-owner.env");
  const runtime = requiredEnvironment(environments, "app-runtime.env");
  const provisioner = requiredEnvironment(environments, "provisioner.env");
  const monitoring = requiredEnvironment(environments, "monitoring.env");

  assertExactKeys(postgres, [
    "POSTGRES_DB",
    "POSTGRES_USER",
    "POSTGRES_PASSWORD",
    "POSTGRES_INITDB_ARGS",
    "STAGING_TARGET_DATABASE",
    "STAGING_BOOTSTRAP_PASSWORD",
  ]);
  if (
    postgres.POSTGRES_DB !== "postgres" ||
    postgres.POSTGRES_USER !== STAGING_CLUSTER_ADMIN_ROLE ||
    postgres.POSTGRES_INITDB_ARGS !== "--data-checksums" ||
    postgres.STAGING_TARGET_DATABASE !== STAGING_DATABASE
  ) {
    throw new SafePhase6StagingError(
      "PostgreSQL bootstrap contract is invalid.",
    );
  }
  assertSecretStrength(postgres.POSTGRES_PASSWORD, 48);
  assertSecretStrength(postgres.STAGING_BOOTSTRAP_PASSWORD, 48);

  assertExactKeys(owner, [
    "STAGING_TARGET_HOST",
    "STAGING_DATABASE_HOST",
    "STAGING_DATABASE_PORT",
    "STAGING_EXPECTED_DATABASE",
    "STAGING_MIGRATION_OWNER_ROLE",
    "APP_DATABASE_USER",
    "PHASE6_PROVISIONING_USER",
    "STAGING_AUTHORIZED_BOOTSTRAP_ROLE",
    "STAGING_BOOTSTRAP_DATABASE_URL",
    "STAGING_ROLE_ADMIN_DATABASE_URL",
    "MIGRATION_DATABASE_URL",
    "STAGING_MIGRATION_OWNER_PASSWORD",
    "STAGING_RUNTIME_PASSWORD",
    "STAGING_PROVISIONING_PASSWORD",
  ]);
  assertRoleSeparation({
    owner: owner.STAGING_MIGRATION_OWNER_ROLE ?? "",
    runtime: owner.APP_DATABASE_USER ?? "",
    provisioner: owner.PHASE6_PROVISIONING_USER ?? "",
  });
  if (
    owner.STAGING_TARGET_HOST !== STAGING_VPS_HOST ||
    owner.STAGING_DATABASE_HOST !== STAGING_DATABASE_HOST ||
    owner.STAGING_DATABASE_PORT !== "5432" ||
    owner.STAGING_EXPECTED_DATABASE !== STAGING_DATABASE ||
    owner.STAGING_AUTHORIZED_BOOTSTRAP_ROLE !== STAGING_BOOTSTRAP_ROLE
  ) {
    throw new SafePhase6StagingError("Database owner contract is invalid.");
  }
  const bootstrapPassword = assertDatabaseUrl(
    owner.STAGING_BOOTSTRAP_DATABASE_URL,
    STAGING_BOOTSTRAP_ROLE,
  );
  if (
    bootstrapPassword !== postgres.STAGING_BOOTSTRAP_PASSWORD ||
    assertDatabaseUrl(
      owner.STAGING_ROLE_ADMIN_DATABASE_URL,
      STAGING_BOOTSTRAP_ROLE,
    ) !== bootstrapPassword ||
    assertDatabaseUrl(owner.MIGRATION_DATABASE_URL, STAGING_OWNER_ROLE) !==
      owner.STAGING_MIGRATION_OWNER_PASSWORD
  ) {
    throw new SafePhase6StagingError(
      "Database credential contract is invalid.",
    );
  }
  assertSecretStrength(owner.STAGING_MIGRATION_OWNER_PASSWORD, 48);
  assertSecretStrength(owner.STAGING_RUNTIME_PASSWORD, 48);
  assertSecretStrength(owner.STAGING_PROVISIONING_PASSWORD, 48);

  const runtimeForbidden = [
    "MIGRATION_DATABASE_URL",
    "STAGING_BOOTSTRAP_DATABASE_URL",
    "STAGING_ROLE_ADMIN_DATABASE_URL",
    "PHASE6_PROVISIONING_DATABASE_URL",
    "STAGING_MIGRATION_OWNER_PASSWORD",
    "STAGING_PROVISIONING_PASSWORD",
  ];
  if (runtimeForbidden.some((key) => key in runtime)) {
    throw new SafePhase6StagingError(
      "Application runtime secret file contains an operator credential.",
    );
  }
  assertExactKeys(runtime, [
    "NODE_ENV",
    "POSTGRES_DB",
    "APP_DATABASE_USER",
    "APP_DATABASE_PASSWORD",
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "AUTH_TRUSTED_ORIGINS",
    "AUDIT_HMAC_SECRET",
  ]);
  const runtimePassword = assertDatabaseUrl(
    runtime.DATABASE_URL,
    STAGING_RUNTIME_ROLE,
  );
  if (
    runtime.NODE_ENV !== "production" ||
    runtime.APP_DATABASE_USER !== STAGING_RUNTIME_ROLE ||
    runtime.POSTGRES_DB !== STAGING_DATABASE ||
    runtime.BETTER_AUTH_URL !== STAGING_PUBLIC_URL ||
    runtime.AUTH_TRUSTED_ORIGINS !== STAGING_PUBLIC_URL ||
    !runtime.BETTER_AUTH_SECRET ||
    !runtime.AUDIT_HMAC_SECRET ||
    runtimePassword !== runtime.APP_DATABASE_PASSWORD ||
    runtimePassword !== owner.STAGING_RUNTIME_PASSWORD
  ) {
    throw new SafePhase6StagingError(
      "Application runtime contract is invalid.",
    );
  }
  assertSecretStrength(runtime.BETTER_AUTH_SECRET, 48);
  assertSecretStrength(runtime.AUDIT_HMAC_SECRET, 64);

  if (
    new Set([
      postgres.POSTGRES_PASSWORD,
      postgres.STAGING_BOOTSTRAP_PASSWORD,
      owner.STAGING_MIGRATION_OWNER_PASSWORD,
      owner.STAGING_RUNTIME_PASSWORD,
      owner.STAGING_PROVISIONING_PASSWORD,
    ]).size !== 5
  ) {
    throw new SafePhase6StagingError(
      "Database secret separation contract is invalid.",
    );
  }

  assertExactKeys(provisioner, [
    "PHASE6_PROVISIONING_USER",
    "PHASE6_PROVISIONING_DATABASE_URL",
  ]);
  if (provisioner.PHASE6_PROVISIONING_USER !== STAGING_PROVISIONING_ROLE) {
    throw new SafePhase6StagingError("Provisioning role contract is invalid.");
  }
  if (
    assertDatabaseUrl(
      provisioner.PHASE6_PROVISIONING_DATABASE_URL,
      STAGING_PROVISIONING_ROLE,
    ) !== owner.STAGING_PROVISIONING_PASSWORD
  ) {
    throw new SafePhase6StagingError(
      "Provisioning credential contract is invalid.",
    );
  }
  assertExactKeys(monitoring, ["STAGING_MONITORING_EMAIL"]);
  assertMonitoringEmail(monitoring.STAGING_MONITORING_EMAIL);
}

function assertSecretStrength(
  value: string | undefined,
  minimum: number,
): void {
  if (!value || value.length < minimum) {
    throw new SafePhase6StagingError("Generated secret strength is invalid.");
  }
}

function assertDatabaseUrl(
  value: string | undefined,
  expectedRole: string,
): string {
  if (!value) {
    throw new SafePhase6StagingError("Required database URL is missing.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SafePhase6StagingError("Database URL contract is invalid.");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    decodeURIComponent(url.username) !== expectedRole ||
    !url.password ||
    url.hostname !== STAGING_DATABASE_HOST ||
    url.port !== "5432" ||
    decodeURIComponent(url.pathname.slice(1)) !== STAGING_DATABASE
  ) {
    throw new SafePhase6StagingError("Database URL contract is invalid.");
  }
  return decodeURIComponent(url.password);
}

function buildDatabaseUrl(input: {
  readonly role: string;
  readonly password: string;
  readonly host: string;
  readonly port: string;
  readonly database: string;
}): string {
  const url = new URL("postgresql://placeholder.invalid");
  url.username = input.role;
  url.password = input.password;
  url.hostname = input.host;
  url.port = input.port;
  url.pathname = `/${input.database}`;
  return url.toString();
}

function randomSecret(bytes: number): string {
  return randomBytes(bytes).toString("base64");
}

function formatEnvironment(values: Readonly<Record<string, string>>): string {
  return `${Object.entries(values)
    .map(([key, value]) => {
      if (!/^[A-Z][A-Z0-9_]*$/u.test(key) || /[\r\n]/u.test(value)) {
        throw new SafePhase6StagingError(
          "Secret environment value is invalid.",
        );
      }
      return `${key}=${value}`;
    })
    .join("\n")}\n`;
}

function parseEnvironment(content: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const line of content.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (
      separator < 1 ||
      !/^[A-Z][A-Z0-9_]*$/u.test(key) ||
      key in environment ||
      !value
    ) {
      throw new SafePhase6StagingError("Secret environment file is invalid.");
    }
    environment[key] = value;
  }
  return environment;
}

function assertExactKeys(
  environment: Readonly<Record<string, string>>,
  expectedKeys: readonly string[],
): void {
  if (
    Object.keys(environment).sort().join("\n") !==
    [...expectedKeys].sort().join("\n")
  ) {
    throw new SafePhase6StagingError("Secret environment key set is invalid.");
  }
}

function requiredEnvironment(
  environments: ReadonlyMap<SecretFileName, Record<string, string>>,
  name: SecretFileName,
): Record<string, string> {
  const environment = environments.get(name);
  if (!environment) {
    throw new SafePhase6StagingError("Required secret file is missing.");
  }
  return environment;
}

async function assertNewExternalDirectory(
  path: string,
  repositoryDirectory: string,
): Promise<string> {
  const absolute = assertExternalPath(path, repositoryDirectory);
  if (await lstat(absolute).catch(() => undefined)) {
    throw new SafePhase6StagingError(
      "Secret output directory already exists; overwrite is forbidden.",
    );
  }
  await assertNoSymlinkComponents(dirname(absolute));
  return absolute;
}

async function assertExistingExternalDirectory(
  path: string,
  repositoryDirectory: string,
): Promise<string> {
  const absolute = assertExternalPath(path, repositoryDirectory);
  await assertNoSymlinkComponents(absolute);
  const info = await lstat(absolute).catch(() => undefined);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new SafePhase6StagingError("Secret directory is invalid.");
  }
  const canonical = await realpath(absolute);
  assertExternalPath(canonical, repositoryDirectory);
  return absolute;
}

function assertExternalPath(path: string, repositoryDirectory: string): string {
  if (!isAbsolute(path)) {
    throw new SafePhase6StagingError("Secret directory must be absolute.");
  }
  const absolute = resolve(path);
  const repository = resolve(repositoryDirectory);
  const repositoryRelative = relative(repository, absolute);
  if (
    repositoryRelative === "" ||
    (repositoryRelative !== ".." &&
      !repositoryRelative.startsWith(`..${sep}`) &&
      !isAbsolute(repositoryRelative))
  ) {
    throw new SafePhase6StagingError(
      "Secret directory must remain outside repository.",
    );
  }
  return absolute;
}

async function assertNoSymlinkComponents(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current).catch(() => undefined);
    if (!info) {
      throw new SafePhase6StagingError(
        "Secret directory parent does not exist.",
      );
    }
    if (info.isSymbolicLink()) {
      throw new SafePhase6StagingError(
        "Symbolic links are forbidden in the secret directory path.",
      );
    }
  }
}

async function assertRegularSecretFile(path: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink()) {
    throw new SafePhase6StagingError("Secret file is missing or unsafe.");
  }
  assertMode(info.mode, SECRET_MODE, "Secret file");
}

function assertMode(actual: number, expected: number, label: string): void {
  if ((actual & 0o777) !== expected) {
    throw new SafePhase6StagingError(`${label} mode is invalid.`);
  }
}

function parseManifest(content: string): SecretManifest {
  try {
    return JSON.parse(content) as SecretManifest;
  } catch {
    throw new SafePhase6StagingError("Secret manifest is invalid.");
  }
}

function assertManifestContract(manifest: SecretManifest): void {
  if (
    manifest.version !== 1 ||
    manifest.databaseName !== STAGING_DATABASE ||
    manifest.publicUrl !== STAGING_PUBLIC_URL ||
    !Number.isFinite(Date.parse(manifest.generatedAt)) ||
    manifest.roles?.clusterAdmin !== STAGING_CLUSTER_ADMIN_ROLE ||
    manifest.roles?.bootstrap !== STAGING_BOOTSTRAP_ROLE ||
    manifest.roles?.owner !== STAGING_OWNER_ROLE ||
    manifest.roles?.runtime !== STAGING_RUNTIME_ROLE ||
    manifest.roles?.provisioner !== STAGING_PROVISIONING_ROLE ||
    new Set(Object.values(manifest.roles ?? {})).size !== 5 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== STAGING_SECRET_FILE_NAMES.length ||
    new Set(manifest.files.map((file) => file.name)).size !==
      STAGING_SECRET_FILE_NAMES.length ||
    manifest.files.some(
      (file) =>
        !STAGING_SECRET_FILE_NAMES.includes(file.name) ||
        file.mode !== "0600" ||
        !/^[a-f0-9]{64}$/u.test(file.sha256),
    )
  ) {
    throw new SafePhase6StagingError("Secret manifest contract is invalid.");
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
