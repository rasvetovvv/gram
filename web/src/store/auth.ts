import { create } from "zustand";

import type { User } from "@/lib/types";

export type AuthStatus = "idle" | "checking" | "authenticated" | "guest";

type AuthState = {
  user: User | null;
  status: AuthStatus;
  setUser: (user: User) => void;
  setStatus: (status: AuthStatus) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: "idle",
  setUser: (user) => set({ user, status: "authenticated" }),
  setStatus: (status) => set({ status }),
  clearSession: () => set({ user: null, status: "guest" })
}));
