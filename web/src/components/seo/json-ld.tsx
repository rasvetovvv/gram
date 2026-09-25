import { graph } from "@/lib/seo";

/**
 * One place that turns schema.org nodes into the `<script type="application/ld+json">` a crawler
 * reads. Every payload is built from local constants, so there is no untrusted input to escape —
 * and JSON.stringify cannot emit a `</script>` sequence from our own data.
 */
export function JsonLd({ nodes }: { nodes: object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph(nodes)) }}
    />
  );
}
