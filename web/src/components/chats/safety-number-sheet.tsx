"use client";

import { QRCodeCanvas } from "qrcode.react";
import { Check, Copy, QrCode, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { formatSafetyNumber } from "@/lib/e2ee/fingerprint";
import { BottomSheet } from "../ui/bottom-sheet";
import { useToast } from "../ui/toast";

/**
 * Safety-number verification for a secret chat.
 *
 * The number is derived only from the two devices' long-lived identity public keys, so both
 * people see the same 60 digits. Reading them aloud (or comparing the QR side by side) proves no
 * one swapped a key in the middle. The number changes if either identity key changes — a new
 * device, a re-install, or an attacker — which is the whole signal to look for.
 *
 * `peerName` is only a label; the guarantee comes from the digits, never from the name.
 */
export function SafetyNumberSheet({
  open,
  onOpenChange,
  peerName,
  safetyNumber,
  safetyQr
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerName: string;
  safetyNumber: string | null;
  safetyQr: string | null;
}) {
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const formatted = safetyNumber ? formatSafetyNumber(safetyNumber) : null;

  const copy = async () => {
    if (!formatted) return;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notify("Код безопасности скопирован", { variant: "success" });
    } catch {
      notify("Не удалось скопировать", { variant: "error" });
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Код безопасности"
      description="Сверьте ключи шифрования с собеседником"
    >
      <div className="pb-4">
        <div className="flex flex-col items-center gap-2 pb-5 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
            <ShieldCheck size={24} />
          </span>
          <h2 className="m-0 text-[19px] font-bold">Код безопасности</h2>
          <p className="m-0 max-w-[42ch] text-[13px] leading-5 text-[var(--muted)]">
            Этот код одинаков у вас и у {peerName}. Сверьте его при личной встрече или по другому
            каналу — если он совпадает, переписку никто не перехватывает.
          </p>
        </div>

        {formatted ? (
          <>
            {safetyQr ? (
              <div className="mx-auto mb-5 w-fit rounded-[20px] bg-white p-4 shadow-[0_14px_36px_rgba(0,0,0,.3)]">
                <QRCodeCanvas
                  value={safetyQr}
                  size={512}
                  level="M"
                  marginSize={2}
                  bgColor="#ffffff"
                  fgColor="#0b0b0f"
                  title={`Код безопасности секретного чата с ${peerName}`}
                  style={{ width: 190, height: 190, maxWidth: "100%" }}
                />
              </div>
            ) : null}

            <div className="mx-auto max-w-[360px] rounded-[18px] bg-white/[0.05] px-4 py-4 shadow-[inset_0_0_0_1px_var(--sheet-line)]">
              <p className="m-0 select-all text-center font-mono text-[17px] leading-8 tracking-[0.08em] text-[var(--ink)]">
                {formatted}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void copy()}
              className="mx-auto mt-4 flex items-center justify-center gap-2 rounded-full bg-white/[0.06] px-4 py-2.5 text-[14px] font-semibold transition active:scale-95"
            >
              {copied ? <Check size={17} className="text-emerald-400" /> : <Copy size={17} />}
              {copied ? "Скопировано" : "Скопировать код"}
            </button>

            <p className="mx-auto mt-5 flex max-w-[42ch] items-start gap-2 text-[12px] leading-5 text-[var(--faint)]">
              <QrCode size={15} className="mt-0.5 flex-none" />
              Если код изменился после переустановки или смены устройства — это нормально. Если он
              изменился без причины, сверьте его заново: ключи могли подменить.
            </p>
          </>
        ) : (
          <div className="mx-auto max-w-[360px] rounded-[18px] bg-white/[0.04] px-5 py-8 text-center">
            <p className="m-0 text-[14px] leading-6 text-[var(--muted)]">
              Код появится, как только вы отправите или получите первое сообщение в этом секретном
              чате — тогда на устройствах установятся ключи шифрования.
            </p>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
