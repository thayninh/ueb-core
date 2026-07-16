import {
  PHASE_4_BUSINESS_FIELDS,
  PHASE_4_EDITABLE_FIELDS,
  PHASE_4_READ_ONLY_FIELDS,
} from "../../../config/phase-4/workflow-policy";

import type {
  BusinessFieldName,
  EditableBusinessFieldName,
  ReadOnlyBusinessFieldName,
} from "./types";

export const BUSINESS_FIELD_NAMES = PHASE_4_BUSINESS_FIELDS;
export const READ_ONLY_BUSINESS_FIELD_NAMES = PHASE_4_READ_ONLY_FIELDS;
export const EDITABLE_BUSINESS_FIELD_NAMES = PHASE_4_EDITABLE_FIELDS;

const BUSINESS_FIELD_SET = new Set<string>(BUSINESS_FIELD_NAMES);
const READ_ONLY_FIELD_SET = new Set<string>(READ_ONLY_BUSINESS_FIELD_NAMES);
const EDITABLE_FIELD_SET = new Set<string>(EDITABLE_BUSINESS_FIELD_NAMES);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function isBusinessFieldName(
  value: unknown,
): value is BusinessFieldName {
  return typeof value === "string" && BUSINESS_FIELD_SET.has(value);
}

export function isEditableBusinessField(
  value: unknown,
): value is EditableBusinessFieldName {
  return typeof value === "string" && EDITABLE_FIELD_SET.has(value);
}

export function isReadOnlyBusinessField(
  value: unknown,
): value is ReadOnlyBusinessFieldName {
  return typeof value === "string" && READ_ONLY_FIELD_SET.has(value);
}

export function assertValidFieldPolicy(): void {
  if (BUSINESS_FIELD_NAMES.length !== 20) {
    throw new Error("Workflow field policy must contain 20 business fields");
  }
  if (READ_ONLY_BUSINESS_FIELD_NAMES.length !== 6) {
    throw new Error("Workflow field policy must contain 6 read-only fields");
  }
  if (EDITABLE_BUSINESS_FIELD_NAMES.length !== 14) {
    throw new Error("Workflow field policy must contain 14 editable fields");
  }
  if (
    hasDuplicates(BUSINESS_FIELD_NAMES) ||
    hasDuplicates(READ_ONLY_BUSINESS_FIELD_NAMES) ||
    hasDuplicates(EDITABLE_BUSINESS_FIELD_NAMES)
  ) {
    throw new Error("Workflow field policy cannot contain duplicate fields");
  }
  if (
    READ_ONLY_BUSINESS_FIELD_NAMES.some((field) =>
      EDITABLE_FIELD_SET.has(field),
    )
  ) {
    throw new Error("Workflow field groups must not overlap");
  }

  const classifiedFields = new Set<string>([
    ...READ_ONLY_BUSINESS_FIELD_NAMES,
    ...EDITABLE_BUSINESS_FIELD_NAMES,
  ]);
  if (
    classifiedFields.size !== BUSINESS_FIELD_SET.size ||
    [...classifiedFields].some((field) => !BUSINESS_FIELD_SET.has(field)) ||
    [...BUSINESS_FIELD_SET].some((field) => !classifiedFields.has(field))
  ) {
    throw new Error(
      "Workflow field groups must exactly partition the business fields",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickExactFields(
  input: unknown,
  allowedFields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!isRecord(input) || Object.getOwnPropertySymbols(input).length > 0) {
    throw new TypeError(`${label} must be a plain string-keyed object`);
  }

  const allowed = new Set(allowedFields);
  const inputKeys = Object.keys(input);
  const hasUnexpected = inputKeys.some((field) => !allowed.has(field));
  const hasMissing = allowedFields.some(
    (field) => !Object.prototype.hasOwnProperty.call(input, field),
  );

  if (
    hasUnexpected ||
    hasMissing ||
    inputKeys.length !== allowedFields.length
  ) {
    throw new TypeError(`${label} must contain exactly its allowed fields`);
  }

  return Object.fromEntries(
    allowedFields.map((field) => [field, input[field]]),
  );
}

export function pickBusinessFields(input: unknown): Record<string, unknown> {
  return pickExactFields(input, BUSINESS_FIELD_NAMES, "Business payload");
}

export function pickEditableFields(input: unknown): Record<string, unknown> {
  return pickExactFields(
    input,
    EDITABLE_BUSINESS_FIELD_NAMES,
    "Editable payload",
  );
}

assertValidFieldPolicy();
