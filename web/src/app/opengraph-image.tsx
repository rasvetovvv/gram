import { ImageResponse } from "next/og";

import { SITE_NAME, SITE_SHORT_DESCRIPTION, SITE_TAGLINE } from "@/lib/seo";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;

/**
 * The card a link to GRAM shows in a chat, a post, or a search result. Generated rather than
 * committed so the wording follows `lib/seo.ts` and cannot fall out of step with the site copy.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "78px 84px",
          background: "linear-gradient(135deg, #16142099 0%, #0a0a0c 45%, #050506 100%)",
          backgroundColor: "#050506",
          color: "#ffffff",
          fontFamily: "sans-serif"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div
            style={{
              width: 84,
              height: 84,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 24,
              background: "#1b1926",
              color: "#a895ff",
              fontSize: 52,
              fontWeight: 900
            }}
          >
            G
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: "-0.02em" }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 850,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              maxWidth: 940
            }}
          >
            {SITE_TAGLINE}
          </div>
          <div style={{ fontSize: 30, lineHeight: 1.45, color: "#a9abb4", maxWidth: 900 }}>
            {SITE_SHORT_DESCRIPTION}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: "#8b8f98" }}>
          vexory.xyz
        </div>
      </div>
    ),
    size
  );
}
