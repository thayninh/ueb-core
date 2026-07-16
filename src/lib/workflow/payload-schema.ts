import { z } from "zod";

import { SUBMISSION_PAYLOAD_FIELD_NAMES } from "./field-policy";

import type {
  CoreBusinessRow,
  CreateNewServerDerivedFields,
  EditableBusinessFields,
  RowSubmissionPayload,
} from "./types";

const nullableBusinessTextSchema = z.string().nullable();
const sttSchema = z.number().int();
const versionNoSchema = z.number().int().min(1);

function selectSubmissionFields(
  currentRow: CoreBusinessRow,
): Record<string, unknown> {
  return Object.fromEntries(
    SUBMISSION_PAYLOAD_FIELD_NAMES.map((field) => [field, currentRow[field]]),
  );
}

const submissionPayloadShape = {
  don_vi_phu_trach_hoc_phan: nullableBusinessTextSchema,
  bo_mon_phu_trach_hoc_phan: nullableBusinessTextSchema,
  khoi_kien_thuc: z.number().int(),
  ma_hoc_phan: nullableBusinessTextSchema,
  ten_hoc_phan: nullableBusinessTextSchema,
  ten_giang_vien: nullableBusinessTextSchema,
  ma_so_can_bo: nullableBusinessTextSchema,
  email_tai_khoan_vnu: nullableBusinessTextSchema,
  bo_mon: nullableBusinessTextSchema,
  don_vi: nullableBusinessTextSchema,
  core_1_2_3: nullableBusinessTextSchema,
  tc1_tro_giang: nullableBusinessTextSchema,
  tc2_sh_chuyen_mon: nullableBusinessTextSchema,
  tc3_tong_hop: nullableBusinessTextSchema,
  tc3_1_nganh_tot_nghiep_phu_hop: nullableBusinessTextSchema,
  tc3_2_bien_soan_de_cuong_giao_trinh: nullableBusinessTextSchema,
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan: nullableBusinessTextSchema,
  tc3_4_bai_bao_lien_quan: nullableBusinessTextSchema,
  tc4_giang_thu: nullableBusinessTextSchema,
} as const;

export const rowSubmissionPayloadSchema = z
  .object(submissionPayloadShape)
  .strict() satisfies z.ZodType<RowSubmissionPayload>;

const coreBusinessRowSchema = z
  .object({
    stt: sttSchema,
    ...submissionPayloadShape,
  })
  .strict() satisfies z.ZodType<CoreBusinessRow>;

const editableBusinessFieldsSchema = z
  .object({
    don_vi_phu_trach_hoc_phan: nullableBusinessTextSchema,
    bo_mon_phu_trach_hoc_phan: nullableBusinessTextSchema,
    khoi_kien_thuc: z.number().int(),
    ma_hoc_phan: nullableBusinessTextSchema,
    ten_hoc_phan: nullableBusinessTextSchema,
    core_1_2_3: nullableBusinessTextSchema,
    tc1_tro_giang: nullableBusinessTextSchema,
    tc2_sh_chuyen_mon: nullableBusinessTextSchema,
    tc3_tong_hop: nullableBusinessTextSchema,
    tc3_1_nganh_tot_nghiep_phu_hop: nullableBusinessTextSchema,
    tc3_2_bien_soan_de_cuong_giao_trinh: nullableBusinessTextSchema,
    tc3_3_chu_nhiem_de_tai_nckh_lien_quan: nullableBusinessTextSchema,
    tc3_4_bai_bao_lien_quan: nullableBusinessTextSchema,
    tc4_giang_thu: nullableBusinessTextSchema,
  })
  .strict() satisfies z.ZodType<EditableBusinessFields>;

const createNewServerDerivedFieldsSchema = z
  .object({
    ten_giang_vien: nullableBusinessTextSchema,
    ma_so_can_bo: nullableBusinessTextSchema,
    email_tai_khoan_vnu: nullableBusinessTextSchema,
    bo_mon: nullableBusinessTextSchema,
    don_vi: nullableBusinessTextSchema,
  })
  .strict() satisfies z.ZodType<CreateNewServerDerivedFields>;

export const confirmUnchangedInputSchema = z
  .object({
    submissionId: z.uuid(),
    recordUid: z.uuid(),
    baseStt: sttSchema,
    baseVersionNo: versionNoSchema,
    parentSubmissionId: z.uuid().nullable().optional(),
  })
  .strict();

export const updateExistingInputSchema = z
  .object({
    submissionId: z.uuid(),
    recordUid: z.uuid(),
    baseStt: sttSchema,
    baseVersionNo: versionNoSchema,
    editableFields: editableBusinessFieldsSchema,
    parentSubmissionId: z.uuid().nullable().optional(),
  })
  .strict();

export const createNewInputSchema = z
  .object({
    submissionId: z.uuid(),
    editableFields: editableBusinessFieldsSchema,
    parentSubmissionId: z.uuid().nullable().optional(),
  })
  .strict();

export type ConfirmUnchangedInput = z.infer<typeof confirmUnchangedInputSchema>;
export type UpdateExistingInput = z.infer<typeof updateExistingInputSchema>;
export type CreateNewInput = z.infer<typeof createNewInputSchema>;

export function buildConfirmUnchangedPayload(
  currentRow: CoreBusinessRow,
): RowSubmissionPayload {
  const submittedFields = selectSubmissionFields(
    coreBusinessRowSchema.parse(currentRow),
  );

  return rowSubmissionPayloadSchema.parse(submittedFields);
}

export function buildUpdateExistingPayload(
  currentRow: CoreBusinessRow,
  editableInput: EditableBusinessFields,
): RowSubmissionPayload {
  const validatedCurrentRow = coreBusinessRowSchema.parse(currentRow);
  const validatedEditableInput =
    editableBusinessFieldsSchema.parse(editableInput);
  const submittedFields = selectSubmissionFields(validatedCurrentRow);

  return rowSubmissionPayloadSchema.parse({
    ...submittedFields,
    ...validatedEditableInput,
  });
}

export function buildCreateNewPayload(
  serverDerivedFields: CreateNewServerDerivedFields,
  editableInput: EditableBusinessFields,
): RowSubmissionPayload {
  const validatedServerFields =
    createNewServerDerivedFieldsSchema.parse(serverDerivedFields);
  const validatedEditableInput =
    editableBusinessFieldsSchema.parse(editableInput);

  return rowSubmissionPayloadSchema.parse({
    ...validatedServerFields,
    ...validatedEditableInput,
  });
}
