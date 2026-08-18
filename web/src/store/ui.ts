import { create } from "zustand";

type UiState = {
  composerOpen: boolean;
  searchOpen: boolean;
  /**
   * Premium and the gift collection are sheets, not destinations. Keeping their open state
   * here lets every entry point raise them over the current page: navigating to a route
   * instead would unmount the page behind the sheet, which reads as the screen jumping.
   */
  premiumOpen: boolean;
  giftsOpen: boolean;
  giftsRecipient: string | null;
  activeChatId: string | null;
  openComposer: () => void;
  closeComposer: () => void;
  toggleSearch: () => void;
  openPremium: () => void;
  closePremium: () => void;
  openGifts: (recipient?: string) => void;
  closeGifts: () => void;
  setActiveChat: (id: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
  composerOpen: false,
  searchOpen: false,
  premiumOpen: false,
  giftsOpen: false,
  giftsRecipient: null,
  activeChatId: null,
  openComposer: () => set({ composerOpen: true }),
  closeComposer: () => set({ composerOpen: false }),
  toggleSearch: () => set((state) => ({ searchOpen: !state.searchOpen })),
  openPremium: () => set({ premiumOpen: true }),
  closePremium: () => set({ premiumOpen: false }),
  openGifts: (recipient) => set({ giftsOpen: true, giftsRecipient: recipient ?? null }),
  closeGifts: () => set({ giftsOpen: false, giftsRecipient: null }),
  setActiveChat: (activeChatId) => set({ activeChatId })
}));
