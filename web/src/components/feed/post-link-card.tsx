"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "../ui/confirm-dialog";

/**
 * A link the author attached on purpose, and the warning before following it.
 *
 * Leaving GRAM is the kind of thing a reader should agree to knowingly, so the dialog names the
 * host rather than the whole URL — a long link with a familiar word in its path is exactly how
 * people are talked into clicking.
 */
export function PostLinkCard({ url, title }: { url: string; title?: string | null }) {
  const [asking, setAsking] = useState(false);
  let host = url;
  try {
    host = new URL(url).host.replace(/^www\./, "");
  } catch {
    // A malformed link still gets a card, just without a tidy host.
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="mt-3 flex w-full items-center gap-3 rounded-[12px] border border-white/[0.07] bg-white/[0.04] p-2 pr-3 text-left transition hover:bg-white/[0.07] active:scale-[0.99]"
      >
        <span className="grid size-12 flex-none place-items-center rounded-xl bg-white/[0.06] text-[var(--link)]">
          <ExternalLink size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold text-[var(--ink)]">
            {title || host}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-[var(--muted)]">{host}</span>
        </span>
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[var(--dim)]">
          Ссылка
        </span>
      </button>

      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Переход на внешний сайт"
        description={`Вы покидаете GRAM и открываете ${host}. Мы не отвечаем за содержимое чужих сайтов — не вводите там пароль от GRAM.`}
        confirmLabel="Перейти"
        cancelLabel="Остаться"
        tone="primary"
        onConfirm={() => {
          setAsking(false);
          window.open(url, "_blank", "noopener,noreferrer");
        }}
      />
    </>
  );
}
