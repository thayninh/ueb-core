import { createHmac, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ClientBase } from "pg";

import {
  loadSourceContract,
  type SourceContract,
} from "../../phase-2/lib/source-contract";

const POSTGRES_IDENTIFIER = /^[a-z][a-z0-9_]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const DEFAULT_PRISMA_SCHEMA_PATH = resolve("prisma", "schema.prisma");
const DEFAULT_LEADER_CONFIG_PATH = resolve(
  "docs",
  "phase-0",
  "05_approval_units.csv",
);

export interface IdentityColumnMetadata {
  readonly schemaName: "public";
  readonly tableName: string;
  readonly lecturerUidColumn: string;
  readonly emailColumn: string;
  readonly lecturerNameColumn: string;
  readonly approvalUnitColumn: string;
}

export interface IdentitySourceRow {
  readonly lecturerUid: string;
  readonly email: string | null;
  readonly lecturerName: string | null;
  readonly approvalUnit: string | null;
}

export type IdentityAnomalyType =
  | "EMAIL_TO_MULTIPLE_LECTURER_UID"
  | "LECTURER_UID_TO_MULTIPLE_EMAIL"
  | "MISSING_EMAIL_FOR_LECTURER"
  | "INVALID_EMAIL"
  | "EMAIL_CASE_OR_WHITESPACE_VARIANT"
  | "LECTURER_IN_MULTIPLE_UNITS"
  | "UNIT_WITHOUT_CONFIGURED_LEADER";

export interface SafeIdentityAnomaly {
  readonly type: IdentityAnomalyType;
  readonly lecturer_uid_hash?: string;
  readonly lecturer_uid_hashes?: readonly string[];
  readonly email_hash?: string;
  readonly email_hashes?: readonly string[];
}

export interface IdentityInspectionReport {
  readonly report_version: 1;
  readonly report_type: "IDENTITY_SOURCE_INSPECTION";
  readonly status: "PASS" | "BLOCKED";
  readonly generated_at_utc: string;
  readonly source: {
    readonly database_schema: "public";
    readonly database_table: string;
    readonly transaction_mode: "READ_ONLY";
    readonly source_row_count: number;
    readonly resolved_columns: {
      readonly lecturer_uid: string;
      readonly email: string;
      readonly lecturer_name: string;
      readonly approval_unit: string;
    };
    readonly leader_configuration_present: boolean;
  };
  readonly normalization: {
    readonly comparison_only: true;
    readonly trim: true;
    readonly lowercase: true;
    readonly source_mutated: false;
  };
  readonly distinct_lecturer_uid_count: number;
  readonly distinct_normalized_email_count: number;
  readonly missing_email_lecturer_count: number;
  readonly invalid_email_count: number;
  readonly email_to_multiple_lecturer_uid_count: number;
  readonly lecturer_uid_to_multiple_email_count: number;
  readonly email_case_or_whitespace_variant_count: number;
  readonly distinct_unit_count: number;
  readonly lecturer_in_multiple_units_count: number;
  readonly unmapped_unit_leader_count: number | null;
  readonly blocking_errors: readonly SafeIdentityAnomaly[];
  readonly warnings: readonly SafeIdentityAnomaly[];
  readonly privacy: {
    readonly contains_direct_identifiers: false;
    readonly contains_email_or_lecturer_name: false;
    readonly anomaly_hash_algorithm: "HMAC_SHA256_EPHEMERAL_RUN_KEY";
    readonly anomaly_fields: readonly [
      "type",
      "lecturer_uid_hash",
      "lecturer_uid_hashes",
      "email_hash",
      "email_hashes",
    ];
  };
}

export interface UnitLeaderConfiguration {
  readonly configuredBySourceUnit: ReadonlyMap<string, boolean>;
}

export interface IdentityInspectionOptions {
  readonly metadata: IdentityColumnMetadata;
  readonly leaderConfiguration?: UnitLeaderConfiguration | null;
  readonly generatedAt?: Date;
  readonly hmacKey?: Uint8Array;
}

export async function loadIdentityColumnMetadata(
  options: {
    prismaSchemaPath?: string;
    sourceContractPath?: string;
  } = {},
): Promise<IdentityColumnMetadata> {
  const [prismaSchema, sourceContract] = await Promise.all([
    readFile(options.prismaSchemaPath ?? DEFAULT_PRISMA_SCHEMA_PATH, "utf8"),
    loadSourceContract(options.sourceContractPath),
  ]);
  const modelBody = findPrismaModelForTable(prismaSchema, "ueb_core_data");
  const emailColumn = findContractColumn(sourceContract, "email_tai_khoan_vnu");
  const lecturerNameColumn = findContractColumn(
    sourceContract,
    "ten_giang_vien",
  );

  assertPrismaModelMapsColumn(modelBody, emailColumn);
  assertPrismaModelMapsColumn(modelBody, lecturerNameColumn);

  return {
    schemaName: "public",
    tableName: "ueb_core_data",
    lecturerUidColumn: findPrismaFieldColumn(modelBody, "lecturerUid"),
    emailColumn,
    lecturerNameColumn,
    approvalUnitColumn: findPrismaFieldColumn(modelBody, "approvalUnit"),
  };
}

export async function queryIdentitySourceRows(
  client: ClientBase,
  metadata: IdentityColumnMetadata,
): Promise<IdentitySourceRow[]> {
  const query = `
    SELECT
      ${quoteIdentifier(metadata.lecturerUidColumn)}::text AS "lecturerUid",
      ${quoteIdentifier(metadata.emailColumn)} AS "email",
      ${quoteIdentifier(metadata.lecturerNameColumn)} AS "lecturerName",
      ${quoteIdentifier(metadata.approvalUnitColumn)} AS "approvalUnit"
    FROM ${quoteIdentifier(metadata.schemaName)}.${quoteIdentifier(metadata.tableName)}
  `;
  const result = await client.query<IdentitySourceRow>(query);
  return result.rows;
}

export function normalizeEmailForComparison(email: string): string {
  return email.trim().toLowerCase();
}

export function inspectIdentitySource(
  rows: readonly IdentitySourceRow[],
  options: IdentityInspectionOptions,
): IdentityInspectionReport {
  const generatedAt = options.generatedAt ?? new Date();
  const hasher = createOpaqueHasher(options.hmacKey ?? randomBytes(32));
  const lecturers = new Set<string>();
  const emailsByLecturer = new Map<string, Set<string>>();
  const lecturersByEmail = new Map<string, Set<string>>();
  const rawVariantsByEmail = new Map<string, Set<string>>();
  const unitsByLecturer = new Map<string, Set<string>>();
  const distinctUnits = new Set<string>();
  const invalidEmails = new Set<string>();

  for (const row of rows) {
    lecturers.add(row.lecturerUid);
    const lecturerEmails = getOrCreateSet(emailsByLecturer, row.lecturerUid);
    const lecturerUnits = getOrCreateSet(unitsByLecturer, row.lecturerUid);
    const rawEmail = row.email;

    if (rawEmail !== null) {
      const normalizedEmail = normalizeEmailForComparison(rawEmail);
      if (normalizedEmail.length > 0) {
        lecturerEmails.add(normalizedEmail);
        getOrCreateSet(lecturersByEmail, normalizedEmail).add(row.lecturerUid);
        getOrCreateSet(rawVariantsByEmail, normalizedEmail).add(rawEmail);
        if (!EMAIL_PATTERN.test(normalizedEmail)) {
          invalidEmails.add(normalizedEmail);
        }
      }
    }

    if (row.approvalUnit !== null && row.approvalUnit.trim().length > 0) {
      distinctUnits.add(row.approvalUnit);
      lecturerUnits.add(row.approvalUnit);
    }
  }

  const missingEmailLecturers = sortedValues(lecturers).filter(
    (lecturerUid) => (emailsByLecturer.get(lecturerUid)?.size ?? 0) === 0,
  );
  const emailToMultipleLecturers = sortedEntries(lecturersByEmail).filter(
    ([, lecturerUids]) => lecturerUids.size > 1,
  );
  const lecturerToMultipleEmails = sortedEntries(emailsByLecturer).filter(
    ([, emails]) => emails.size > 1,
  );
  const emailVariants = sortedEntries(rawVariantsByEmail).filter(
    ([, rawEmails]) => rawEmails.size > 1,
  );
  const lecturersInMultipleUnits = sortedEntries(unitsByLecturer).filter(
    ([, units]) => units.size > 1,
  );
  const unmappedUnitLeaderCount = countUnitsWithoutConfiguredLeader(
    distinctUnits,
    options.leaderConfiguration,
  );

  const blockingErrors: SafeIdentityAnomaly[] = [
    ...emailToMultipleLecturers.map(([email, lecturerUids]) => ({
      type: "EMAIL_TO_MULTIPLE_LECTURER_UID" as const,
      lecturer_uid_hashes: sortedValues(lecturerUids).map((lecturerUid) =>
        hasher.lecturerUid(lecturerUid),
      ),
      email_hash: hasher.email(email),
    })),
    ...lecturerToMultipleEmails.map(([lecturerUid, emails]) => ({
      type: "LECTURER_UID_TO_MULTIPLE_EMAIL" as const,
      lecturer_uid_hash: hasher.lecturerUid(lecturerUid),
      email_hashes: sortedValues(emails).map((email) => hasher.email(email)),
    })),
  ];
  const warnings: SafeIdentityAnomaly[] = [
    ...missingEmailLecturers.map((lecturerUid) => ({
      type: "MISSING_EMAIL_FOR_LECTURER" as const,
      lecturer_uid_hash: hasher.lecturerUid(lecturerUid),
    })),
    ...sortedValues(invalidEmails).map((email) => ({
      type: "INVALID_EMAIL" as const,
      email_hash: hasher.email(email),
    })),
    ...emailVariants.map(([email]) => ({
      type: "EMAIL_CASE_OR_WHITESPACE_VARIANT" as const,
      email_hash: hasher.email(email),
    })),
    ...lecturersInMultipleUnits.map(([lecturerUid]) => ({
      type: "LECTURER_IN_MULTIPLE_UNITS" as const,
      lecturer_uid_hash: hasher.lecturerUid(lecturerUid),
    })),
    ...Array.from({ length: unmappedUnitLeaderCount ?? 0 }, () => ({
      type: "UNIT_WITHOUT_CONFIGURED_LEADER" as const,
    })),
  ];

  return {
    report_version: 1,
    report_type: "IDENTITY_SOURCE_INSPECTION",
    status: blockingErrors.length === 0 ? "PASS" : "BLOCKED",
    generated_at_utc: generatedAt.toISOString(),
    source: {
      database_schema: options.metadata.schemaName,
      database_table: options.metadata.tableName,
      transaction_mode: "READ_ONLY",
      source_row_count: rows.length,
      resolved_columns: {
        lecturer_uid: options.metadata.lecturerUidColumn,
        email: options.metadata.emailColumn,
        lecturer_name: options.metadata.lecturerNameColumn,
        approval_unit: options.metadata.approvalUnitColumn,
      },
      leader_configuration_present: options.leaderConfiguration != null,
    },
    normalization: {
      comparison_only: true,
      trim: true,
      lowercase: true,
      source_mutated: false,
    },
    distinct_lecturer_uid_count: lecturers.size,
    distinct_normalized_email_count: lecturersByEmail.size,
    missing_email_lecturer_count: missingEmailLecturers.length,
    invalid_email_count: invalidEmails.size,
    email_to_multiple_lecturer_uid_count: emailToMultipleLecturers.length,
    lecturer_uid_to_multiple_email_count: lecturerToMultipleEmails.length,
    email_case_or_whitespace_variant_count: emailVariants.length,
    distinct_unit_count: distinctUnits.size,
    lecturer_in_multiple_units_count: lecturersInMultipleUnits.length,
    unmapped_unit_leader_count: unmappedUnitLeaderCount,
    blocking_errors: blockingErrors,
    warnings,
    privacy: {
      contains_direct_identifiers: false,
      contains_email_or_lecturer_name: false,
      anomaly_hash_algorithm: "HMAC_SHA256_EPHEMERAL_RUN_KEY",
      anomaly_fields: [
        "type",
        "lecturer_uid_hash",
        "lecturer_uid_hashes",
        "email_hash",
        "email_hashes",
      ],
    },
  };
}

export async function loadOptionalUnitLeaderConfiguration(
  configPath = DEFAULT_LEADER_CONFIG_PATH,
): Promise<UnitLeaderConfiguration | null> {
  let content: string;
  try {
    content = await readFile(configPath, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }

  const records = parseStrictCsv(content);
  const requiredHeaders = [
    "source_don_vi",
    "leader_name",
    "leader_email",
    "status",
  ];
  const header = records[0];
  if (
    !header ||
    requiredHeaders.some((requiredHeader) => !header.includes(requiredHeader))
  ) {
    throw new Error("Leader configuration is missing required columns.");
  }

  const configuredBySourceUnit = new Map<string, boolean>();
  const columnIndex = new Map(header.map((name, index) => [name, index]));
  for (const record of records.slice(1)) {
    if (record.length !== header.length) {
      throw new Error("Leader configuration has an invalid row shape.");
    }
    const sourceUnit = record[columnIndex.get("source_don_vi") ?? -1];
    if (!sourceUnit) continue;
    const leaderName = record[columnIndex.get("leader_name") ?? -1] ?? "";
    const leaderEmail = record[columnIndex.get("leader_email") ?? -1] ?? "";
    const status = record[columnIndex.get("status") ?? -1] ?? "";
    const configured =
      leaderName.trim().length > 0 &&
      leaderEmail.trim().length > 0 &&
      status.trim().length > 0 &&
      status.trim().toUpperCase() !== "PENDING_ASSIGNMENT";
    configuredBySourceUnit.set(sourceUnit, configured);
  }

  return { configuredBySourceUnit };
}

export function readRuntimeDatabaseUrl(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment.DATABASE_URL;
  if (!value) throw new Error("Runtime DATABASE_URL is required.");

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Runtime DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Runtime DATABASE_URL must use PostgreSQL.");
  }
  return value;
}

function findContractColumn(
  contract: SourceContract,
  excelHeader: string,
): string {
  const mapping = contract.column_mapping.find(
    (column) => column.excel_header === excelHeader,
  );
  if (!mapping) {
    throw new Error(
      "Required identity column is missing from source contract.",
    );
  }
  return assertSafeIdentifier(mapping.postgresql_column);
}

function findPrismaModelForTable(schema: string, tableName: string): string {
  const modelPattern = /^model\s+[A-Za-z][A-Za-z0-9_]*\s+\{([\s\S]*?)^\}/gmu;
  for (const match of schema.matchAll(modelPattern)) {
    const body = match[1];
    if (body && body.includes(`@@map("${tableName}")`)) return body;
  }
  throw new Error("Prisma schema does not map the required identity table.");
}

function findPrismaFieldColumn(modelBody: string, fieldName: string): string {
  const escapedFieldName = fieldName.replaceAll(/[$()*+.?[\\\]^{|}]/gu, "\\$&");
  const fieldLine = modelBody.match(
    new RegExp(`^\\s*${escapedFieldName}\\s+[^\\n]+$`, "mu"),
  )?.[0];
  const mappedColumn = fieldLine?.match(/@map\("([a-z][a-z0-9_]*)"\)/u)?.[1];
  if (!mappedColumn) {
    throw new Error("Prisma identity field is missing an explicit safe map.");
  }
  return assertSafeIdentifier(mappedColumn);
}

function assertPrismaModelMapsColumn(
  modelBody: string,
  columnName: string,
): void {
  if (!modelBody.includes(`@map("${columnName}")`)) {
    throw new Error(
      "Source-contract identity column is not mapped by the Prisma model.",
    );
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${assertSafeIdentifier(identifier)}"`;
}

function assertSafeIdentifier(identifier: string): string {
  if (!POSTGRES_IDENTIFIER.test(identifier)) {
    throw new Error("Unsafe PostgreSQL identifier in identity metadata.");
  }
  return identifier;
}

function createOpaqueHasher(key: Uint8Array): {
  lecturerUid(value: string): string;
  email(value: string): string;
} {
  const hash = (domain: "lecturer_uid" | "email", value: string) =>
    createHmac("sha256", key)
      .update(`ueb-core:phase-3:${domain}\0${value}`, "utf8")
      .digest("hex");
  return {
    lecturerUid: (value) => hash("lecturer_uid", value),
    email: (value) => hash("email", value),
  };
}

function countUnitsWithoutConfiguredLeader(
  units: ReadonlySet<string>,
  leaderConfiguration: UnitLeaderConfiguration | null | undefined,
): number | null {
  if (!leaderConfiguration) return null;
  return sortedValues(units).filter(
    (unit) => leaderConfiguration.configuredBySourceUnit.get(unit) !== true,
  ).length;
}

function getOrCreateSet(
  map: Map<string, Set<string>>,
  key: string,
): Set<string> {
  const current = map.get(key);
  if (current) return current;
  const created = new Set<string>();
  map.set(key, created);
  return created;
}

function sortedValues(values: ReadonlySet<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortedEntries(
  map: ReadonlyMap<string, Set<string>>,
): Array<[string, Set<string>]> {
  return [...map.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function parseStrictCsv(content: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/u, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted)
    throw new Error("Leader configuration has an unterminated quote.");
  if (field.length > 0 || record.length > 0) {
    record.push(field.replace(/\r$/u, ""));
    records.push(record);
  }
  return records.filter(
    (currentRecord) =>
      currentRecord.length > 1 || currentRecord[0]?.trim().length !== 0,
  );
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
