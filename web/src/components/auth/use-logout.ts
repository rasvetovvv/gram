"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const clearSession = useAuthStore((state) => state.clearSession);

  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      clearSession();
      queryClient.clear();
      router.replace("/login");
    }
  });
}
