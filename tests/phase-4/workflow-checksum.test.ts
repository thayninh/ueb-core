// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  BUSINESS_FIELD_NAMES,
  calculateRowSubmissionChecksum,
  canonicalizeRowSubmissionPayload,
  verifyRowSubmissionChecksum,
} from "../../src/lib/workflow";

import type { RowSubmissionPayload } from "../../src/lib/workflow";

const PAYLOAD = {
  stt: 42,
  don_vi_phu_trach_hoc_phan: "Unit A",
  bo_mon_phu_trach_hoc_phan: null,
  khoi_kien_thuc: 1,
  ma_hoc_phan: "COURSE-1",
  ten_hoc_phan: "Khóa học thử",
  ten_giang_vien: "Test Lecturer",
  ma_so_can_bo: "TEST-001",
  email_tai_khoan_vnu: "lecturer@example.test",
  bo_mon: "Test Department",
  don_vi: "Test Faculty",
  core_1_2_3: "1",
  tc1_tro_giang: null,
  tc2_sh_chuyen_mon: "Yes",
  tc3_tong_hop: null,
  tc3_1_nganh_tot_nghiep_phu_hop: null,
  tc3_2_bien_soan_de_cuong_giao_trinh: "2026-01-01",
  tc3_3_chu_nhiem_de_tai_nckh_lien_quan: null,
  tc3_4_bai_bao_lien_quan: null,
  tc4_giang_thu: "No",
} as const satisfies RowSubmissionPayload;

describe("Phase 4 workflow payload checksum", () => {
  it("is deterministic for the same payload", () => {
    expect(calculateRowSubmissionChecksum(PAYLOAD)).toBe(
      calculateRowSubmissionChecksum(structuredClone(PAYLOAD)),
    );
  });

  it("returns exactly 64 lowercase hexadecimal characters", () => {
    expect(calculateRowSubmissionChecksum(PAYLOAD)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("is independent of input property order", () => {
    const reversedPayload = Object.fromEntries(
      Object.entries(PAYLOAD).reverse(),
    );

    expect(calculateRowSubmissionChecksum(reversedPayload)).toBe(
      calculateRowSubmissionChecksum(PAYLOAD),
    );
  });

  it("changes when one business field changes", () => {
    expect(
      calculateRowSubmissionChecksum({ ...PAYLOAD, ten_hoc_phan: "Changed" }),
    ).not.toBe(calculateRowSubmissionChecksum(PAYLOAD));
  });

  it("canonicalizes keys in the exact 20-field contract order", () => {
    const canonicalPayload = JSON.parse(
      canonicalizeRowSubmissionPayload(PAYLOAD),
    ) as Record<string, unknown>;

    expect(Object.keys(canonicalPayload)).toEqual(BUSINESS_FIELD_NAMES);
  });

  it("rejects technical metadata instead of including or dropping it", () => {
    expect(() =>
      calculateRowSubmissionChecksum({
        ...PAYLOAD,
        record_uid: "20000000-0000-4000-8000-000000000001",
      }),
    ).toThrow();
    expect(() =>
      canonicalizeRowSubmissionPayload({
        ...PAYLOAD,
        payload_checksum: "a".repeat(64),
      }),
    ).toThrow();
  });

  it("rejects invalid payloads before hashing", () => {
    expect(() =>
      calculateRowSubmissionChecksum({
        ...PAYLOAD,
        khoi_kien_thuc: "1",
      }),
    ).toThrow();
  });

  it("verifies valid checksums and rejects malformed or mismatched ones", () => {
    const checksum = calculateRowSubmissionChecksum(PAYLOAD);

    expect(verifyRowSubmissionChecksum(PAYLOAD, checksum)).toBe(true);
    expect(verifyRowSubmissionChecksum(PAYLOAD, "A".repeat(64))).toBe(false);
    expect(verifyRowSubmissionChecksum(PAYLOAD, "not-a-checksum")).toBe(false);
    expect(
      verifyRowSubmissionChecksum(
        { ...PAYLOAD, tc4_giang_thu: "Changed" },
        checksum,
      ),
    ).toBe(false);
  });
});
