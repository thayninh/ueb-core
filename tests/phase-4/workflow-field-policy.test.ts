// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  BUSINESS_FIELD_NAMES,
  EDITABLE_BUSINESS_FIELD_NAMES,
  READ_ONLY_BUSINESS_FIELD_NAMES,
  assertValidFieldPolicy,
  isBusinessFieldName,
  isEditableBusinessField,
  isReadOnlyBusinessField,
  pickBusinessFields,
  pickEditableFields,
} from "../../src/lib/workflow";

const EXPECTED_BUSINESS_FIELDS = [
  "stt",
  "don_vi_phu_trach_hoc_phan",
  "bo_mon_phu_trach_hoc_phan",
  "khoi_kien_thuc",
  "ma_hoc_phan",
  "ten_hoc_phan",
  "ten_giang_vien",
  "ma_so_can_bo",
  "email_tai_khoan_vnu",
  "bo_mon",
  "don_vi",
  "core_1_2_3",
  "tc1_tro_giang",
  "tc2_sh_chuyen_mon",
  "tc3_tong_hop",
  "tc3_1_nganh_tot_nghiep_phu_hop",
  "tc3_2_bien_soan_de_cuong_giao_trinh",
  "tc3_3_chu_nhiem_de_tai_nckh_lien_quan",
  "tc3_4_bai_bao_lien_quan",
  "tc4_giang_thu",
] as const;

describe("Phase 4 workflow field policy", () => {
  it("contains exactly the canonical 20 fields in stable order", () => {
    expect(BUSINESS_FIELD_NAMES).toEqual(EXPECTED_BUSINESS_FIELDS);
    expect(BUSINESS_FIELD_NAMES).toHaveLength(20);
  });

  it("contains exactly the six locked read-only fields", () => {
    expect(READ_ONLY_BUSINESS_FIELD_NAMES).toEqual([
      "stt",
      "ten_giang_vien",
      "ma_so_can_bo",
      "email_tai_khoan_vnu",
      "bo_mon",
      "don_vi",
    ]);
  });

  it("contains exactly the fourteen editable fields", () => {
    expect(EDITABLE_BUSINESS_FIELD_NAMES).toHaveLength(14);
    expect(EDITABLE_BUSINESS_FIELD_NAMES).not.toContain("stt");
    expect(EDITABLE_BUSINESS_FIELD_NAMES).toContain("khoi_kien_thuc");
  });

  it("has no overlap, missing field, extra field, or duplicate", () => {
    const readOnly = new Set<string>(READ_ONLY_BUSINESS_FIELD_NAMES);
    const editable = new Set<string>(EDITABLE_BUSINESS_FIELD_NAMES);
    const union = new Set([...readOnly, ...editable]);

    expect([...readOnly].filter((field) => editable.has(field))).toEqual([]);
    expect([...union]).toHaveLength(20);
    expect([...union].sort()).toEqual([...BUSINESS_FIELD_NAMES].sort());
    expect(new Set(BUSINESS_FIELD_NAMES).size).toBe(20);
    expect(() => assertValidFieldPolicy()).not.toThrow();
  });

  it("recognizes each field category at runtime", () => {
    expect(isBusinessFieldName("ten_hoc_phan")).toBe(true);
    expect(isEditableBusinessField("ten_hoc_phan")).toBe(true);
    expect(isReadOnlyBusinessField("ten_hoc_phan")).toBe(false);
    expect(isReadOnlyBusinessField("ten_giang_vien")).toBe(true);
  });

  it("rejects unknown fields instead of classifying them", () => {
    expect(isBusinessFieldName("record_uid")).toBe(false);
    expect(isEditableBusinessField("approval_unit")).toBe(false);
    expect(isReadOnlyBusinessField("unknown_field")).toBe(false);
  });

  it("picks exact field sets in canonical order", () => {
    const businessInput = Object.fromEntries(
      [...BUSINESS_FIELD_NAMES].reverse().map((field, index) => [field, index]),
    );
    const editableInput = Object.fromEntries(
      [...EDITABLE_BUSINESS_FIELD_NAMES]
        .reverse()
        .map((field, index) => [field, index]),
    );

    expect(Object.keys(pickBusinessFields(businessInput))).toEqual(
      BUSINESS_FIELD_NAMES,
    );
    expect(Object.keys(pickEditableFields(editableInput))).toEqual(
      EDITABLE_BUSINESS_FIELD_NAMES,
    );
  });

  it("does not silently drop missing, read-only, technical, or unknown keys", () => {
    expect(() => pickEditableFields({})).toThrow(TypeError);
    expect(() =>
      pickEditableFields({
        ...Object.fromEntries(
          EDITABLE_BUSINESS_FIELD_NAMES.map((field) => [field, null]),
        ),
        stt: 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      pickBusinessFields({
        ...Object.fromEntries(
          BUSINESS_FIELD_NAMES.map((field) => [field, null]),
        ),
        record_uid: "not-allowed",
      }),
    ).toThrow(TypeError);
  });
});
