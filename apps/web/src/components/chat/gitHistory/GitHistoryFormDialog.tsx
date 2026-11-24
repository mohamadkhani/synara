// FILE: GitHistoryFormDialog.tsx
// Purpose: Shared shell for the Git Graph dialogs that collect a few fields: title,
//          description, field body, an error line, and a cancel/confirm footer.
// Layer: Git history UI

import { useId, type ComponentProps, type ReactNode } from "react";

import { useTranslation } from "~/i18n";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
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
  // Submit button lives in the footer, outside the form element, so it targets the
  // form by id (Enter still submits from a text field).
  const formId = useId();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        {/* The dialog popup is a flex column that sizes the panel and footer as its
            own children; wrapping them in a form made the footer escape the card. */}
        <DialogPanel className="flex flex-col gap-3">
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              props.onSubmit();
            }}
          >
            {props.children}
            {props.error ? (
              <p role="alert" className="text-ui-sm text-destructive">
                {props.error}
              </p>
            ) : null}
          </form>
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
            form={formId}
            {...(props.confirmVariant ? { variant: props.confirmVariant } : {})}
            disabled={props.pending || props.submitDisabled === true}
          >
            {props.pending ? <Spinner aria-hidden className="size-3.5" /> : null}
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
