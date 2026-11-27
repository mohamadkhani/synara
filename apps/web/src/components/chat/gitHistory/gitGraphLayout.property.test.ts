import { describe, expect, it } from "vitest";

import { GIT_GRAPH_LANE_COLOR_COUNT } from "./gitBranchColors";
import { layoutGitGraph, type GitGraphLayout } from "./gitGraphLayout";

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

function isSubsequence(sub: readonly string[], full: readonly string[]): boolean {
  let matched = 0;
  for (const id of full) {
    if (matched < sub.length && sub[matched] === id) matched += 1;
  }
  return matched === sub.length;
}

/**
 * The five invariants of the carried-swimlane model, plus our deviation (a parent that
 * already appeared higher in the walk gets no lane, because no lane can run upward).
 */
function assertInvariants(
  layout: GitGraphLayout,
  commits: ReadonlyArray<{ sha: string; parents: readonly string[] }>,
  seed: number,
) {
  const positionBySha = new Map(commits.map((commit, position) => [commit.sha, position]));
  // A parent gets a lane when it is below the commit or not loaded yet; only a parent
  // that already appeared above its child is skipped (our deviation).
  const canHold = (parent: string, position: number) => {
    const parentPosition = positionBySha.get(parent);
    return parentPosition === undefined || parentPosition > position;
  };

  layout.rows.forEach((row, index) => {
    const commit = commits[index]!;
    const where = `seed ${seed} row ${index}`;

    // 1. Every row's input is a deep copy of the previous row's output.
    const previous = layout.rows[index - 1];
    expect(row.inputLanes, `${where}: input not carried`).toEqual(previous?.outputLanes ?? []);

    // 2. A commit with no parents empties the lane array.
    if (commit.parents.length === 0) {
      expect(row.outputLanes, `${where}: root kept lanes`).toEqual([]);
    }

    const matchingInputs = row.inputLanes.filter((lane) => lane.id === commit.sha);
    const pendingInputs = row.inputLanes.filter((lane) => lane.id !== commit.sha);
    const holdableParents = commit.parents.filter((parent) => canHold(parent, index));

    if (commit.parents.length > 0) {
      // 4. Output = input minus the matched slot(s) plus one node per holdable parent.
      expect(
        row.outputLanes.length,
        `${where}: wrong output size pending=${pendingInputs.length} parents=${holdableParents.length}`,
      ).toBe(pendingInputs.length + holdableParents.length);

      // 3. Every output lane is a pending input lane (still waiting), or a holdable parent.
      for (const lane of row.outputLanes) {
        const fromInput = pendingInputs.some((input) => input.id === lane.id);
        const fromParent = holdableParents.includes(lane.id);
        expect(fromInput || fromParent, `${where}: lane ${lane.id} has no source`).toBe(true);
      }
      // Every holdable parent gets a lane; no lane is created for the others (the deviation,
      // beyond the passthrough a pending input lane may already occupy).
      for (const parent of holdableParents) {
        expect(
          row.outputLanes.some((lane) => lane.id === parent),
          `${where}: dropped ${parent}`,
        ).toBe(true);
      }

      // Non-matching input lanes are copied through in order, with no compaction.
      expect(
        isSubsequence(
          pendingInputs.map((lane) => lane.id),
          row.outputLanes.map((lane) => lane.id),
        ),
        `${where}: pending lanes reordered`,
      ).toBe(true);

      // The commit's own id never survives into the output.
      expect(
        row.outputLanes.some((lane) => lane.id === commit.sha),
        `${where}: self lane`,
      ).toBe(false);
    }

    // An unmatched commit keeps every input lane.
    if (matchingInputs.length === 0 && commit.parents.length > 0) {
      expect(
        row.outputLanes.slice(0, row.inputLanes.length).map((lane) => lane.id),
        `${where}: unmatched commit dropped a lane`,
      ).toEqual(row.inputLanes.map((lane) => lane.id));
    }

    // Geometry.
    expect(row.lane, `${where}: dot outside the row`).toBeGreaterThanOrEqual(0);
    expect(row.lane, `${where}: dot outside the row`).toBeLessThan(row.laneCount);
    expect(row.laneCount, `${where}: wrong width`).toBe(
      Math.max(row.inputLanes.length, row.outputLanes.length, row.lane + 1, 1),
    );
    expect(row.continuesFromAbove, `${where}: wrong above flag`).toBe(matchingInputs.length > 0);
    expect(row.convergingLanes, `${where}: wrong converging lanes`).toEqual(
      row.inputLanes
        .map((lane, laneIndex) =>
          lane.id === commit.sha && laneIndex !== row.lane ? laneIndex : -1,
        )
        .filter((laneIndex) => laneIndex >= 0),
    );

    const passthroughInputs = new Set<number>();
    let lastOutput = -1;
    for (const edge of row.passthrough) {
      expect(edge.input, `${where}: passthrough input`).toBeLessThan(row.inputLanes.length);
      expect(edge.output, `${where}: passthrough output`).toBeLessThan(row.outputLanes.length);
      expect(row.inputLanes[edge.input]!.id, `${where}: passthrough id changed`).toBe(
        row.outputLanes[edge.output]!.id,
      );
      expect(edge.output, `${where}: lane moved right`).toBeLessThanOrEqual(edge.input);
      expect(edge.output, `${where}: passthrough out of order`).toBeGreaterThan(lastOutput);
      lastOutput = edge.output;
      passthroughInputs.add(edge.input);
    }
    // A root empties the lane array, so its other lanes are dropped rather than drawn.
    if (commit.parents.length > 0) {
      for (const pending of pendingInputs) {
        const index = row.inputLanes.indexOf(pending);
        expect(passthroughInputs.has(index), `${where}: pending lane not drawn`).toBe(true);
      }
    }

    for (const parent of row.parentLanes) {
      expect(parent, `${where}: parent lane out of range`).toBeLessThan(row.outputLanes.length);
      expect(parent, `${where}: parent lane on the dot`).not.toBe(row.lane);
      expect(
        commit.parents.includes(row.outputLanes[parent]!.id),
        `${where}: parent lane is not a parent`,
      ).toBe(true);
    }

    expect(row.continuesBelow, `${where}: wrong below flag`).toBe(
      row.outputLanes[row.lane] !== undefined &&
        commit.parents.includes(row.outputLanes[row.lane]!.id),
    );

    // Colours stay in the shared palette.
    for (const lane of [...row.inputLanes, ...row.outputLanes]) {
      expect(lane.color, `${where}: colour out of range`).toBeGreaterThanOrEqual(0);
      expect(lane.color, `${where}: colour out of range`).toBeLessThan(GIT_GRAPH_LANE_COLOR_COUNT);
    }
    expect(row.color, `${where}: dot colour out of range`).toBeLessThan(GIT_GRAPH_LANE_COLOR_COUNT);
  });
}

describe("layoutGitGraph invariants", () => {
  it("holds for random histories", () => {
    // Twenty seeds cover the shapes (chain, merge, root, parent-above-child) while keeping
    // the assertion-heavy run comfortably inside the default per-test timeout.
    for (let seed = 1; seed <= 20; seed += 1) {
      const commits = randomHistory(seed, 40 + (seed % 60));
      assertInvariants(layoutGitGraph(commits), commits, seed);
    }
  });
});
