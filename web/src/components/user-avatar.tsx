import * as Avatar from "@radix-ui/react-avatar";
import type { CSSProperties } from "react";
import { isVideoUrl } from "@/lib/utils";

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

  // A living avatar: whoever uploaded a clip gets it back as one, looping and silent, wherever
  // their face appears. Radix's Avatar.Image can only be a picture, so the clip replaces it and
  // the fallback initials are simply not needed for a file we know is there.
  if (isVideoUrl(src)) {
    return (
      <span className="avatar-shell" style={style} aria-label={name}>
        <span className="avatar-clip">
          <video
            src={src ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
            className="h-full w-full object-cover"
            style={{ objectPosition }}
          />
        </span>
        {online ? <span className="avatar-presence" aria-label="Online" /> : null}
      </span>
    );
  }

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
      {online ? <span className="avatar-presence" aria-label="Online" /> : null}
    </Avatar.Root>
  );
}
