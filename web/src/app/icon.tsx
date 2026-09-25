import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * The mark drawn in code rather than committed as a binary: it is the same glyph the rail and the
 * public shell draw, so a favicon can never drift from the brand it stands for.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(140deg, #1b1926 0%, #0a0a0c 55%, #06060a 100%)",
          color: "#ffffff",
          fontSize: 320,
          fontWeight: 900,
          letterSpacing: "-0.06em"
        }}
      >
        G
      </div>
    ),
    size
  );
}
