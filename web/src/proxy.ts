import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * `/` has two legitimate jobs:
 *
 * - a person with a GRAM session expects the signed-in feed;
 * - a new visitor (and every search/answer-engine crawler) needs a public explanation of the product.
 *
 * The old client-only AuthGate always rendered "Checking session…" in the server response and then
 * redirected in JavaScript. Google, ChatGPT and Perplexity therefore saw an empty homepage even
 * though `/` was the highest-priority URL in the sitemap.
 *
 * A request carrying either current auth cookie keeps the original app route. An anonymous GET/HEAD
 * is internally rewritten to the server-rendered public homepage; the browser address and canonical
 * remain https://vexory.xyz/. No token is inspected or copied — presence only selects a presentation,
 * while the API remains the authority that validates and refreshes the session.
 */
export function proxy(request: NextRequest) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has("gram_access") || request.cookies.has("gram_refresh");
  if (hasSession) {
    const response = NextResponse.next();
    response.headers.append("Vary", "Cookie");
    return response;
  }

  const url = request.nextUrl.clone();
  url.pathname = "/public-home";
  const response = NextResponse.rewrite(url);
  response.headers.append("Vary", "Cookie");
  return response;
}

export const config = {
  matcher: "/"
};