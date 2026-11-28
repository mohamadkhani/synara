import { describe, expect, it } from "vitest";

import { orderRefsForDisplay } from "./GitCommitRefBadges";

const ref = (name: string, kind: "head" | "branch" | "remote" | "tag", checkedOut = false) => ({
  name,
  kind,
  checkedOut,
});

/** The tip of `origin/main` in a branch-heavy repository: five remote refs on one commit. */
const sharedTip = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  parents: [],
  subject: "Merge pull request",
  authorName: "Ada",
  authorEmail: "ada@example.com",
  committedAt: "2025-01-02T03:04:05+02:00",
  refs: [
    ref("origin/synara/macos-drag-drop-permissions", "remote"),
    ref("origin/synara/fix-worktree-branch-selection", "remote"),
    ref("origin/main", "remote"),
    ref("origin/HEAD", "remote"),
  ],
};

describe("orderRefsForDisplay", () => {
  it("puts the default branch first so it survives a two-chip cap", () => {
    const ordered = orderRefsForDisplay(sharedTip, ["origin", "fork"]);
    expect(ordered[0]!.name).toBe("origin/main");
  });

  it("drops origin/HEAD: it points at the default branch, it is not a branch", () => {
    const ordered = orderRefsForDisplay(sharedTip, ["origin", "fork"]);
    expect(ordered.some((entry) => entry.name === "origin/HEAD")).toBe(false);
  });

  it("ranks the checked-out branch, then HEAD, then the default branch", () => {
    const commit = {
      ...sharedTip,
      refs: [
        ref("origin/main", "remote"),
        ref("main", "branch", true),
        ref("HEAD", "head"),
        ref("v1.0.0", "tag"),
        ref("feature/x", "branch"),
      ],
    };
    // Both names of the default branch rank above an ordinary branch; the local one wins the
    // tie because it is the checked-out one.
    expect(orderRefsForDisplay(commit, ["origin"]).map((entry) => entry.name)).toEqual([
      "main",
      "HEAD",
      "origin/main",
      "feature/x",
      "v1.0.0",
    ]);
  });

  it("treats master like main", () => {
    const commit = {
      ...sharedTip,
      refs: [ref("origin/beta", "remote"), ref("origin/master", "remote")],
    };
    expect(orderRefsForDisplay(commit, ["origin"])[0]!.name).toBe("origin/master");
  });
});
