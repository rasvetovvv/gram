"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import type { PostReportReason } from "@/lib/api";
import { BottomSheet } from "./bottom-sheet";

/** The reference's own reasons, in its own order. */
export const REPORT_REASONS: { value: PostReportReason; label: string; hint: string }[] = [
  { value: "spam", label: "Spam", hint: "Ads, engagement farming, repetitive posts." },
  { value: "abuse", label: "Abuse", hint: "Harassment, hostility, threats." },
  { value: "adult", label: "Adult content", hint: "Not for everyone and posted without warning." },
  { value: "fraud", label: "Deception", hint: "Scams, fake sales." },
  { value: "violence", label: "Violence", hint: "Cruelty and calls for it." },
  { value: "other", label: "Other", hint: "Describe what's wrong." }
];

/**
 * One way to complain, wherever the complaint is about.
 *
 * A post and an account are reported on the same terms, so they share this sheet and differ
 * only in what the caller does with the answer.
 */
export function ReportSheet({
  open,
  onOpenChange,
  subject,
  note,
  pending,
  onSend
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being reported, named in the sheet's own subtitle. */
  subject: string;
  note: string;
  pending?: boolean;
  onSend: (reason: PostReportReason, comment: string) => void;
}) {
  const [reason, setReason] = useState<PostReportReason>("spam");
  const [comment, setComment] = useState("");

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Report"
      description={subject}
      footer={
        <button
          type="button"
          className="profile-primary-action w-full"
          disabled={pending}
          onClick={() => onSend(reason, comment)}
        >
          {pending ? "Sending…" : "Submit report"}
        </button>
      }
    >
      <div className="pb-2">
        <h2 className="m-0 text-[19px] font-bold">Report</h2>
        <p className="mb-4 mt-1 text-[13px] text-[var(--muted)]">{note}</p>

        <div role="radiogroup" aria-label="Reason for report" className="grid gap-1.5">
          {REPORT_REASONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={reason === option.value}
              onClick={() => setReason(option.value)}
              className="flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition"
              style={reason === option.value ? { background: "var(--surface-raised)" } : undefined}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[0.95rem] font-semibold">{option.label}</span>
                <span className="block text-[12px] leading-4 text-[var(--muted)]">
                  {option.hint}
                </span>
              </span>
              <span
                aria-hidden
                className="grid size-5 flex-none place-items-center rounded-full border"
                style={{
                  borderColor:
                    reason === option.value ? "var(--primary-strong)" : "var(--line-strong)",
                  background: reason === option.value ? "var(--primary-strong)" : "transparent"
                }}
              >
                {reason === option.value ? <Check size={13} /> : null}
              </span>
            </button>
          ))}
        </div>

        <label className="mt-3 grid gap-1.5">
          <span className="text-[0.95rem] font-bold">What happened</span>
          <textarea
            className="field min-h-20 resize-none px-4 py-3 text-sm"
            value={comment}
            maxLength={300}
            placeholder="Optional"
            aria-label="Report details"
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
      </div>
    </BottomSheet>
  );
}