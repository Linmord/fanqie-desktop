import { create } from 'zustand';
import type { Chapter, ReaderSettings } from '@/types';
import * as api from '@/services/api';
import { DEFAULT_SETTINGS, normalizeSettings } from '@/components/Reader/options';

/** 章节流里的一章：正文按章加载，加载失败的章节停在流里显示占位卡 */
export interface Segment {
  chapter: Chapter;
  status: 'loading' | 'ready' | 'error';
  content: string;
  fontCss: string;
  paraIdx: number[];
  commentStats: Record<string, number>;
  error?: string;
}

interface ChapterData {
  content: string;
  fontCss: string;
  paraIdx: number[];
}

/** 当前章前后各保留几章，更远的从 DOM 卸载 */
const KEEP = 2;
/** 正文缓存的章数：卸载后再滚回来、或预取的下一章，都直接从这里取 */
const CACHE_SIZE = 10;

const cache = new Map<string, Promise<ChapterData>>();

function fetchChapter(id: string): Promise<ChapterData> {
  const hit = cache.get(id);
  if (hit) {
    // 刷新 LRU 顺序
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const p = api.chapterContent(id).then((r) => {
    if (!r.content) throw new Error('未能获取正文，可能需要登录或网络异常');
    return { content: r.content, fontCss: r.fontCss || '', paraIdx: r.paraIdx || [] };
  });
  // 失败的请求不留在缓存里，重试时重新发
  p.catch(() => cache.delete(id));
  cache.set(id, p);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return p;
}

const loadingSeg = (chapter: Chapter): Segment => ({
  chapter, status: 'loading', content: '', fontCss: '', paraIdx: [], commentStats: {},
});

interface ReaderState {
  bookId: string;
  chapters: Chapter[];
  /** 已渲染的连续章节，按章节顺序 */
  segments: Segment[];
  /** 视口顶部所在的章 */
  currentId: string;
  settings: ReaderSettings;

  loadChapters: (bookId: string) => Promise<void>;
  /** 清空章节流，从指定章重新开始 */
  openAt: (chapter: Chapter) => void;
  appendNext: () => void;
  prependPrev: () => void;
  retry: (chapterId: string) => void;
  setCurrent: (chapterId: string) => void;
  addCommentCount: (chapterId: string, paraIndex: number) => void;
  reset: () => void;
  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<ReaderSettings>) => Promise<void>;
}

export const useReader = create<ReaderState>((set, get) => {
  const patchSeg = (id: string, patch: Partial<Segment>) =>
    set((s) => ({ segments: s.segments.map((g) => (g.chapter.id === id ? { ...g, ...patch } : g)) }));

  const indexOf = (id: string) => get().chapters.findIndex((c) => c.id === id);

  const load = (chapter: Chapter) => {
    fetchChapter(chapter.id).then(
      (d) => {
        patchSeg(chapter.id, { status: 'ready', ...d });
        // 段评数单独拉，失败不影响阅读
        if (d.paraIdx.length) {
          api.commentStats(chapter.id)
            .then((commentStats) => patchSeg(chapter.id, { commentStats }))
            .catch((err) => console.warn('段评数加载失败:', err));
        }
        // 流的末尾这章好了，就把下一章正文先取进缓存，滚到底时直接接上
        const { segments, chapters } = get();
        if (segments[segments.length - 1]?.chapter.id === chapter.id) {
          const next = chapters[indexOf(chapter.id) + 1];
          if (next) fetchChapter(next.id).catch(() => {});
        }
      },
      (err: Error) => patchSeg(chapter.id, { status: 'error', error: err.message }),
    );
  };

  return {
    bookId: '',
    chapters: [],
    segments: [],
    currentId: '',
    settings: DEFAULT_SETTINGS,

    loadChapters: async (bookId) => {
      set({ bookId, chapters: [], segments: [], currentId: '' });
      const chapters = await api.chapters(bookId);
      set({ chapters });
    },

    openAt: (chapter) => {
      set({ segments: [loadingSeg(chapter)], currentId: chapter.id });
      load(chapter);
    },

    appendNext: () => {
      const { segments, chapters } = get();
      const last = segments[segments.length - 1];
      if (last?.status !== 'ready') return;
      const next = chapters[indexOf(last.chapter.id) + 1];
      if (!next) return;
      set({ segments: [...segments, loadingSeg(next)] });
      load(next);
    },

    prependPrev: () => {
      const { segments, chapters } = get();
      const first = segments[0];
      if (first?.status !== 'ready') return;
      const prev = chapters[indexOf(first.chapter.id) - 1];
      if (!prev) return;
      set({ segments: [loadingSeg(prev), ...segments] });
      load(prev);
    },

    retry: (chapterId) => {
      const seg = get().segments.find((g) => g.chapter.id === chapterId);
      if (!seg || seg.status !== 'error') return;
      patchSeg(chapterId, { status: 'loading', error: undefined });
      load(seg.chapter);
    },

    // 换章时顺带卸载离当前章太远的章节
    setCurrent: (chapterId) => {
      const { segments, currentId } = get();
      if (chapterId === currentId) return;
      const i = segments.findIndex((g) => g.chapter.id === chapterId);
      if (i < 0) return;
      const from = Math.max(0, i - KEEP);
      const kept = segments.slice(from, i + KEEP + 1);
      set({ currentId: chapterId, ...(kept.length !== segments.length && { segments: kept }) });
    },

    addCommentCount: (chapterId, paraIndex) => {
      const seg = get().segments.find((g) => g.chapter.id === chapterId);
      if (seg) patchSeg(chapterId, { commentStats: { ...seg.commentStats, [paraIndex]: (seg.commentStats[paraIndex] || 0) + 1 } });
    },

    reset: () => set({ segments: [], currentId: '' }),

    loadSettings: async () => {
      const settings = normalizeSettings(await api.getSettings());
      set({ settings });
    },

    // 先改界面再落盘，调字号时不用等 IPC
    updateSettings: async (patch) => {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      await api.saveSettings(settings);
    },
  };
});
