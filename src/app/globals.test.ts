import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("global responsive styles", () => {
  it("does not impose a document minimum width that blocks zoom reflow", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const htmlRule = css.match(/(?:^|\n)html\s*\{([^}]*)\}/u)?.[1] ?? "";

    expect(htmlRule).not.toMatch(/\bmin-width\s*:/u);
  });
});
