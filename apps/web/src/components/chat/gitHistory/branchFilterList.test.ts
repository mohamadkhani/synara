import { describe, expect, it } from "vitest";

import { branchMatchesFilter, formatBranchDate } from "./branchFilterList";

describe("branchMatchesFilter", () => {
  it("matches anywhere in the name, ignoring case and surrounding space", () => {
    expect(branchMatchesFilter("origin/feature/x", "FEATURE")).toBe(true);
    expect(branchMatchesFilter("main", "  ain ")).toBe(true);
    expect(branchMatchesFilter("main", "master")).toBe(false);
    expect(branchMatchesFilter("anything", "")).toBe(true);
    expect(branchMatchesFilter("anything", "   ")).toBe(true);
  });
});

describe("formatBranchDate", () => {
  it("renders a compact date for a git ISO value", () => {
    expect(formatBranchDate("2037-01-01T00:00:00Z", "locale", "en-US")).toContain("203");
  });

  it("renders nothing for a missing or unparseable value", () => {
    expect(formatBranchDate(undefined, "locale", "en-US")).toBeNull();
    expect(formatBranchDate("", "locale", "en-US")).toBeNull();
    expect(formatBranchDate("not-a-date", "locale", "en-US")).toBeNull();
  });
});
