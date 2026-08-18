"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NotebookPen, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@/lib/api";

const schema = z.object({ content: z.string().trim().max(200, "Не больше 200 символов") });
type Values = z.infer<typeof schema>;

/**
 * The note is written by the profile owner and read by everyone, so visitors get a
 * read-only bubble and only the owner sees an editor.
 */
export function NoteDialog({
  username,
  note,
  canEdit,
  variant = "card"
}: {
  username: string;
  note?: string | null;
  canEdit: boolean;
  variant?: "card" | "bubble";
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { content: note ?? "" } });
  useEffect(() => form.reset({ content: note ?? "" }), [note, form]);
  const save = useMutation({
    mutationFn: ({ content }: Values) => api.saveProfileNote(content),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile", username] }),
        queryClient.invalidateQueries({ queryKey: ["me"] })
      ]);
      setOpen(false);
    }
  });

  if (!canEdit) {
    if (!note) return null;
    return variant === "bubble" ? (
      <p className="m-0 max-w-[190px] truncate rounded-full bg-[#2a2a31]/95 px-3 py-2 text-xs font-medium text-white shadow-[0_9px_24px_rgba(0,0,0,.38)] backdrop-blur-md">
        {note}
      </p>
    ) : (
      <p className="m-0 rounded-[18px] bg-[var(--surface)] px-4 py-3.5 text-sm leading-6 text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line)]">
        {note}
      </p>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        {variant === "bubble" ? (
          <button className="flex max-w-[190px] items-center gap-2 rounded-full bg-[#2a2a31]/95 px-3 py-2 text-left text-xs font-medium text-white shadow-[0_9px_24px_rgba(0,0,0,.38)] backdrop-blur-md">
            <NotebookPen size={14} className="flex-none text-[var(--link)]" />
            <span className="truncate">{note || "Заметка…"}</span>
          </button>
        ) : (
          <button className="group flex w-full items-center gap-3 rounded-[18px] bg-[var(--surface)] px-4 py-3.5 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-[var(--surface-raised)]">
            <span className="grid size-10 flex-none place-items-center rounded-[14px] bg-[var(--surface-raised)] text-[var(--link)]"><NotebookPen size={19} /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold">Заметка в профиле</span><span className="mt-0.5 block truncate text-xs text-[var(--muted)]">{note || "Короткая строка, которую увидят все"}</span></span>
            <span className="text-xs font-bold text-[var(--link)]">{note ? "ИЗМЕНИТЬ" : "ДОБАВИТЬ"}</span>
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-[24px] border border-[var(--sheet-line)] bg-[var(--sheet)] p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-bold">Заметка в профиле</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-5 text-[var(--muted)]">
                Её увидит каждый, кто откроет ваш профиль.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button -mr-2 -mt-2" aria-label="Закрыть"><X size={20} /></Dialog.Close>
          </div>
          <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="mt-5">
            <textarea autoFocus rows={4} maxLength={200} className="field resize-none p-4 text-sm leading-6" placeholder="Например: открыт к сотрудничеству, пишите в личку" {...form.register("content")} />
            <div className="mt-2 min-h-5 text-xs text-[var(--danger)]">{form.formState.errors.content?.message ?? save.error?.message}</div>
            <div className="mt-3 flex justify-end"><button className="signal-button" disabled={save.isPending}><Save size={17} />{save.isPending ? "Сохраняем…" : "Сохранить"}</button></div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
