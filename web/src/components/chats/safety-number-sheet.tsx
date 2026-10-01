"use client";

import { QRCodeCanvas } from "qrcode.react";
import { AlertTriangle, Check, Copy, KeyRound, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { formatSafetyNumber, type VerificationStatus } from "@/lib/e2ee/fingerprint";
import type { KeyHealth } from "./use-secret-chat";
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
 * The user can mark the key as verified once they have compared it; the trust state persists on
 * the device and surfaces again as a warning if the peer's key later changes.
 *
 * `peerName` is only a label; the guarantee comes from the digits, never from the name.
 */
export function SafetyNumberSheet({
  open,
  onOpenChange,
  peerName,
  safetyNumber,
  safetyQr,
  verification,
  onMarkVerified,
  onReVerify,
  keyHealth
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerName: string;
  safetyNumber: string | null;
  safetyQr: string | null;
  verification: VerificationStatus;
  onMarkVerified: () => Promise<void> | void;
  onReVerify: () => Promise<void> | void;
  keyHealth: KeyHealth | null;
}) {
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
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

  const verify = async () => {
    setBusy(true);
    try {
      await onMarkVerified();
      notify("Собеседник отмечен как проверенный", { variant: "success" });
    } finally {
      setBusy(false);
    }
  };

  const reVerify = async () => {
    setBusy(true);
    try {
      await onReVerify();
    } finally {
      setBusy(false);
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
          {verification === "changed" ? (
            <span className="grid size-12 place-items-center rounded-full bg-amber-500/15 text-amber-400">
              <AlertTriangle size={24} />
            </span>
          ) : (
            <span className="grid size-12 place-items-center rounded-full bg-emerald-500/15 text-emerald-400">
              <ShieldCheck size={24} />
            </span>
          )}
          <h2 className="m-0 text-[19px] font-bold">Код безопасности</h2>
          <p className="m-0 max-w-[42ch] text-[13px] leading-5 text-[var(--muted)]">
            Этот код одинаков у вас и у {peerName}. Сверьте его при личной встрече или по другому
            каналу — если он совпадает, переписку никто не перехватывает.
          </p>
        </div>

        {verification === "changed" ? (
          <div className="mx-auto mb-5 max-w-[380px] rounded-[16px] bg-amber-500/10 px-4 py-3 text-left shadow-[inset_0_0_0_1px_rgba(251,191,36,.25)]">
            <p className="m-0 flex items-start gap-2 text-[13px] leading-5 text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 flex-none" />
              Ключ собеседника изменился с момента последней проверки. Это бывает после смены
              устройства или переустановки — но также может означать перехват. Сверьте код заново,
              прежде чем доверять переписке.
            </p>
          </div>
        ) : null}

        {verification === "verified" ? (
          <div className="mx-auto mb-5 flex max-w-[380px] items-center justify-center gap-2 rounded-full bg-emerald-500/15 px-4 py-2 text-[13px] font-semibold text-emerald-400">
            <Check size={16} />
            Собеседник проверен
          </div>
        ) : null}

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

            <div className="mx-auto mt-4 flex max-w-[360px] flex-col gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="flex items-center justify-center gap-2 rounded-full bg-white/[0.06] px-4 py-2.5 text-[14px] font-semibold transition active:scale-95"
              >
                {copied ? <Check size={17} className="text-emerald-400" /> : <Copy size={17} />}
                {copied ? "Скопировано" : "Скопировать код"}
              </button>

              {verification === "verified" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reVerify()}
                  className="flex items-center justify-center gap-2 rounded-full bg-white/[0.04] px-4 py-2.5 text-[14px] font-semibold text-[var(--muted)] transition active:scale-95 disabled:opacity-50"
                >
                  Снять отметку о проверке
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void verify()}
                  className="flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-4 py-2.5 text-[14px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
                >
                  <ShieldCheck size={17} />
                  {verification === "changed" ? "Код совпадает — подтвердить" : "Отметить как проверенный"}
                </button>
              )}
            </div>

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

        {keyHealth ? (
          <div className="mx-auto mt-6 max-w-[380px] rounded-[16px] bg-white/[0.04] px-4 py-3.5">
            <p className="m-0 mb-2 flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--faint)]">
              <KeyRound size={14} />
              Ключи этого устройства
            </p>
            <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
              <span className="text-[var(--muted)]">Одноразовые предключи</span>
              <span className={keyHealth.low ? "font-semibold text-amber-400" : "text-[var(--ink)]"}>
                {keyHealth.oneTimePreKeys} / {keyHealth.target}
                {keyHealth.low ? " · пополняются" : ""}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
              <span className="flex items-center gap-1.5 text-[var(--muted)]">
                <RefreshCw size={13} />
                Подписанный предключ
              </span>
              <span className="text-[var(--ink)]">
                {keyHealth.signedPreKeyAgeDays === 0
                  ? "обновлён сегодня"
                  : `${keyHealth.signedPreKeyAgeDays} дн.`}
                {" · ротация каждые "}
                {keyHealth.signedPreKeyMaxAgeDays} дн.
              </span>
            </div>
            <p className="m-0 mt-2 text-[11px] leading-4 text-[var(--faint)]">
              Предключи и их ротация обновляются автоматически — на сервере лежат только публичные
              значения.
            </p>
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
