import { describe, expect, it } from "vitest";

import { layoutGitGraph, type GitGraphLayout, type GitGraphRow } from "./gitGraphLayout";

/** Deterministic PRNG so a failure is reproducible from the printed seed. */
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random commit lists in the shapes a walk produces: chains, merges, roots, and parents
 * that sit above their child (a rebase or clock skew can order them that way).
 */
function randomHistory(seed: number, size: number) {
  const random = mulberry32(seed);
  const shas = Array.from({ length: size }, (_value, index) => `c${index}`.padEnd(40, "x"));
  const commits = shas.map((sha, position) => {
    const parents: string[] = [];
    const parentCount = random() < 0.15 ? 2 : random() < 0.75 ? 1 : 0;
    for (let index = 0; index < parentCount; index += 1) {
      const offset = 1 + Math.floor(random() * Math.min(size - position, 40));
      const target = position + offset;
      // A commit never lists the same parent twice; a merge's parents are distinct.
      if (target < size && !parents.includes(shas[target]!)) parents.push(shas[target]!);
    }
    return { sha, parents };
  });
  // A tenth of the parents move above their child, which no lane can follow.
  for (let index = 0; index < commits.length; index += 1) {
    if (commits[index]!.parents.length > 0 && random() < 0.1 && index > 0) {
      commits[index] = { sha: commits[index]!.sha, parents: [shas[index - 1]!] };
    }
  }
  return commits;
}

/** Columns a row draws a line into at its bottom edge. */
const columnsDrawnBelow = (row: GitGraphRow) =>
  new Set<number>([...row.releasedLanes, ...row.throughLanes, ...row.parentLanes]);

function assertInvariants(
  layout: GitGraphLayout,
  commits: ReadonlyArray<{ sha: string; parents: readonly string[] }>,
  seed: number,
  holdLimitRows: number,
) {
  const positionBySha = new Map(commits.map((commit, position) => [commit.sha, position]));
  layout.rows.forEach((row, index) => {
    const drawnColumns = Math.max(row.topColumns, row.bottomColumns, 1);
    const referenced = [
      row.lane,
      ...row.throughLanes,
      ...row.incomingLanes,
      ...row.parentLanes,
      ...row.releasedLanes,
    ];
    // No element points at a column the row does not draw.
    for (const lane of referenced) {
      expect(
        lane,
        `seed ${seed} row ${index}: lane ${lane} outside ${drawnColumns} columns`,
      ).toBeLessThan(drawnColumns);
      expect(lane).toBeGreaterThanOrEqual(0);
    }
    // A lane that continues from above must have been drawn at the previous row's bottom.
    if (index > 0 && row.continuesFromAbove) {
      expect(
        columnsDrawnBelow(layout.rows[index - 1]!).has(row.lane),
        `seed ${seed} row ${index}: lane ${row.lane} continues from a column that was empty`,
      ).toBe(true);
    }
    // A stub means "the branch continues but the line is not drawn", never a real end.
    if (row.releasedLanes.length > 0) {
      expect(row.continuesBelow, `seed ${seed} row ${index}: stub without a reason`).toBe(true);
      expect(commits[index]!.parents.length).toBeGreaterThan(0);
    }
    // "Continues below" is about the first parent: an unheld mainline connection is
    // marked, while a nearby merge parent may still draw its own edge.
    const firstParent = commits[index]!.parents[0];
    const firstParentPosition =
      firstParent === undefined ? undefined : positionBySha.get(firstParent);
    const firstParentHeld =
      firstParentPosition !== undefined &&
      firstParentPosition > index &&
      firstParentPosition - index <= holdLimitRows;
    expect(row.continuesBelow, `seed ${seed} row ${index}: wrong continues-below flag`).toBe(
      firstParent !== undefined && !firstParentHeld,
    );
    // Every parent the layout can draw gets its line: nothing is dropped silently.
    const drawableParents = new Set(
      commits[index]!.parents.filter((parent) => {
        const parentPosition = positionBySha.get(parent);
        return (
          parentPosition !== undefined &&
          parentPosition > index &&
          parentPosition - index <= holdLimitRows
        );
      }),
    );
    expect(
      row.parentLanes.length,
      `seed ${seed} row ${index}: dropped a drawable parent; parents=${commits[index]!.parents.map(
        (parent) => `${parent}@${positionBySha.get(parent)}`,
      ).join(
        ",",
      )} lane=${row.lane} topColumns=${row.topColumns} below=${row.continuesBelow} stub=${JSON.stringify(row.releasedLanes)}`,
    ).toBe(drawableParents.size);
  });
}

describe("layoutGitGraph invariants", () => {
  it("holds for random histories", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const commits = randomHistory(seed, 40 + (seed % 60));
      assertInvariants(layoutGitGraph(commits), commits, seed, 80);
    }
  });

  it("holds when the hold limit is tiny", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const commits = randomHistory(seed, 60);
      assertInvariants(layoutGitGraph(commits, { holdLimitRows: 3 }), commits, seed, 3);
    }
  });
});
