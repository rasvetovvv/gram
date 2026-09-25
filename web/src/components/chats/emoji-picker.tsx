"use client";

import * as Popover from "@radix-ui/react-popover";
import { Smile } from "lucide-react";
import { memo, useState } from "react";

/**
 * The composer's emoji keyboard, following the reference's own panel: a translucent 20px
 * sheet above the field, a category strip, and a dense grid.
 *
 * The set is grouped the way the reference groups it ("Smileys & people" first). It is written
 * out rather than pulled from a package so the panel costs nothing to load.
 */
const GROUPS: { key: string; label: string; glyph: string; emoji: string[] }[] = [
  {
    key: "people",
    label: "Smileys & people",
    glyph: "😀",
    emoji: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩",
      "😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐",
      "🤨","😐","😑","😶","😏","😒","🙄","😬","😮‍💨","🤥","😌","😔","😪","🤤","😴","😷",
      "🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐",
      "😕","😟","🙁","☹️","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭",
      "😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀","☠️",
      "💩","🤡","👹","👺","👻","👽","🤖","😺","😸","😹","😻","😼","😽","🙀","😿","😾",
      "👋","🤚","✋","🖖","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆",
      "👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","💅","🤳",
      "💪","🦾","🦵","🦶","👂","🦻","👃","🧠","🫀","🫁","🦷","🦴","👀","👁️","👅","👄"
    ]
  },
  {
    key: "nature",
    label: "Animals & nature",
    glyph: "🐶",
    emoji: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐸","🐵",
      "🙈","🙉","🙊","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝",
      "🪱","🐛","🦋","🐌","🐞","🐜","🪰","🕷️","🦂","🐢","🐍","🦎","🦖","🐙","🦑","🦐",
      "🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🐘","🦛","🐪",
      "🦙","🦒","🐃","🐄","🐎","🐖","🐏","🐑","🦌","🐕","🐩","🦮","🐈","🐓","🦃","🦚",
      "🌵","🎄","🌲","🌳","🌴","🪴","🌱","🌿","☘️","🍀","🎍","🍃","🍂","🍁","🍄","🌾",
      "💐","🌷","🌹","🥀","🌺","🌸","🌼","🌻","🌞","🌝","🌚","🌙","⭐","🌟","✨","⚡",
      "🔥","🌈","☀️","⛅","☁️","🌧️","⛈️","❄️","☃️","💧","🌊","🫧"
    ]
  },
  {
    key: "food",
    label: "Food & drink",
    glyph: "🍎",
    emoji: [
      "🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥",
      "🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅","🥔","🍠",
      "🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭",
      "🍔","🍟","🍕","🥪","🥙","🧆","🌮","🌯","🥗","🥘","🍝","🍜","🍲","🍛","🍣","🍱",
      "🥟","🍤","🍙","🍚","🍘","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂",
      "🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","☕","🍵","🧃","🥤",
      "🧋","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊"
    ]
  },
  {
    key: "activity",
    label: "Activities",
    glyph: "⚽",
    emoji: [
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍",
      "🏏","🪃","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿","⛷️","🏂","🪂","🏋️","🤼",
      "🤸","⛹️","🤺","🤾","🏌️","🏇","🧘","🏄","🏊","🤽","🚣","🧗","🚵","🚴","🏆","🥇",
      "🥈","🥉","🏅","🎖️","🎗️","🎫","🎪","🤹","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎹",
      "🥁","🎷","🎺","🪗","🎸","🪕","🎻","🎲","♟️","🎯","🎳","🎮","🎰","🧩"
    ]
  },
  {
    key: "travel",
    label: "Travel & places",
    glyph: "🚗",
    emoji: [
      "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🦯","🦽",
      "🚲","🛴","🛵","🏍️","🛺","🚨","🚔","🚍","🚘","🚖","🚡","🚠","🚟","🚃","🚋","🚞",
      "🚝","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈️","🛫","🛬","🛩️","💺","🛰️","🚀",
      "🛸","🚁","🛶","⛵","🚤","🛥️","🛳️","⛴️","🚢","⚓","🪝","⛽","🚧","🚦","🚥","🗺️",
      "🗿","🗽","🗼","🏰","🏯","🏟️","🎡","🎢","🎠","⛲","⛱️","🏖️","🏝️","🏜️","🌋","⛰️",
      "🏔️","🗻","🏕️","⛺","🏠","🏡","🏘️","🏚️","🏗️","🏭","🏢","🏬","🏣","🏤","🏥","🏦",
      "🏨","🏪","🏫","🏩","💒","🏛️","⛪","🕌","🕍","🛕","🌁","🌃","🏙️","🌄","🌅","🌆"
    ]
  },
  {
    key: "objects",
    label: "Objects",
    glyph: "💡",
    emoji: [
      "⌚","📱","💻","⌨️","🖥️","🖨️","🖱️","💽","💾","💿","📀","📼","📷","📸","📹","🎥",
      "📞","☎️","📟","📠","📺","📻","🎙️","⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋","🔌",
      "💡","🔦","🕯️","🪔","🧯","🛢️","💸","💵","💴","💶","💷","🪙","💰","💳","💎","⚖️",
      "🪜","🧰","🪛","🔧","🔨","⚒️","🛠️","⛏️","🪚","🔩","⚙️","🧱","⛓️","🧲","🔫","💣",
      "🧨","🪓","🔪","🗡️","⚔️","🛡️","🚬","⚰️","🪦","⚱️","🏺","🔮","📿","🧿","💈","⚗️",
      "🔭","🔬","🕳️","🩹","🩺","💊","💉","🩸","🧬","🦠","🧫","🧪","🌡️","🧹","🧺","🧻",
      "🚽","🚰","🚿","🛁","🛀","🧼","🪥","🪒","🧽","🪣","🧴","🛎️","🔑","🗝️","🚪","🪑",
      "🛋️","🛏️","🛌","🧸","🖼️","🛍️","🛒","🎁","🎈","🎏","🎀","🪄","🪅","🎊","🎉","🎎"
    ]
  },
  {
    key: "symbols",
    label: "Symbols",
    glyph: "❤️",
    emoji: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖",
      "💘","💝","💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈",
      "♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️",
      "📴","📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹",
      "🈲","🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨️",
      "🚷","🚯","🚳","🚱","🔞","📵","❗","❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️",
      "🔱","⚜️","🔰","♻️","✅","🈯","💹","❇️","✳️","❎","🌐","💠","Ⓜ️","🌀","💤","🏧"
    ]
  },
  {
    key: "flags",
    label: "Flags",
    glyph: "🏁",
    emoji: [
      "🏁","🚩","🎌","🏴","🏳️","🏳️‍🌈","🏳️‍⚧️","🏴‍☠️","🇷🇺","🇺🇦","🇧🇾","🇰🇿","🇺🇸","🇬🇧","🇩🇪","🇫🇷",
      "🇮🇹","🇪🇸","🇵🇹","🇳🇱","🇧🇪","🇨🇭","🇦🇹","🇸🇪","🇳🇴","🇩🇰","🇫🇮","🇵🇱","🇨🇿","🇸🇰","🇭🇺","🇷🇴",
      "🇬🇷","🇹🇷","🇬🇪","🇦🇲","🇦🇿","🇮🇱","🇦🇪","🇸🇦","🇪🇬","🇿🇦","🇮🇳","🇨🇳","🇯🇵","🇰🇷","🇹🇭","🇻🇳",
      "🇮🇩","🇸🇬","🇦🇺","🇳🇿","🇨🇦","🇧🇷","🇦🇷","🇲🇽","🇨🇱","🇨🇴","🇵🇪","🇨🇺"
    ]
  }
];

function EmojiPickerPanel({ onPick }: { onPick: (emoji: string) => void }) {
  const [group, setGroup] = useState(GROUPS[0].key);
  const active = GROUPS.find((item) => item.key === group) ?? GROUPS[0];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex size-9 flex-none items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-white/10 hover:text-[var(--ink)] active:scale-95"
          aria-label="Emoji"
        >
          <Smile size={22} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          className="z-[120] flex h-[420px] w-[min(374px,calc(100vw-1rem))] flex-col overflow-hidden rounded-[20px] border border-white/5 shadow-[0_18px_50px_rgba(0,0,0,.55)]"
          style={{ background: "rgba(33,33,33,.75)", backdropFilter: "blur(24px) saturate(1.4)" }}
        >
          <div
            role="tablist"
            aria-label="Emoji categories"
            className="flex flex-none items-center gap-0.5 overflow-x-auto border-b border-white/[0.06] px-1.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {GROUPS.map((item) => (
              <button
                key={item.key}
                role="tab"
                aria-selected={item.key === group}
                aria-label={item.label}
                title={item.label}
                onClick={() => setGroup(item.key)}
                className="grid size-9 flex-none place-items-center rounded-[12px] text-[19px] transition"
                style={item.key === group ? { background: "rgba(255,255,255,.12)" } : undefined}
              >
                {item.glyph}
              </button>
            ))}
          </div>
          <p className="m-0 flex-none px-3 pt-2 text-[12px] font-semibold uppercase tracking-[.06em] text-white/45">
            {active.label}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            <div className="grid grid-cols-8 gap-0.5">
              {active.emoji.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onPick(emoji)}
                  aria-label={emoji}
                  className="grid aspect-square place-items-center rounded-[10px] text-[24px] leading-none transition hover:bg-white/10 active:scale-90"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * Memoised: it sits inside the composer, so without this it re-rendered — Radix root, portal
 * presence and all — on every single keystroke. The caller passes a stable `onPick`.
 */
export const EmojiPicker = memo(EmojiPickerPanel);
