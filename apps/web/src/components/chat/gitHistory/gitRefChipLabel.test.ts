import { describe, expect, it } from "vitest";

import { dedupeRemoteRefs, resolveRefChipLabel } from "./gitRefChipLabel";

const local = { name: "main", kind: "branch", checkedOut: true } as const;
const tag = { name: "v1", kind: "tag", checkedOut: false } as const;
const originFeature = { name: "origin/feature", kind: "remote", checkedOut: false } as const;
const forkFeature = { name: "fork/feature", kind: "remote", checkedOut: false } as const;
const forkOnly = { name: "fork/only-here", kind: "remote", checkedOut: false } as const;
const remotes = ["origin", "fork"] as const;

describe("dedupeRemoteRefs", () => {
  it("drops the fork mirror and keeps the origin chip", () => {
    const refs = dedupeRemoteRefs([originFeature, forkFeature, local, tag], remotes);

    expect(refs).toEqual([originFeature, local, tag]);
  });

  it("keeps a fork branch the upstream does not have", () => {
    const refs = dedupeRemoteRefs([originFeature, forkFeature, forkOnly], remotes);

    expect(refs).toEqual([originFeature, forkOnly]);
  });

  it("prefers origin even when the fork ref comes first", () => {
    const refs = dedupeRemoteRefs([forkFeature, originFeature], remotes);

    expect(refs).toEqual([originFeature]);
  });

  it("leaves refs alone when a remote is not configured", () => {
    const unknown = { name: "upstream/x", kind: "remote", checkedOut: false } as const;
    const refs = dedupeRemoteRefs([originFeature, unknown], remotes);

    expect(refs).toEqual([originFeature, unknown]);
  });
});

describe("resolveRefChipLabel", () => {
  it("drops the remote prefix from every remote chip", () => {
    expect(resolveRefChipLabel(originFeature, remotes)).toBe("feature");
    expect(resolveRefChipLabel(forkFeature, remotes)).toBe("feature");
  });

  it("never rewrites a local branch or a ref from an unknown remote", () => {
    expect(resolveRefChipLabel(local, remotes)).toBe("main");
    expect(resolveRefChipLabel({ ...originFeature, name: "upstream/main" }, remotes)).toBe(
      "upstream/main",
    );
  });
});
