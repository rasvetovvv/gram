"use client";

/**
 * Credit and disclaimer for the gift artwork, on the surfaces where that artwork appears.
 *
 * Two separate obligations, met in one line each. The data and asset API asks for a visible
 * thank-you as its condition of use, and it has to be reachable by an actual user rather than
 * buried in a repository. Separately, the artwork is Telegram's, and this product is not
 * affiliated with Telegram — so it says so where the artwork is shown, not in a file nobody
 * opens.
 */
export function GiftArtCredit({ className = "" }: { className?: string }) {
  return (
    <p
      className={`mb-0 px-1 text-[11px] leading-4 text-[var(--faint)] ${className}`}
      data-testid="gift-art-credit"
    >
      Оформление подарков — коллекционные подарки Telegram. Данные и изображения:{" "}
      <a
        href="https://api.changes.tg"
        target="_blank"
        rel="noreferrer noopener"
        className="text-[var(--link)]"
      >
        api.changes.tg
      </a>{" "}
      — thanks to @GiftChanges for this API. GRAM не связан с Telegram; права на изображения
      принадлежат их владельцам.
    </p>
  );
}
