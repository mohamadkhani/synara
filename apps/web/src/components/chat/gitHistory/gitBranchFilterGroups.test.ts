import { describe, expect, it } from "vitest";

import type { GitBranch } from "@synara/contracts";
import { groupRemoteBranchesByNamespace } from "./gitBranchFilterGroups";

const remote = (name: string, remoteName: string): GitBranch => ({
  name,
  isRemote: true,
  remoteName,
  current: false,
  isDefault: false,
  worktreePath: null,
});

describe("groupRemoteBranchesByNamespace", () => {
  it("groups by the namespace after the remote name, largest group first", () => {
    const groups = groupRemoteBranchesByNamespace([
      remote("origin/synara/one", "origin"),
      remote("origin/synara/two", "origin"),
      remote("origin/codex/fix", "origin"),
      remote("origin/main", "origin"),
    ]);

    expect(groups.map((group) => group.namespace)).toEqual(["synara", "codex", "origin"]);
    expect(groups[0]?.branches.map((branch) => branch.name)).toEqual([
      "origin/synara/one",
      "origin/synara/two",
    ]);
  });

  it("keeps branches without a namespace under their remote name", () => {
    const groups = groupRemoteBranchesByNamespace([remote("upstream/main", "upstream")]);

    expect(groups).toEqual([
      { namespace: "upstream", branches: [remote("upstream/main", "upstream")] },
    ]);
  });

  it("returns nothing for a repository without remote branches", () => {
    expect(groupRemoteBranchesByNamespace([])).toEqual([]);
  });
});
