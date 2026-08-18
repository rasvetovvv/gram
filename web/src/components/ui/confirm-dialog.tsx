"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle } from "lucide-react";

/**
 * Centred confirmation for irreversible or paid actions — deleting a post, cancelling a
 * paid subscription. Destructive confirmations should never be one tap away, which is why
 * the calling menus hand off to this instead of mutating directly.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Отмена",
  tone = "danger",
  error,
  pending,
  onConfirm
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  error?: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm data-[state=open]:animate-[sheetFade_.18s_ease-out]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[96] w-[min(24rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 rounded-[24px] bg-[var(--surface)] p-5 shadow-[0_24px_70px_rgba(0,0,0,.66),inset_0_0_0_1px_var(--line)] outline-none">
          <div className="flex items-start gap-3">
            <span
              className="grid size-10 flex-none place-items-center rounded-full"
              style={
                tone === "danger"
                  ? { background: "rgba(229,57,53,.14)", color: "var(--danger)" }
                  : { background: "var(--primary-dim)", color: "var(--primary-strong)" }
              }
            >
              <AlertTriangle size={19} />
            </span>
            <div className="min-w-0">
              <Dialog.Title className="m-0 text-lg font-extrabold leading-tight">{title}</Dialog.Title>
              <Dialog.Description className="mb-0 mt-1.5 text-[14px] leading-5 text-[var(--muted)]">
                {description}
              </Dialog.Description>
            </div>
          </div>

          {error ? (
            <p className="mb-0 mt-3 text-[13px] text-[var(--danger)]" aria-live="polite">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex gap-2">
            <Dialog.Close className="quiet-button flex-1">{cancelLabel}</Dialog.Close>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="flex min-h-[46px] flex-1 items-center justify-center rounded-full border-0 px-4 font-bold text-white transition disabled:opacity-60"
              style={{ background: tone === "danger" ? "var(--danger)" : "var(--primary)" }}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
