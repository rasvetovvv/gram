"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useState } from "react";

import { ApiError } from "@/lib/api";
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

  return (
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider delayDuration={320}>
        <ToastProvider>{children}</ToastProvider>
      </Tooltip.Provider>
    </QueryClientProvider>
  );
}
