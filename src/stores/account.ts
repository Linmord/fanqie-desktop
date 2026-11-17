import { create } from 'zustand';
import type { FanqieUser } from '@/types';
import * as api from '@/services/api';

interface AccountState {
  user: FanqieUser | null;
  ready: boolean;
  loginOpen: boolean;
  init: () => Promise<void>;
  setUser: (user: FanqieUser | null) => void;
  openLogin: () => void;
  closeLogin: () => void;
  logout: () => Promise<void>;
}

export const useAccount = create<AccountState>((set) => ({
  user: null,
  ready: false,
  loginOpen: false,

  init: async () => {
    const user = await api.getUser().catch(() => null);
    set({ user, ready: true });
  },

  setUser: (user) => set({ user }),
  openLogin: () => set({ loginOpen: true }),
  closeLogin: () => set({ loginOpen: false }),

  logout: async () => {
    await api.logout();
    set({ user: null });
  },
}));
