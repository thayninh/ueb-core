import { describe, expect, it } from "vitest";

import {
  firstSearchParam,
  hasUnexpectedSearchParams,
  parseStrictPositivePage,
} from "@/lib/http/search-params";

describe("strict page search parameters", () => {
  it("rejects IDOR-shaped keys outside the route contract", () => {
    expect(
      hasUnexpectedSearchParams(
        { unitId: "unit-a", lecturer_uid: "lecturer-b" },
        ["unitId", "q", "page"],
      ),
    ).toBe(true);
    expect(hasUnexpectedSearchParams({ unitId: "unit-a" }, ["unitId"])).toBe(
      false,
    );
  });

  it("parses only canonical positive page numbers", () => {
    expect(parseStrictPositivePage(undefined)).toBe(1);
    expect(parseStrictPositivePage("2")).toBe(2);
    expect(parseStrictPositivePage("0")).toBeNull();
    expect(parseStrictPositivePage("-1")).toBeNull();
    expect(parseStrictPositivePage("1 OR 1=1")).toBeNull();
  });

  it("takes only the first value of a repeated parameter", () => {
    expect(firstSearchParam(["first", "second"])).toBe("first");
  });
});
