// FILE: GitDeleteRefDialog.browser.tsx
// Purpose: Confirms the delete-ref dialog sends the remote opt-in and asks a second
//          time before force-deleting a branch with unmerged commits.
// Layer: Browser UI test

import "../../../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const harness = vi.hoisted(() => ({
  deleteBranchRef: vi.fn(),
  deleteTagRef: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("~/nativeApi", () => ({
  ensureNativeApi: () => ({
    git: {
      deleteBranchRef: harness.deleteBranchRef,
      deleteTagRef: harness.deleteTagRef,
    },
  }),
}));
vi.mock("../../ui/toast", () => ({ toastManager: { add: harness.toastAdd } }));

import { GitDeleteRefDialog } from "./GitDeleteRefDialog";

const clients: QueryClient[] = [];

async function mount(props: {
  kind: "branch" | "tag";
  name: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const screen = await render(
    <QueryClientProvider client={client}>
      <GitDeleteRefDialog
        open
        kind={props.kind}
        cwd="/repo"
        name={props.name}
        onOpenChange={props.onOpenChange ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
  return screen;
}

beforeEach(async () => {
  // A desktop viewport keeps DialogPopup out of its bottom-sheet layout, whose
  // footer would otherwise sit below the fold and make the confirm unreachable.
  await page.viewport(1024, 800);
  harness.deleteBranchRef.mockReset();
  harness.deleteTagRef.mockReset();
  harness.toastAdd.mockReset();
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe("GitDeleteRefDialog", () => {
  it("sends deleteRemote when the remote checkbox is ticked", async () => {
    harness.deleteBranchRef.mockResolvedValue({ remoteName: "origin", requiresForce: false });
    const screen = await mount({ kind: "branch", name: "feature/x" });

    await page.getByRole("checkbox", { name: "Also delete from the remote" }).click();
    await page.getByRole("button", { name: "Delete" }).click();

    await vi.waitFor(() =>
      expect(harness.deleteBranchRef).toHaveBeenCalledExactlyOnceWith({
        cwd: "/repo",
        branch: "feature/x",
        deleteRemote: true,
      }),
    );
    await screen.unmount();
  });

  it("asks a second time before force-deleting a branch with unmerged commits", async () => {
    harness.deleteBranchRef
      .mockResolvedValueOnce({ remoteName: null, requiresForce: true })
      .mockResolvedValueOnce({ remoteName: null, requiresForce: false });
    const onOpenChange = vi.fn();
    const screen = await mount({ kind: "branch", name: "feature/unmerged", onOpenChange });

    await page.getByRole("button", { name: "Delete" }).click();

    // The plain delete was refused, so the dialog switches to the force confirmation
    // without deleting or closing yet.
    await expect.element(page.getByRole("button", { name: "Delete anyway" })).toBeVisible();
    expect(harness.deleteBranchRef).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Delete anyway" }).click();

    await vi.waitFor(() =>
      expect(harness.deleteBranchRef).toHaveBeenLastCalledWith({
        cwd: "/repo",
        branch: "feature/unmerged",
        deleteRemote: false,
        force: true,
      }),
    );
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await screen.unmount();
  });
});
