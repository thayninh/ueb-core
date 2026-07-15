// @vitest-environment node

import { describe, expect, it } from "vitest";

import sourceContract from "../../config/phase-2/source-contract.json";
import { SOURCE_INSPECTION_CONFIG } from "../../config/phase-2/source-inspection";

describe("Phase 2 source contract", () => {
  it("keeps exact headers and mapping aligned with inspection configuration", () => {
    expect(sourceContract.exact_business_column_count).toBe(20);
    expect(sourceContract.exact_header_order).toEqual(
      SOURCE_INSPECTION_CONFIG.expectedHeaders,
    );
    expect(
      sourceContract.column_mapping.map((column) => column.position),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(
      sourceContract.column_mapping.map((column) => column.excel_header),
    ).toEqual(sourceContract.exact_header_order);
  });

  it("uses integer unique stt and nullable text for all other business columns", () => {
    const [sttColumn, ...textColumns] = sourceContract.column_mapping;

    expect(sttColumn).toMatchObject({
      excel_header: "stt",
      postgresql_column: "stt",
      postgresql_type: "integer",
      nullable: false,
      unique: true,
    });
    expect(textColumns).toHaveLength(19);
    expect(
      textColumns.every(
        (column) =>
          column.postgresql_type === "text" &&
          column.nullable &&
          !column.unique,
      ),
    ).toBe(true);
    expect(
      sourceContract.column_mapping.find(
        (column) => column.excel_header === "ma_so_can_bo",
      )?.postgresql_type,
    ).toBe("text");
  });

  it("locks the inspected row, warning, date, and stt expectations", () => {
    expect(sourceContract).toMatchObject({
      expected_data_row_count: 2497,
      expected_warning_counts: {
        missing_staff_code_and_email_rows: 0,
        duplicate_business_groups: 7,
        duplicate_business_rows: 14,
        staff_name_variant_groups: 5,
        course_name_variant_groups: 19,
      },
      expected_invalid_date_count: 0,
      stt: {
        expected_min: -1,
        expected_max: 2569,
        expected_distinct: 2497,
        expected_missing_within_range_count: 74,
        expected_next: 2570,
        duplicate_count: 0,
      },
    });
    expect(sourceContract.stt.expected_missing_within_range).toHaveLength(74);
  });
});
