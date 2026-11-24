// FILE: GitHistoryFormDialog.tsx
// Purpose: Shared shell for the Git Graph dialogs that collect a few fields: title,
//          description, field body, an error line, and a cancel/confirm footer.
// Layer: Git history UI

import type { ComponentProps, ReactNode } from "react";

import { useTranslation } from "~/i18n";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";

export function GitHistoryFormDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: ComponentProps<typeof Button>["variant"];
  /** Blocks the confirm button without blocking cancel. */
  submitDisabled?: boolean;
  /** An action is in flight: the footer stays disabled. */
  pending: boolean;
  error: string | null;
  onSubmit: () => void;
  /** Field controls; the caller owns their state. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <DialogPanel className="flex flex-col gap-3">
            {props.children}
            {props.error ? (
              <p role="alert" className="text-ui-sm text-destructive">
                {props.error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
              disabled={props.pending}
            >
              {t("common:form_cancel")}
            </Button>
            <Button
              type="submit"
              {...(props.confirmVariant ? { variant: props.confirmVariant } : {})}
              disabled={props.pending || props.submitDisabled === true}
            >
              {props.confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
