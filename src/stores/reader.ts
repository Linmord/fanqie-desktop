import { create } from 'zustand';
import type { Chapter, ReaderSettings } from '@/types';
import * as api from '@/services/api';

interface ReaderState {
  bookId: string;
  chapters: Chapter[];
  currentChapter: Chapter | null;
  content: string;
  fontCss: string;
  paraIdx: number[];
  commentStats: Record<string, number>;
  loading: boolean;
  settings: ReaderSettings;

  loadChapters: (bookId: string) => Promise<void>;
  loadContent: (chapter: Chapter) => Promise<void>;
  nextChapter: () => Promise<void>;
  prevChapter: () => Promise<void>;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<ReaderSettings>) => Promise<void>;
}

const defaultSettings: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  pageWidth: 720,
  theme: { name: '默认', bgColor: '#1a1a2e', textColor: '#e0e0e0' },
  fontFamily: 'system-ui',
  readingMode: 'scroll',
};

export const useReader = create<ReaderState>((set, get) => ({
  bookId: '',
  chapters: [],
  currentChapter: null,
  content: '',
  fontCss: '',
  paraIdx: [],
  commentStats: {},
  loading: false,
  settings: defaultSettings,

  loadChapters: async (bookId) => {
    set({ bookId, loading: true });
    const chapters = await api.chapters(bookId);
    set({ chapters, loading: false });
  },

  loadContent: async (chapter) => {
    set({ currentChapter: chapter, content: '', fontCss: '', paraIdx: [], commentStats: {}, loading: true });
    const result = await api.chapterContent(chapter.id);
    set({ content: result.content || '', fontCss: result.fontCss || '', paraIdx: result.paraIdx || [], loading: false });
    // 段评数单独拉，失败不影响阅读；翻章后旧请求的结果丢弃
    if (result.paraIdx?.length) {
      api.commentStats(chapter.id)
        .then((commentStats) => {
          if (get().currentChapter?.id === chapter.id) set({ commentStats });
        })
        .catch((err) => console.warn('段评数加载失败:', err));
    }
  },

  nextChapter: async () => {
    const { chapters, currentChapter } = get();
    if (!currentChapter) return;
    const idx = chapters.findIndex((c) => c.id === currentChapter.id);
    if (idx < chapters.length - 1) {
      await get().loadContent(chapters[idx + 1]);
    }
  },

  prevChapter: async () => {
    const { chapters, currentChapter } = get();
    if (!currentChapter) return;
    const idx = chapters.findIndex((c) => c.id === currentChapter.id);
    if (idx > 0) {
      await get().loadContent(chapters[idx - 1]);
    }
  },

  loadSettings: async () => {
    const settings = await api.getSettings();
    set({ settings });
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    await api.saveSettings(settings);
    set({ settings });
  },
}));
