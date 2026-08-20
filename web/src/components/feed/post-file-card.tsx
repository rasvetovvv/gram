"use client";

import { Download, FileArchive, FileCode2, FileText } from "lucide-react";
import { API_URL } from "@/lib/api";

/**
 * The document a post carries.
 *
 * The name and the size are shown before anything is fetched, because deciding whether to pull
 * down 12 MB is the reader's call. The link always downloads: the server refuses to serve these
 * inline, and a browser that decided for itself would turn an upload into a page.
 */
const ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  zip: FileArchive,
  json: FileCode2,
  csv: FileCode2,
  md: FileText,
  txt: FileText,
  log: FileText
};

function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} МБ`;
}

export function PostFileCard({
  url,
  name,
  size
}: {
  url: string;
  name: string;
  size?: number | null;
}) {
  const extension = (name.split(".").pop() ?? "").toLowerCase();
  const Icon = ICONS[extension] ?? FileText;
  const href = url.startsWith("http") ? url : `${API_URL}${url}`;
  return (
    <a
      href={href}
      download={name}
      data-keep-click
      className="mt-2 flex items-center gap-3 rounded-[16px] border border-[var(--line)] bg-white/[0.04] p-2 pr-3 transition hover:bg-white/[0.07]"
    >
      <span className="grid size-12 flex-none place-items-center rounded-[13px] bg-black/25 text-[var(--primary-strong)]">
        <Icon size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold">{name}</span>
        <span className="mt-0.5 block text-[12px] uppercase tracking-wide text-[var(--dim)]">
          {extension || "файл"}
          {typeof size === "number" ? ` · ${readableSize(size)}` : ""}
        </span>
      </span>
      <span
        aria-hidden
        className="grid size-9 flex-none place-items-center rounded-full bg-white/10 text-[var(--ink)]"
      >
        <Download size={16} />
      </span>
    </a>
  );
}
