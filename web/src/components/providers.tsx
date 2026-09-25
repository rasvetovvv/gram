"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api";
import { applyLocale, readLocale } from "@/lib/i18n";
import { ToastProvider } from "./ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: (failureCount, error) =>
              !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 1
          },
          mutations: { retry: 0 }
        }
      })
  );

  // Mirror the saved locale onto <html lang> once on mount, so a reload keeps the chosen
  // language without a server round-trip (the SSR default is English).
  useEffect(() => {
    applyLocale(readLocale());
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={320}>
        <ToastProvider>{children}</ToastProvider>
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
