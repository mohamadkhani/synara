// FILE: GitPanel.tsx
// Purpose: Right-dock Git pane. It is history-only, like a Git Graph view: the pane's
//          first row is the history toolbar (branch filter, search, refresh).
// Layer: Chat right-dock UI
//
// Staging moved out of this pane on purpose; file review lives in the Environment/Diff
// surfaces, so the pane spends its full height on the commit graph.

import { type ProjectId, type ThreadId } from "@synara/contracts";
import { useMemo } from "react";

import { useTheme } from "~/hooks/useTheme";
import { useStore } from "~/store";
import { createProjectSelector, createThreadWorkspaceMetadataSelector } from "~/storeSelectors";
import { useTranslation } from "~/i18n";
import { PanelStateMessage } from "./PanelStateMessage";
import { GitHistoryPanel } from "./gitHistory/GitHistoryPanel";

export function GitPanel(props: { hostThreadId: ThreadId; projectId: ProjectId | null }) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  // Shell-only, like DockTerminalPane: only `worktreePath` is read here, and the
  // full thread selector would re-render the pane on every streamed token.
  const threadWorkspace = useStore(
    useMemo(() => createThreadWorkspaceMetadataSelector(props.hostThreadId), [props.hostThreadId]),
  );
  const project = useStore(
    useMemo(() => createProjectSelector(props.projectId), [props.projectId]),
  );
  const cwd = threadWorkspace.worktreePath ?? project?.cwd ?? null;

  if (!cwd) {
    return <PanelStateMessage>{t("git:gitPanel_unavailableForThread")}</PanelStateMessage>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <GitHistoryPanel
        activeCwd={cwd}
        primaryCwd={project?.cwd ?? null}
        theme={resolvedTheme as "light" | "dark"}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

export default GitPanel;
