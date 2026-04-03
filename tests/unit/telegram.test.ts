import { describe, expect, it } from "vitest";
import { escapeHtml, isCommandText } from "../../src/utils/telegram";

describe("telegram utils", () => {
  it("escapes HTML-sensitive characters", () => {
    expect(escapeHtml(`<tag attr="x">&value</tag>`)).toBe(
      `&lt;tag attr="x"&gt;&amp;value&lt;/tag&gt;`
    );
  });

  it("detects slash commands and ignores regular replies", () => {
    expect(isCommandText("/work")).toBe(true);
    expect(isCommandText("  /settings")).toBe(true);
    expect(isCommandText("remark with /slash inside")).toBe(false);
    expect(isCommandText(undefined)).toBe(false);
  });
});
