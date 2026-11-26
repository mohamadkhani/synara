import { describe, expect, it } from "vitest";

import { resolveRefChipLabel } from "./gitRefChipLabel";

const localBranch = { name: "main", kind: "branch", checkedOut: true } as const;
const remoteBranch = { name: "origin/feature", kind: "remote", checkedOut: false } as const;

describe("resolveRefChipLabel", () => {
  it("drops the remote prefix when the repository has a single remote", () => {
    expect(resolveRefChipLabel(remoteBranch, ["origin"])).toBe("feature");
  });

  it("keeps the prefix when several remotes could own the name", () => {
    expect(resolveRefChipLabel(remoteBranch, ["origin", "upstream"])).toBe("origin/feature");
  });

  it("keeps the prefix when no remote is configured", () => {
    expect(resolveRefChipLabel(remoteBranch, [])).toBe("origin/feature");
  });

  it("never rewrites a local branch or a name from another remote", () => {
    expect(resolveRefChipLabel(localBranch, ["origin"])).toBe("main");
    expect(resolveRefChipLabel({ ...remoteBranch, name: "upstream/feature" }, ["origin"])).toBe(
      "upstream/feature",
    );
  });
});
