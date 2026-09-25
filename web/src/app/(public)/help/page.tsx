import type { Metadata } from "next";

import { HelpCenter } from "@/components/public/help-center";
import { HELP_ARTICLES } from "@/components/public/help-data";
import { JsonLd } from "@/components/seo/json-ld";
import { absolute, breadcrumbSchema, webPageSchema } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Help Center",
  description:
    "GRAM knowledge base: how to reset your password, create a channel or community, hide your “online” status, " +
    "close your account, end active sessions, top up Stars, send a gift, and contact support.",
  alternates: { canonical: "/help" },
  openGraph: {
    type: "website",
    url: "/help",
    title: "GRAM Help Center",
    description: "Step-by-step guides for your account, privacy, chats, communities, posts, and Stars."
  }
};

export default function HelpPage() {
  /* Every article is already written as an ordered list of steps, which is exactly what HowTo
     describes. This is the structure an answer engine quotes when someone asks "how to hide status
     in GRAM" — so it is generated from the same data the page renders, never a second copy. */
  const howTos = HELP_ARTICLES.map((article) => ({
    "@type": "HowTo",
    "@id": `${absolute("/help")}#${article.slug}`,
    name: article.title,
    description: article.summary,
    inLanguage: "en",
    totalTime: "PT2M",
    step: article.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.length > 70 ? `${step.slice(0, 67)}…` : step,
      text: step,
      url: `${absolute("/help")}#${article.slug}`
    }))
  }));

  const page = webPageSchema({
    path: "/help",
    name: "GRAM Help Center",
    description: metadata.description as string,
    type: "CollectionPage",
    extra: {
      mainEntity: {
        "@type": "ItemList",
        name: "Help center articles",
        itemListElement: HELP_ARTICLES.map((article, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: article.title,
          url: `${absolute("/help")}#${article.slug}`
        }))
      }
    }
  });

  return (
    <>
      <JsonLd
        nodes={[
          page,
          breadcrumbSchema([
            { name: "Home", path: "/" },
            { name: "Help Center", path: "/help" }
          ]),
          ...howTos
        ]}
      />
      <HelpCenter />
    </>
  );
}
