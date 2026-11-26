// FILE: GitBranchActionDialog.browser.tsx
// Purpose: Confirms each branch action dialog shows the exact git command its
//          checkboxes produce, and that the merge squash option disables the two
//          flags git refuses to combine with it.
// Layer: Browser UI test

import "../../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({
  pushBranch: vi.fn(),
  pullBranch: vi.fn(),
  mergeBranch: vi.fn(),
  rebaseBranch: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    git: {
      pushBranch: harness.pushBranch,
      pullBranch: harness.pullBranch,
      mergeBranch: harness.mergeBranch,
      rebaseBranch: harness.rebaseBranch,
    },
  }),
}));
vi.mock("../../ui/toast", () => ({ toastManager: { add: harness.toastAdd } }));

import { GitBranchActionDialog, type GitBranchAction } from "./GitBranchActionDialog";

const clients: QueryClient[] = [];

async function mount(action: GitBranchAction) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const screen = await render(
    <QueryClientProvider client={client}>
      <GitBranchActionDialog open action={action} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
  return screen;
}

beforeEach(async () => {
  // A desktop viewport keeps DialogPopup out of its bottom-sheet layout.
  await page.viewport(1024, 800);
  harness.pushBranch.mockReset();
  harness.pullBranch.mockReset();
  harness.mergeBranch.mockReset();
  harness.rebaseBranch.mockReset();
  harness.toastAdd.mockReset();
  harness.pushBranch.mockResolvedValue({ ok: true });
  harness.pullBranch.mockResolvedValue({
    status: "pulled",
    branch: "main",
    upstreamBranch: "origin/main",
  });
  harness.mergeBranch.mockResolvedValue({ ok: true });
  harness.rebaseBranch.mockResolvedValue({ ok: true });
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe("GitBranchActionDialog", () => {
  it("defaults the upstream checkbox on when the branch has none", async () => {
    const screen = await mount({
      kind: "push",
      cwd: "/repo",
      branch: "feature/x",
      remote: "origin",
      hasUpstream: false,
    });

    await expect.element(page.getByText("git push --set-upstream origin feature/x")).toBeVisible();
    await expect
      .element(page.getByRole("checkbox", { name: "Set origin/feature/x as upstream" }))
      .toBeChecked();

    await page.getByRole("button", { name: "Push" }).click();
    await vi.waitFor(() =>
      expect(harness.pushBranch).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        branch: "feature/x",
        remote: "origin",
        setUpstream: true,
        forceWithLease: false,
      }),
    );
    await screen.unmount();
  });

  it("leaves the upstream checkbox off when the branch already tracks one", async () => {
    const screen = await mount({
      kind: "push",
      cwd: "/repo",
      branch: "feature/x",
      remote: "origin",
      hasUpstream: true,
    });

    await expect.element(page.getByText("git push origin feature/x")).toBeVisible();
    await expect
      .element(page.getByRole("checkbox", { name: "Set origin/feature/x as upstream" }))
      .not.toBeChecked();
    await screen.unmount();
  });

  it("adds --force-with-lease and sends it when the force checkbox is ticked", async () => {
    const screen = await mount({
      kind: "push",
      cwd: "/repo",
      branch: "feature/x",
      remote: "origin",
      hasUpstream: true,
    });

    await page.getByRole("checkbox", { name: "Force push (--force-with-lease)" }).click();
    await expect
      .element(page.getByText("git push --force-with-lease origin feature/x"))
      .toBeVisible();

    await page.getByRole("button", { name: "Push" }).click();
    await vi.waitFor(() =>
      expect(harness.pushBranch).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        branch: "feature/x",
        remote: "origin",
        setUpstream: false,
        forceWithLease: true,
      }),
    );
    await screen.unmount();
  });

  it("shows the merge flags and disables the conflicting ones while squashing", async () => {
    const screen = await mount({
      kind: "merge",
      cwd: "/repo",
      ref: "feature/x",
      currentBranch: "main",
    });

    await expect.element(page.getByText("Merge feature/x into main")).toBeVisible();
    await expect.element(page.getByText("git merge --no-ff feature/x")).toBeVisible();

    await page.getByRole("checkbox", { name: "Squash Commits" }).click();

    await expect.element(page.getByText("git merge --squash feature/x")).toBeVisible();
    await expect
      .element(
        page.getByRole("checkbox", {
          name: "Create a new commit even if fast-forward is possible",
        }),
      )
      .toBeDisabled();
    await expect.element(page.getByRole("checkbox", { name: "No Commit" })).toBeDisabled();

    await page.getByRole("button", { name: "Merge" }).click();
    await vi.waitFor(() =>
      expect(harness.mergeBranch).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        ref: "feature/x",
        noFastForward: true,
        squash: true,
        noCommit: false,
      }),
    );
    await screen.unmount();
  });

  it("adds --rebase to a pull when the checkbox is ticked", async () => {
    const screen = await mount({
      kind: "pull",
      cwd: "/repo",
      remote: "origin",
      branch: "main",
      currentBranch: "main",
    });

    await expect.element(page.getByText("git pull origin main")).toBeVisible();
    await page.getByRole("checkbox", { name: "Rebase instead of merge" }).click();
    await expect.element(page.getByText("git pull --rebase origin main")).toBeVisible();

    await page.getByRole("button", { name: "Pull" }).click();
    await vi.waitFor(() =>
      expect(harness.pullBranch).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        remote: "origin",
        branch: "main",
        rebase: true,
      }),
    );
    await screen.unmount();
  });

  it("runs an interactive autosquash rebase when the checkbox is ticked", async () => {
    const screen = await mount({
      kind: "rebase",
      cwd: "/repo",
      ref: "feature/x",
      currentBranch: "main",
    });

    await expect.element(page.getByText("git rebase feature/x")).toBeVisible();
    await page.getByRole("checkbox", { name: "Autosquash (apply fixup!/squash! commits)" }).click();
    await expect
      .element(page.getByText("git rebase --interactive --autosquash feature/x"))
      .toBeVisible();

    await page.getByRole("button", { name: "Rebase" }).click();
    await vi.waitFor(() =>
      expect(harness.rebaseBranch).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        ref: "feature/x",
        autosquash: true,
      }),
    );
    await screen.unmount();
  });
});
