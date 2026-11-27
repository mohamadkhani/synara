// FILE: GitHistoryPanel.browser.tsx
// Purpose: Exercises the Git Graph panel's interactive paths: the remote-branch
//          checkout confirmation, the commit detail maximize toggle, and the commit
//          and ref context menus.
// Layer: Browser UI test

import "../../../index.css";

import { DEFAULT_SERVER_SETTINGS_VIEW, type GitHistoryCommit } from "@synara/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { serverQueryKeys } from "~/lib/serverReactQuery";

const harness = vi.hoisted(() => ({
  listBranches: vi.fn(),
  listCommitHistory: vi.fn(),
  status: vi.fn(),
  workingTreeDiffStats: vi.fn(),
  githubRepository: vi.fn(),
  readCommitDiff: vi.fn(),
  checkoutRemoteBranch: vi.fn(),
  checkout: vi.fn(),
  checkoutCommit: vi.fn(),
  cherryPickCommit: vi.fn(),
  revertCommit: vi.fn(),
  createBranch: vi.fn(),
  createTag: vi.fn(),
  deleteBranchRef: vi.fn(),
  pushBranch: vi.fn(),
  pullBranch: vi.fn(),
  mergeBranch: vi.fn(),
  rebaseBranch: vi.fn(),
  stashCreate: vi.fn(),
  stashList: vi.fn(),
  stashApply: vi.fn(),
  stashDrop: vi.fn(),
  confirm: vi.fn(),
  contextMenuShow: vi.fn(),
  listWorktrees: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("~/nativeApi", () => {
  const api = {
    git: {
      listBranches: harness.listBranches,
      listCommitHistory: harness.listCommitHistory,
      status: harness.status,
      workingTreeDiffStats: harness.workingTreeDiffStats,
      githubRepository: harness.githubRepository,
      readCommitDiff: harness.readCommitDiff,
      checkoutRemoteBranch: harness.checkoutRemoteBranch,
      checkout: harness.checkout,
      checkoutCommit: harness.checkoutCommit,
      cherryPickCommit: harness.cherryPickCommit,
      revertCommit: harness.revertCommit,
      createBranch: harness.createBranch,
      createTag: harness.createTag,
      deleteBranchRef: harness.deleteBranchRef,
      pushBranch: harness.pushBranch,
      pullBranch: harness.pullBranch,
      mergeBranch: harness.mergeBranch,
      rebaseBranch: harness.rebaseBranch,
      stashCreate: harness.stashCreate,
      stashList: harness.stashList,
      stashApply: harness.stashApply,
      stashDrop: harness.stashDrop,
    },
    server: { listWorktrees: harness.listWorktrees },
    dialogs: { confirm: harness.confirm },
    contextMenu: { show: harness.contextMenuShow },
  };
  return { readNativeApi: () => api, ensureNativeApi: () => api };
});
vi.mock("../../ui/toast", () => ({ toastManager: { add: harness.toastAdd } }));

import { GitHistoryPanel } from "./GitHistoryPanel";
import { GIT_HISTORY_SELECTION_STORAGE_KEY } from "./gitHistorySelection";
import { GIT_GRAPH_LANE_WIDTH, GIT_GRAPH_ROW_HEIGHT } from "./gitGraphLayout";

const commit: GitHistoryCommit = {
  sha: "a".repeat(40),
  shortSha: "aaaaaaa",
  parents: [],
  subject: "Add feature",
  authorName: "Ada",
  authorEmail: "ada@example.com",
  committedAt: "2025-01-02T03:04:05+02:00",
  refs: [
    { name: "feature/local", kind: "branch", checkedOut: false },
    { name: "origin/feature", kind: "remote", checkedOut: false },
  ],
};

const clients: QueryClient[] = [];

/** The chip at the head of the bar; the promotion test reads its data attribute. */
function headChipName(): string | null {
  return (
    document.querySelector('[data-testid^="branch-chip-"]')?.getAttribute("data-branch-chip") ??
    null
  );
}

interface BranchFixture {
  name: string;
  isRemote?: boolean;
  remoteName?: string;
  current?: boolean;
  isDefault?: boolean;
}

/** Replaces the branch list the panel reads, before it mounts. */
function setBranches(branches: BranchFixture[]) {
  harness.listBranches.mockResolvedValue({
    branches: branches.map((entry) => ({
      name: entry.name,
      ...(entry.isRemote === true ? { isRemote: true } : {}),
      ...(entry.remoteName ? { remoteName: entry.remoteName } : {}),
      current: entry.current === true,
      isDefault: entry.isDefault === true,
      worktreePath: null,
    })),
    isRepo: true,
    hasOriginRemote: true,
    remoteNames: ["origin"],
  });
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(serverQueryKeys.settings(), DEFAULT_SERVER_SETTINGS_VIEW);
  return render(
    <QueryClientProvider client={client}>
      {/* A grid wrapper stretches the panel to a real height, so the graph has the viewport
          geometry it has in the app (the promotion and row-count tests depend on it). */}
      <div style={{ display: "grid", height: 480 }}>
        <GitHistoryPanel activeCwd="/repo" primaryCwd="/repo" theme="light" />
      </div>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await page.viewport(1024, 800);
  // Skip the one-time settings migration so `useAppSettings` never reaches the server.
  localStorage.setItem("synara:server-settings-migrated:v1", "1");
  harness.listBranches.mockResolvedValue({
    branches: [{ name: "main", current: true, isDefault: true, worktreePath: null }],
    isRepo: true,
    hasOriginRemote: true,
    remoteNames: ["origin"],
  });
  harness.listCommitHistory.mockResolvedValue({ commits: [commit], hasMore: false });
  harness.status.mockReset();
  harness.status.mockResolvedValue({
    branch: "main",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    upstreamBranch: "origin/main",
    aheadCount: 0,
    behindCount: 0,
    pr: null,
  });
  harness.workingTreeDiffStats.mockResolvedValue({ additions: 0, deletions: 0, fileCount: 0 });
  harness.githubRepository.mockResolvedValue({ repository: null, repositories: [] });
  harness.readCommitDiff.mockResolvedValue({
    commit,
    message: commit.subject,
    patch: "",
    truncated: false,
  });
  harness.checkoutRemoteBranch.mockResolvedValue({
    branch: "feature",
    created: true,
    updated: true,
  });
  harness.checkout.mockResolvedValue(undefined);
  harness.checkoutCommit.mockResolvedValue(undefined);
  harness.cherryPickCommit.mockResolvedValue({ commitSha: "b".repeat(40), subject: "picked" });
  harness.revertCommit.mockResolvedValue({ commitSha: "b".repeat(40), subject: "reverted" });
  harness.createBranch.mockResolvedValue(undefined);
  harness.createTag.mockResolvedValue({ ok: true });
  harness.deleteBranchRef.mockResolvedValue({ remoteName: null, requiresForce: false });
  harness.pushBranch.mockResolvedValue({ ok: true });
  harness.pullBranch.mockResolvedValue({
    status: "pulled",
    branch: "main",
    upstreamBranch: "origin/main",
  });
  harness.mergeBranch.mockResolvedValue({ ok: true });
  harness.rebaseBranch.mockResolvedValue({ ok: true });
  harness.stashCreate.mockReset();
  harness.stashCreate.mockResolvedValue({ message: "wip" });
  harness.stashList.mockReset();
  harness.stashList.mockResolvedValue({ stashes: [] });
  harness.stashApply.mockReset();
  harness.stashApply.mockResolvedValue({ status: "applied" });
  harness.stashDrop.mockReset();
  harness.stashDrop.mockResolvedValue(undefined);
  harness.confirm.mockResolvedValue(false);
  harness.contextMenuShow.mockReset();
  harness.contextMenuShow.mockResolvedValue(undefined);
  harness.listWorktrees.mockResolvedValue({ worktrees: [] });
  harness.toastAdd.mockReset();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  document.body.innerHTML = "";
  localStorage.removeItem("synara:server-settings-migrated:v1");
  localStorage.removeItem("synara:app-settings:v1");
  localStorage.removeItem(GIT_HISTORY_SELECTION_STORAGE_KEY);
});

describe("GitHistoryPanel", () => {
  it("does not check out a remote branch when the confirmation is declined", async () => {
    harness.contextMenuShow.mockResolvedValue("checkout-branch");
    harness.confirm.mockResolvedValue(false);
    await mount();

    await page.getByTitle("Remote branch origin/feature").click({ button: "right" });

    await vi.waitFor(() => expect(harness.confirm).toHaveBeenCalledOnce());
    expect(harness.checkoutRemoteBranch).not.toHaveBeenCalled();
  });

  it("checks out the remote branch after confirmation", async () => {
    harness.contextMenuShow.mockResolvedValue("checkout-branch");
    harness.confirm.mockResolvedValue(true);
    await mount();

    await page.getByTitle("Remote branch origin/feature").click({ button: "right" });

    await vi.waitFor(() =>
      expect(harness.checkoutRemoteBranch).toHaveBeenCalledWith({
        cwd: "/repo",
        remoteBranch: "origin/feature",
      }),
    );
  });

  it("toggles the selected commit into the expanded detail layout", async () => {
    await mount();

    await page.getByTitle("Add feature").click();
    await expect.element(page.getByRole("button", { name: "Expand details" })).toBeVisible();
    await page.getByRole("button", { name: "Expand details" }).click();
    await expect.element(page.getByRole("button", { name: "Collapse details" })).toBeVisible();
  });

  it("runs the commit action chosen from the row context menu", async () => {
    harness.contextMenuShow.mockResolvedValue("cherry-pick");
    await mount();

    await page.getByTitle("Add feature").click({ button: "right" });

    await vi.waitFor(() =>
      expect(harness.cherryPickCommit).toHaveBeenCalledWith({ cwd: "/repo", sha: commit.sha }),
    );
  });

  it("opens the delete dialog from a branch ref context menu", async () => {
    harness.contextMenuShow.mockResolvedValue("delete-branch");
    const screen = await mount();

    await page.getByTitle("Local branch feature/local").click({ button: "right" });

    await expect.element(page.getByRole("button", { name: "Delete" })).toBeVisible();
    expect(harness.deleteBranchRef).not.toHaveBeenCalled();
    // Unmount with the dialog still open: leaving the portal behind for afterEach's
    // body reset makes React remove nodes that are no longer its children.
    await screen.unmount();
  });

  it("keeps the commit subject readable next to the graph column", async () => {
    // The graph column is a fixed width now, so this is the guard that it did not eat the
    // row: a commit row must still show a readable subject at a normal pane width.
    harness.listCommitHistory.mockResolvedValue({
      commits: [
        {
          ...commit,
          sha: "1".repeat(40),
          subject: "Improve project cache warmup and staged orchestration review fixes",
          parents: ["2".repeat(40)],
          refs: [{ name: "feat/readable", kind: "branch", checkedOut: true }],
        },
        {
          ...commit,
          sha: "2".repeat(40),
          subject: "Second commit with a reasonably long subject line for measuring",
          parents: [],
          refs: [],
        },
      ],
      hasMore: false,
    });
    const screen = await mount();

    const row = document.querySelector<HTMLElement>('button[title^="Improve project cache"]')!;
    expect(row).not.toBeNull();
    const subject = Array.from(row.querySelectorAll("span")).find(
      (span) =>
        span.textContent === "Improve project cache warmup and staged orchestration review fixes",
    )!;
    // Assert it is actually laid out with room: the test fails if the column leaves the
    // subject zero width or one glyph.
    expect(subject).not.toBeUndefined();
    expect(subject.getBoundingClientRect().width).toBeGreaterThan(120);
    await screen.unmount();
  });

  it("keeps every lane clear of the list's scrollbar and of its right edge", async () => {
    // Many lanes and enough rows to overflow: the vertical scrollbar is on screen, and a
    // pane-sized row used to run underneath it, chopping the right-hand lanes. The graph
    // column is a fixed, capped width now, and the svg ends flush with its last lane.
    const parentNames = Array.from({ length: 40 }, (_value, index) => `w${index}`);
    harness.listCommitHistory.mockResolvedValue({
      commits: [
        {
          ...commit,
          sha: "1".repeat(40),
          subject: "wide tip",
          parents: parentNames.map((name) => name.padEnd(40, "x")),
          refs: [],
        },
        ...parentNames.map((name) => ({
          ...commit,
          sha: name.padEnd(40, "x"),
          subject: `leaf ${name}`,
          parents: [],
          refs: [],
        })),
        ...Array.from({ length: 40 }, (_value, index) => ({
          ...commit,
          sha: `f${index}`.padEnd(40, "x"),
          subject: `filler ${index}`,
          parents: [],
          refs: [],
        })),
      ],
      hasMore: false,
    });
    const screen = await mount();

    const row = page.getByTitle("wide tip");
    await expect.element(row).toBeVisible();
    const scroller = document.querySelector<HTMLElement>("[data-git-history-scroll]")!;
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

    const svg = row.element().querySelector("svg")!;
    const scrollerRight = scroller.getBoundingClientRect().right;
    const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
    const lastLaneX =
      svg.getBoundingClientRect().left + 39 * GIT_GRAPH_LANE_WIDTH + GIT_GRAPH_LANE_WIDTH;
    // Every lane, including the last, is left of where the scrollbar starts.
    expect(lastLaneX).toBeLessThanOrEqual(scrollerRight - scrollbarWidth);
    expect(svg.getBoundingClientRect().right).toBeLessThanOrEqual(scrollerRight);
    await screen.unmount();
  });

  it("draws every lane a wide row carries, with no cap", async () => {
    // Forty parents are all loaded, so each really needs a lane. The row draws all forty
    // columns: no clipping and no "simplified" banner.
    const parentNames = Array.from({ length: 40 }, (_value, index) => `q${index}`);
    harness.listCommitHistory.mockResolvedValue({
      commits: [
        {
          ...commit,
          sha: "1".repeat(40),
          subject: "deep row",
          parents: parentNames.map((name) => name.padEnd(40, "x")),
          refs: [],
        },
        ...parentNames.map((name) => ({
          ...commit,
          sha: name.padEnd(40, "x"),
          subject: name,
          parents: [],
          refs: [],
        })),
      ],
      hasMore: false,
    });
    const screen = await mount();

    const row = page.getByTitle("deep row");
    await expect.element(row).toBeVisible();
    const svg = row.element().querySelector("svg");
    // The svg holds exactly the lanes; the row adds the gutter after it.
    expect(Number(svg?.getAttribute("width"))).toBe(40 * GIT_GRAPH_LANE_WIDTH);
    expect(row.element().querySelectorAll("path").length).toBe(40);
    expect(row.element().querySelector("circle")?.getAttribute("fill")).toContain(
      "var(--color-git-lane-",
    );
    await expect.element(page.getByText(/parallel branches/)).not.toBeInTheDocument();
    await screen.unmount();
  });

  it("continues the open lanes in a continuation row instead of a dashed stub", async () => {
    // Both parents are in a page the reader has not opened; the last row still carries two
    // open lanes, and the placeholder above the "load more" button draws them on.
    harness.listCommitHistory.mockResolvedValue({
      commits: [
        {
          ...commit,
          sha: "1".repeat(40),
          subject: "page boundary",
          parents: ["9".repeat(40)],
          refs: [],
        },
        {
          ...commit,
          sha: "2".repeat(40),
          subject: "loaded tip",
          parents: ["9".repeat(40)],
          refs: [],
        },
      ],
      hasMore: true,
    });
    const screen = await mount();

    const boundaryRow = page.getByTitle("page boundary");
    await expect.element(boundaryRow).toBeVisible();
    // No dashed line anywhere: the boundary is drawn as a normal lane.
    expect(boundaryRow.element().querySelectorAll("path[stroke-dasharray]").length).toBe(0);

    const continuation = document.querySelector<HTMLElement>("[data-git-graph-continuation]");
    expect(continuation).not.toBeNull();
    expect(continuation!.querySelectorAll("path").length).toBe(2);
    // Full-strength lanes: no mask, so the boundary lanes cannot read as detached fragments.
    expect(getComputedStyle(continuation!).maskImage).toBe("none");
    for (const path of continuation!.querySelectorAll("path")) {
      expect(path.getBoundingClientRect().height).toBe(GIT_GRAPH_ROW_HEIGHT);
    }
    await screen.unmount();
  });

  it("walks the current branch and its upstream by default", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "feature/x" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
      { name: "origin/feature/x", isRemote: true, remoteName: "origin" },
    ]);
    const screen = await mount();

    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ refs: ["main", "origin/main"] }),
      ),
    );
    await expect
      .element(page.getByText("2 of 8 in the graph · 2 branches not shown"))
      .toBeVisible();
    await screen.unmount();
  });

  it("toggles a branch chip into the walk", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "feature/x" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const screen = await mount();

    // The ring inside the chip toggles just this branch.
    await page.getByRole("button", { name: "Toggle feature/x in the graph" }).click();

    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ refs: ["feature/x", "main", "origin/main"] }),
      ),
    );
    await screen.unmount();
  });

  it("shows only one branch when its chip body is clicked", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "feature/x" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const screen = await mount();

    // The chip body (not the ring) narrows the graph to that branch alone.
    await page.getByRole("button", { name: "feature/x", exact: true }).click();

    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ refs: ["feature/x"] }),
      ),
    );
    await screen.unmount();
  });

  it("drops remote chips and remote refs when the switch turns off", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "feature/x" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const screen = await mount();

    await expect.element(page.getByRole("button", { name: "origin/main" })).toBeVisible();
    await page.getByRole("button", { name: "Show remote branches" }).click();

    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ refs: ["main"], includeRemoteBranches: false }),
      ),
    );
    await expect.element(page.getByRole("button", { name: "origin/main" })).not.toBeInTheDocument();
    await screen.unmount();
  });

  it("shows only the branch chosen from a chip's context menu", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "feature/x" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    harness.contextMenuShow.mockResolvedValue("branch-show-only");
    const screen = await mount();

    await page.getByTestId("branch-chip-feature/x").click({ button: "right" });

    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ refs: ["feature/x"] }),
      ),
    );
    await screen.unmount();
  });

  it("drops the least relevant branch over the budget and says so on its chip", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "a1" },
      { name: "a2" },
      { name: "a3" },
      { name: "a4" },
      { name: "a5" },
      { name: "a6" },
      { name: "a7" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const screen = await mount();

    // The default selects main + origin/main; adding a1..a6 fills the budget of eight.
    for (const name of ["a1", "a2", "a3", "a4", "a5", "a6"]) {
      await page.getByRole("button", { name: `Toggle ${name} in the graph` }).click();
    }
    // The ninth add drops a6, the least relevant selected branch.
    await page.getByRole("button", { name: "Toggle a7 in the graph" }).click();

    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          refs: ["a1", "a2", "a3", "a4", "a5", "a7", "main", "origin/main"],
        }),
      ),
    );
    await expect.element(page.getByTestId("branch-chip-a6")).toHaveTextContent("removed · max 8");
    await screen.unmount();
  });

  it("resets the chips to the smart selection and disables the button", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "feature/x" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const screen = await mount();

    const reset = page.getByRole("button", { name: "Reset" });
    // The default is already the smart selection, so there is nothing to undo.
    await expect.element(reset).toBeDisabled();

    await page.getByRole("button", { name: "Toggle feature/x in the graph" }).click();
    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ refs: ["feature/x", "main", "origin/main"] }),
      ),
    );
    await expect.element(reset).not.toBeDisabled();

    await reset.click();
    // The earlier key for the smart selection is still cached, so the pane reuses it
    // instead of refetching; assert the chips and the count, which are what the reader sees.
    await expect
      .element(page.getByRole("button", { name: "Toggle feature/x in the graph" }))
      .toHaveAttribute("aria-pressed", "false");
    await expect
      .element(page.getByText("2 of 8 in the graph · 1 branches not shown"))
      .toBeVisible();
    await expect.element(reset).toBeDisabled();
    await screen.unmount();
  });

  it("gives a chip the same colour as its line in the graph", async () => {
    // Two unselected branches sit before feature/x in candidate order, so a chip coloured by
    // candidate position would hand feature/x a different hue than the lane it draws.
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "aa" },
      { name: "bb" },
      { name: "feature/x" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const base = "3".repeat(40);
    const featureSha = "2".repeat(40);
    harness.listCommitHistory.mockResolvedValue({
      commits: [
        {
          ...commit,
          sha: "1".repeat(40),
          shortSha: "1111111",
          parents: [base],
          subject: "Main tip",
          refs: [
            { name: "main", kind: "branch", checkedOut: true },
            { name: "origin/main", kind: "remote", checkedOut: false },
          ],
        },
        {
          ...commit,
          sha: featureSha,
          shortSha: "2222222",
          parents: [base],
          subject: "Feature tip",
          refs: [{ name: "feature/x", kind: "branch", checkedOut: false }],
        },
        {
          ...commit,
          sha: base,
          shortSha: "3333333",
          parents: [],
          subject: "Shared base",
          refs: [],
        },
      ],
      hasMore: false,
    });
    const screen = await mount();

    await page.getByRole("button", { name: "Toggle feature/x in the graph" }).click();
    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          refs: ["feature/x", "main", "origin/main"],
        }),
      ),
    );

    const chip = document.querySelector<HTMLElement>('[data-testid="branch-chip-feature/x"]')!;
    const chipRing = chip.querySelector<HTMLElement>("[data-branch-ring]")!;
    const graphDot = document.querySelector<SVGCircleElement>(
      `[data-git-graph-dot="${featureSha}"]`,
    )!;
    expect(getComputedStyle(chipRing).borderTopColor).toBe(getComputedStyle(graphDot).fill);
    await screen.unmount();
  });

  it("keeps the graph scroll position when the chip selection changes", async () => {
    setBranches([{ name: "main", current: true, isDefault: true }, { name: "feature/x" }]);
    const many = Array.from({ length: 60 }, (_value, index) => ({
      ...commit,
      sha: `${index}`.padStart(40, "0"),
      shortSha: `${index}`.padStart(7, "0"),
      parents: index === 59 ? [] : [`${index + 1}`.padStart(40, "0")],
      subject: `Commit ${index}`,
      refs: index === 0 ? [{ name: "main", kind: "branch" as const, checkedOut: true }] : [],
    }));
    harness.listCommitHistory.mockResolvedValue({ commits: many, hasMore: false });
    const screen = await mount();

    const scroller = document.querySelector<HTMLElement>("[data-git-history-scroll]")!;
    await vi.waitFor(() =>
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight * 2),
    );
    scroller.scrollTop = 20 * GIT_GRAPH_ROW_HEIGHT;
    scroller.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(scroller.scrollTop).toBe(20 * GIT_GRAPH_ROW_HEIGHT));

    await page.getByRole("button", { name: "Toggle feature/x in the graph" }).click();

    // The new walk keeps the previous pages rendered while it loads, so the list never
    // collapses and the reader is not thrown back to the newest commit.
    await expect
      .element(page.getByRole("button", { name: "Toggle feature/x in the graph" }))
      .toHaveAttribute("aria-pressed", "true");
    await vi.waitFor(() =>
      expect(harness.listCommitHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ refs: ["feature/x", "main"] }),
      ),
    );
    expect(scroller.scrollTop).toBe(20 * GIT_GRAPH_ROW_HEIGHT);
    await screen.unmount();
  });

  it("moves the branches visible in the graph to the head of the chip bar", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "a1" },
      { name: "zzz" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const commits = Array.from({ length: 40 }, (_value, index) => ({
      ...commit,
      sha: `${index}`.padStart(40, "0"),
      shortSha: `${index}`.padStart(7, "0"),
      parents: [],
      subject: `Commit ${index}`,
      refs:
        index === 0
          ? [{ name: "zzz", kind: "branch" as const, checkedOut: false }]
          : index === 30
            ? [{ name: "a1", kind: "branch" as const, checkedOut: false }]
            : [],
    }));
    harness.listCommitHistory.mockResolvedValue({ commits, hasMore: false });
    const screen = await mount();

    // Only the top row of the graph is on screen, so only zzz is promoted.
    await vi.waitFor(() => expect(headChipName()).toBe("zzz"));

    // Scrolling to the far end promotes a1 and drops zzz back into candidate order.
    const scroller = document.querySelector<HTMLElement>("[data-git-history-scroll]")!;
    scroller.scrollTop = 30 * GIT_GRAPH_ROW_HEIGHT;
    scroller.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(headChipName()).toBe("a1"));
    await screen.unmount();
  });

  it("keeps the chip bar on one row when the branches fit, and two when they do not", async () => {
    setBranches([
      { name: "main", current: true, isDefault: true },
      { name: "feature/x" },
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const screen = await mount();
    await expect.element(page.getByTestId("branch-chip-feature/x")).toBeVisible();
    expect(document.querySelectorAll("[data-chip-row]").length).toBe(1);
    await screen.unmount();

    setBranches([
      { name: "main", current: true, isDefault: true },
      ...Array.from({ length: 24 }, (_value, index) => ({
        name: `branch-${String(index).padStart(2, "0")}`,
      })),
      { name: "origin/main", isRemote: true, remoteName: "origin" },
    ]);
    const wide = await mount();
    await expect.element(page.getByTestId("branch-chip-branch-23")).toBeVisible();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-chip-row]").length).toBe(2));
    await wide.unmount();
  });

  it("shows the short remote name on the chip and the full ref on hover", async () => {
    const screen = await mount();

    const chip = page.getByTitle("Remote branch origin/feature");
    await expect.element(chip).toBeVisible();
    await expect.element(chip).toHaveTextContent("feature");
    expect(chip.element().textContent).not.toContain("origin/");
    await screen.unmount();
  });

  it("stashes the staged row with the title typed into its dialog", async () => {
    harness.workingTreeDiffStats.mockResolvedValue({ additions: 1, deletions: 0, fileCount: 1 });
    harness.contextMenuShow.mockResolvedValue("stash-changes");
    const screen = await mount();

    await page.getByTitle("Staged changes", { exact: true }).click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toEqual(["stash-changes"]);

    await expect.element(page.getByText("Stash staged changes", { exact: true })).toBeVisible();
    await page.getByLabelText("Stash title").fill("before the refactor");
    await page.getByRole("button", { name: "Stash" }).click();

    await vi.waitFor(() =>
      expect(harness.stashCreate).toHaveBeenCalledWith({
        cwd: "/repo",
        message: "before the refactor",
        scope: "staged",
        includeUnstaged: false,
      }),
    );
    await screen.unmount();
  });

  it("stashes the unstaged row without the staged scope", async () => {
    harness.workingTreeDiffStats.mockResolvedValue({ additions: 1, deletions: 0, fileCount: 1 });
    harness.contextMenuShow.mockResolvedValue("stash-changes");
    const screen = await mount();

    await page.getByTitle("Unstaged changes", { exact: true }).click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toEqual(["stash-changes"]);

    await expect.element(page.getByText("Stash unstaged changes", { exact: true })).toBeVisible();
    await page.getByLabelText("Stash title").fill("scratch edits");
    await page.getByRole("button", { name: "Stash" }).click();

    await vi.waitFor(() =>
      expect(harness.stashCreate).toHaveBeenCalledWith({
        cwd: "/repo",
        message: "scratch edits",
        scope: "unstaged",
        includeStaged: false,
      }),
    );
    await screen.unmount();
  });

  it("lists stashes and runs pop and delete from their context menu", async () => {
    harness.stashList.mockResolvedValue({
      stashes: [
        {
          stashRef: "stash@{0}",
          message: "On main: wip one",
          sha: "c".repeat(40),
          createdAt: "2026-11-26T10:00:00Z",
        },
      ],
    });
    harness.contextMenuShow.mockResolvedValue("stash-pop");
    const screen = await mount();

    const stashRow = page.getByTitle("stash@{0}: On main: wip one");
    await expect.element(stashRow).toBeVisible();
    await stashRow.click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toEqual(["stash-apply", "stash-pop", "stash-delete"]);

    await vi.waitFor(() =>
      expect(harness.stashApply).toHaveBeenCalledWith({
        cwd: "/repo",
        stashRef: "stash@{0}",
        mode: "pop",
      }),
    );

    harness.contextMenuShow.mockResolvedValue("stash-delete");
    await stashRow.click({ button: "right" });

    await expect.element(page.getByText("Delete stash", { exact: true })).toBeVisible();
    expect(harness.stashDrop).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Delete" }).click();

    await vi.waitFor(() =>
      expect(harness.stashDrop).toHaveBeenCalledWith({ cwd: "/repo", stashRef: "stash@{0}" }),
    );
    await screen.unmount();
  });

  it("applies a stash without dropping it when the menu asks for apply", async () => {
    harness.stashList.mockResolvedValue({
      stashes: [
        {
          stashRef: "stash@{1}",
          message: "On main: parked",
          sha: "d".repeat(40),
          createdAt: "2026-11-26T09:00:00Z",
        },
      ],
    });
    harness.contextMenuShow.mockResolvedValue("stash-apply");
    const screen = await mount();

    await page.getByTitle("stash@{1}: On main: parked").click({ button: "right" });

    await vi.waitFor(() =>
      expect(harness.stashApply).toHaveBeenCalledWith({
        cwd: "/repo",
        stashRef: "stash@{1}",
        mode: "apply",
      }),
    );
    await screen.unmount();
  });

  it("offers push, merge, and rebase for a local branch and runs the push it confirms", async () => {
    harness.contextMenuShow.mockResolvedValue("branch-push");
    const screen = await mount();

    await page.getByTitle("Local branch feature/local").click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toContain("checkout-branch");
    expect(ids).toContain("branch-push");
    expect(ids).toContain("branch-merge");
    expect(ids).toContain("branch-rebase");

    await expect.element(page.getByText("Push branch", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("git push --set-upstream origin feature/local"))
      .toBeVisible();
    await page.getByRole("button", { name: "Push" }).click();

    await vi.waitFor(() =>
      expect(harness.pushBranch).toHaveBeenCalledWith({
        cwd: "/repo",
        branch: "feature/local",
        remote: "origin",
        setUpstream: true,
        forceWithLease: false,
      }),
    );
    await screen.unmount();
  });

  it("drops checkout and offers pull for the checked-out branch that tracks an upstream", async () => {
    harness.listCommitHistory.mockResolvedValue({
      commits: [{ ...commit, refs: [{ name: "main", kind: "branch", checkedOut: true }] }],
      hasMore: false,
    });
    harness.listBranches.mockResolvedValue({
      branches: [
        {
          name: "main",
          current: true,
          isDefault: true,
          worktreePath: null,
          upstreamRemote: "origin",
        },
      ],
      isRepo: true,
      hasOriginRemote: true,
      remoteNames: ["origin"],
    });
    harness.contextMenuShow.mockResolvedValue("branch-pull");
    const screen = await mount();

    await page.getByTitle("Checked-out branch main").click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).not.toContain("checkout-branch");
    expect(ids).toContain("branch-push");
    expect(ids).toContain("branch-pull");
    expect(ids).not.toContain("branch-merge");

    await expect.element(page.getByText("Pull branch", { exact: true })).toBeVisible();
    await expect.element(page.getByText("git pull origin main")).toBeVisible();
    await page.getByRole("button", { name: "Pull" }).click();

    await vi.waitFor(() =>
      expect(harness.pullBranch).toHaveBeenCalledWith({
        cwd: "/repo",
        remote: "origin",
        branch: "main",
        rebase: false,
      }),
    );
    await screen.unmount();
  });

  it("hides pull for the checked-out branch when it has no upstream", async () => {
    harness.listCommitHistory.mockResolvedValue({
      commits: [{ ...commit, refs: [{ name: "main", kind: "branch", checkedOut: true }] }],
      hasMore: false,
    });
    harness.contextMenuShow.mockResolvedValue(undefined);
    await mount();

    await page.getByTitle("Checked-out branch main").click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toContain("branch-push");
    expect(ids).not.toContain("branch-pull");
  });

  it("offers merge and rebase for a non-current remote branch", async () => {
    harness.contextMenuShow.mockResolvedValue("branch-rebase");
    const screen = await mount();

    await page.getByTitle("Remote branch origin/feature").click({ button: "right" });

    const ids = contextMenuIds(
      harness.contextMenuShow.mock.calls.at(-1)![0] as readonly MenuItemLike[],
    );
    expect(ids).toContain("branch-merge");
    expect(ids).toContain("branch-rebase");
    expect(ids).not.toContain("branch-pull");

    await expect.element(page.getByText("Rebase branch", { exact: true })).toBeVisible();
    await expect.element(page.getByText("git rebase origin/feature")).toBeVisible();
    await page.getByRole("button", { name: "Rebase" }).click();

    await vi.waitFor(() =>
      expect(harness.rebaseBranch).toHaveBeenCalledWith({
        cwd: "/repo",
        ref: "origin/feature",
        autosquash: false,
      }),
    );
    await screen.unmount();
  });
});

interface MenuItemLike {
  id: string;
  children?: readonly MenuItemLike[];
}

/** Every id in a context menu, including the rows nested in submenus. */
function contextMenuIds(items: readonly MenuItemLike[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
    if (item.children) ids.push(...contextMenuIds(item.children));
  }
  return ids;
}
