import * as Avatar from "@radix-ui/react-avatar";
import type { CSSProperties } from "react";

export function UserAvatar({
  src,
  name,
  online = false,
  size = 44,
  objectPosition = "50% 50%",
  ringColor = "var(--canvas)",
  radius
}: {
  src?: string | null;
  name: string;
  online?: boolean;
  size?: number;
  objectPosition?: string;
  ringColor?: string;
  /** Groups use a rounded square, as in the reference; people stay circular. */
  radius?: string;
}) {
  const initials = name
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("") || "G";

  const style = {
    width: size,
    height: size,
    "--avatar-position": objectPosition,
    "--avatar-ring": ringColor,
    ...(radius ? { borderRadius: radius } : {})
  } as CSSProperties;

  return (
    <Avatar.Root className="avatar-shell" style={style} aria-label={name}>
      <span className="avatar-clip">
        <Avatar.Image src={src ?? undefined} alt={name} />
        {/* The radius is inherited so a square group avatar clips its fallback too. */}
        <Avatar.Fallback
          delayMs={180}
          className="grid h-full w-full place-items-center rounded-[inherit] bg-[#292534] text-sm font-extrabold text-[#d9d3ff]"
        >
          {initials.toUpperCase()}
        </Avatar.Fallback>
      </span>
      {online ? <span className="avatar-presence" aria-label="В сети" /> : null}
    </Avatar.Root>
  );
}
