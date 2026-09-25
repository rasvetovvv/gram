import type { MetadataRoute } from "next";

import { LEGAL_UPDATED_ISO } from "@/components/public/legal-document";
import { PUBLIC_ROUTES, SITE_URL } from "@/lib/seo";

/**
 * Generated from `PUBLIC_ROUTES`, so a new public page appears in the sitemap, in robots.txt and in
 * llms.txt the moment it is registered — the three files used to be edited by hand and drifted.
 *
 * Only routes a crawler can read without a session are listed. Priority ranks by what answers a
 * question about the service: the entry page, `/about` and the feature/security explainers first,
 * then the knowledge base, then the policies that mostly matter to somebody already signed up.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date(LEGAL_UPDATED_ISO);
  return PUBLIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path === "/" ? "" : route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }));
}
