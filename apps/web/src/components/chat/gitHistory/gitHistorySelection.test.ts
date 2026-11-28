import { describe, expect, it } from "vitest";

import {
  GIT_HISTORY_BRANCH_BUDGET,
  computeDefaultBranchSelection,
  sanitizeBranchSelection,
  toggleBranchSelection,
} from "./gitHistorySelection";

const candidates = ["main", "origin/main", "feature/a", "feature/b", "origin/feature/c"];

describe("computeDefaultBranchSelection", () => {
  it("starts from the current branch and its upstream", () => {
    expect(
      computeDefaultBranchSelection({
        candidates,
        currentBranch: "main",
        upstreamBranch: "origin/main",
        defaultBranch: "main",
      }),
    ).toEqual(["main", "origin/main"]);
  });

  it("keeps the default branch alongside a current branch that has no upstream", () => {
    // A reader on a topic branch still expects `main` in the walk: the default branch is
    // added after the current branch and survives the budget.
    expect(
      computeDefaultBranchSelection({
        candidates,
        currentBranch: "feature/a",
        upstreamBranch: null,
        defaultBranch: "main",
      }),
    ).toEqual(["feature/a", "main", "origin/main"]);
  });

  it("falls back to the default branch on a detached HEAD", () => {
    expect(
      computeDefaultBranchSelection({
        candidates,
        currentBranch: null,
        upstreamBranch: null,
        defaultBranch: "main",
      }),
    ).toEqual(["main", "origin/main"]);
  });

  it("drops branches that are not candidates and stays within the budget", () => {
    const many = Array.from({ length: 12 }, (_value, index) => `b${index}`);
    expect(
      computeDefaultBranchSelection({
        candidates: many,
        currentBranch: null,
        upstreamBranch: null,
        defaultBranch: "b3",
        budget: 2,
      }),
    ).toEqual(["b3"]);
    expect(
      computeDefaultBranchSelection({
        candidates,
        currentBranch: "gone",
        upstreamBranch: "origin/main",
        defaultBranch: null,
      }),
    ).toEqual(["origin/main", "main"]);
  });
});

describe("sanitizeBranchSelection", () => {
  it("keeps only branches that are still candidates, in order", () => {
    expect(sanitizeBranchSelection(["feature/b", "gone", "main"], candidates)).toEqual([
      "feature/b",
      "main",
    ]);
  });
});

describe("toggleBranchSelection", () => {
  const relevanceOrder = candidates;

  it("turns a branch on", () => {
    const result = toggleBranchSelection({
      selected: ["main"],
      branch: "feature/a",
      relevanceOrder,
    });
    expect(result).toEqual({ selected: ["main", "feature/a"], dropped: null });
  });

  it("turns a branch off", () => {
    const result = toggleBranchSelection({
      selected: ["main", "feature/a"],
      branch: "feature/a",
      relevanceOrder,
    });
    expect(result).toEqual({ selected: ["main"], dropped: null });
  });

  it("never turns off the last selected branch", () => {
    const result = toggleBranchSelection({
      selected: ["main"],
      branch: "main",
      relevanceOrder,
    });
    expect(result).toEqual({ selected: ["main"], dropped: null });
  });

  it("drops the least relevant branch when one past the budget is turned on", () => {
    // Fill the budget, then turn on one more: the branch last in relevance order goes.
    const filled = Array.from(
      { length: GIT_HISTORY_BRANCH_BUDGET },
      (_value, index) => `b${index}`,
    );
    const extra = `b${GIT_HISTORY_BRANCH_BUDGET}`;
    const result = toggleBranchSelection({
      selected: filled,
      branch: extra,
      relevanceOrder: [...filled, extra],
    });

    expect(result.selected).toHaveLength(GIT_HISTORY_BRANCH_BUDGET);
    expect(result.selected).toContain(extra);
    // The oldest branch sits last in relevance order, so the budget drops it.
    expect(result.dropped).toBe(`b${GIT_HISTORY_BRANCH_BUDGET - 1}`);
  });
});
