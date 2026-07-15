import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

const columnMappingSchema = z.object({
  position: z.number().int().positive(),
  excel_header: z.string(),
  postgresql_column: z.string().regex(/^[a-z][a-z0-9_]*$/u),
  source_cell_type: z.enum(["number", "string"]).optional(),
  logical_type: z.enum(["integer", "text"]).optional(),
  postgresql_type: z.enum(["integer", "text"]),
  nullable: z.boolean(),
  unique: z.boolean(),
  coercion: z.literal("FORBIDDEN").optional(),
  integer_only: z.literal(true).optional(),
  postgresql_integer_range: z
    .object({
      minimum: z.number().int(),
      maximum: z.number().int(),
    })
    .optional(),
  expected_current_minimum: z.number().int().optional(),
  expected_current_maximum: z.number().int().optional(),
});

const sourceContractSchema = z.object({
  contract_version: z.string().min(1),
  source_filename: z.string().min(1),
  source_sha256: sha256Schema,
  sheet_name: z.string().min(1),
  exact_business_column_count: z.number().int().positive(),
  exact_header_order: z.array(z.string()),
  column_mapping: z.array(columnMappingSchema),
  expected_data_row_count: z.number().int().nonnegative(),
  stt: z.object({
    expected_min: z.number().int(),
    expected_max: z.number().int(),
    expected_distinct: z.number().int().nonnegative(),
    expected_missing_within_range_count: z.number().int().nonnegative(),
    expected_missing_within_range: z.array(z.number().int()),
    expected_next: z.number().int(),
    duplicate_count: z.number().int().nonnegative(),
    renumbering_policy: z.literal("FORBIDDEN"),
    reuse_missing_stt_policy: z.literal("FORBIDDEN"),
  }),
  expected_warning_counts: z.object({
    missing_staff_code_and_email_rows: z.number().int().nonnegative(),
    duplicate_business_groups: z.number().int().nonnegative(),
    duplicate_business_rows: z.number().int().nonnegative(),
    staff_name_variant_groups: z.number().int().nonnegative(),
    course_name_variant_groups: z.number().int().nonnegative(),
  }),
  expected_invalid_date_count: z.number().int().nonnegative(),
  expected_formula_cell_count: z.number().int().nonnegative(),
  expected_error_cell_count: z.number().int().nonnegative(),
  blank_cell_policy: z.object({
    excel_blank_cell: z.literal("SQL_NULL"),
    empty_text: z.literal("PRESERVE_AS_EMPTY_TEXT"),
    whitespace_only_text: z.literal("PRESERVE_EXACTLY"),
  }),
  text_preservation_policy: z.object({
    trim: z.literal("FORBIDDEN"),
    case_conversion: z.literal("FORBIDDEN"),
    stored_value_unicode_normalization: z.literal("FORBIDDEN"),
    business_value_rewrite: z.literal("FORBIDDEN"),
  }),
  date_text_policy: z.object({
    postgresql_type: z.literal("text"),
    blank_allowed: z.literal(true),
    expected_checked_cell_count: z.number().int().positive(),
    accepted_date_format: z.literal("DD/MM/YYYY"),
    calendar_date_must_exist: z.literal(true),
    automatic_conversion: z.literal("FORBIDDEN"),
    date_only_headers: z.array(z.string()),
    date_or_status_headers: z.array(z.string()),
    accepted_status_text: z.string(),
  }),
  formula_policy: z.object({
    allowed: z.literal(false),
    on_formula_cell: z.literal("REJECT_SOURCE"),
  }),
  duplicate_policy: z.object({
    action: z.literal("PRESERVE_ALL_ROWS"),
    automatic_delete: z.literal("FORBIDDEN"),
    automatic_merge: z.literal("FORBIDDEN"),
    automatic_deduplication: z.literal("FORBIDDEN"),
  }),
  staff_code_policy: z.object({
    postgresql_type: z.literal("text"),
    blank_cell: z.literal("SQL_NULL"),
    trim: z.literal("FORBIDDEN"),
    case_conversion: z.literal("FORBIDDEN"),
    synthesis: z.literal("FORBIDDEN"),
  }),
});

export type SourceContract = z.infer<typeof sourceContractSchema>;
export type SourceColumn = SourceContract["column_mapping"][number];

export const DEFAULT_SOURCE_CONTRACT_PATH = resolve(
  "config",
  "phase-2",
  "source-contract.json",
);

export async function loadSourceContract(
  contractPath = DEFAULT_SOURCE_CONTRACT_PATH,
): Promise<SourceContract> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(contractPath, "utf8"));
  } catch {
    throw new SourceContractError(
      "SOURCE_CONTRACT_UNREADABLE",
      "Source contract cannot be read as JSON.",
    );
  }

  const parsed = sourceContractSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SourceContractError(
      "SOURCE_CONTRACT_INVALID",
      "Source contract does not match the required Phase 2 structure.",
    );
  }

  assertContractConsistency(parsed.data);
  return parsed.data;
}

export function assertContractConsistency(contract: SourceContract): void {
  const columns = contract.column_mapping;
  const expectedPositions = Array.from(
    { length: contract.exact_business_column_count },
    (_, index) => index + 1,
  );

  if (
    columns.length !== contract.exact_business_column_count ||
    contract.exact_header_order.length !==
      contract.exact_business_column_count ||
    JSON.stringify(columns.map((column) => column.position)) !==
      JSON.stringify(expectedPositions) ||
    JSON.stringify(columns.map((column) => column.excel_header)) !==
      JSON.stringify(contract.exact_header_order)
  ) {
    throw new SourceContractError(
      "SOURCE_CONTRACT_COLUMN_MISMATCH",
      "Source contract column count, positions, mapping, and headers must align exactly.",
    );
  }

  if (
    new Set(columns.map((column) => column.postgresql_column)).size !==
      columns.length ||
    new Set(columns.map((column) => column.excel_header)).size !==
      columns.length
  ) {
    throw new SourceContractError(
      "SOURCE_CONTRACT_DUPLICATE_COLUMN",
      "Source contract headers and PostgreSQL columns must be unique.",
    );
  }

  const stt = columns[0];
  if (
    stt?.excel_header !== "stt" ||
    stt.postgresql_column !== "stt" ||
    stt.postgresql_type !== "integer" ||
    stt.nullable ||
    !stt.unique
  ) {
    throw new SourceContractError(
      "SOURCE_CONTRACT_STT_INVALID",
      "The first source-contract column must be the non-null unique integer stt.",
    );
  }

  const staffCode = columns.find(
    (column) => column.postgresql_column === "ma_so_can_bo",
  );
  if (!staffCode || staffCode.postgresql_type !== "text") {
    throw new SourceContractError(
      "SOURCE_CONTRACT_STAFF_CODE_INVALID",
      "ma_so_can_bo must be mapped as text.",
    );
  }

  const knowledgeBlock = columns.find(
    (column) => column.postgresql_column === "khoi_kien_thuc",
  );
  if (
    !knowledgeBlock ||
    knowledgeBlock.source_cell_type !== "number" ||
    knowledgeBlock.logical_type !== "integer" ||
    knowledgeBlock.postgresql_type !== "integer" ||
    knowledgeBlock.nullable ||
    knowledgeBlock.unique ||
    knowledgeBlock.coercion !== "FORBIDDEN" ||
    knowledgeBlock.integer_only !== true ||
    knowledgeBlock.postgresql_integer_range?.minimum !== -2_147_483_648 ||
    knowledgeBlock.postgresql_integer_range.maximum !== 2_147_483_647 ||
    knowledgeBlock.expected_current_minimum !== 1 ||
    knowledgeBlock.expected_current_maximum !== 5
  ) {
    throw new SourceContractError(
      "SOURCE_CONTRACT_KNOWLEDGE_BLOCK_INVALID",
      "khoi_kien_thuc must use the approved non-null integer source policy.",
    );
  }

  const dateHeaders = [
    ...contract.date_text_policy.date_only_headers,
    ...contract.date_text_policy.date_or_status_headers,
  ];
  if (
    dateHeaders.length === 0 ||
    new Set(dateHeaders).size !== dateHeaders.length ||
    dateHeaders.some(
      (header) =>
        !contract.exact_header_order.includes(header) ||
        columns.find((column) => column.excel_header === header)
          ?.postgresql_type !== "text",
    ) ||
    contract.date_text_policy.expected_checked_cell_count !==
      dateHeaders.length * contract.expected_data_row_count
  ) {
    throw new SourceContractError(
      "SOURCE_CONTRACT_DATE_POLICY_INVALID",
      "Date policy headers and expected checked-cell count must cover the approved source exactly.",
    );
  }
}

export class SourceContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SourceContractError";
  }
}
