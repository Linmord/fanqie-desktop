import { create } from 'zustand';
import { message } from 'antd';
import type { Book, BookshelfItem } from '@/types';
import * as api from '@/services/api';
import { useAccount } from '@/stores/account';

interface BookshelfState {
  items: BookshelfItem[];
  loading: boolean;
  syncing: boolean;
  load: () => Promise<void>;
  sync: () => Promise<void>;
  uploadLocal: () => Promise<void>;
  add: (book: Book) => Promise<void>;
  remove: (bookId: string) => Promise<void>;
  updateProgress: (bookId: string, chapterId: string, chapterTitle: string, index: number, total: number) => Promise<void>;
  savePosition: (bookId: string, chapterId: string, paraIndex: number) => Promise<void>;
  isInShelf: (bookId: string) => boolean;
}

const loggedIn = () => !!useAccount.getState().user;

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** 云端书架为准；同一本书本地读得更新时保留本地进度 */
function merge(cloud: BookshelfItem[], local: BookshelfItem[]): BookshelfItem[] {
  const localMap = new Map(local.map((i) => [i.book.id, i]));
  return cloud.map((c) => {
    const l = localMap.get(c.book.id);
    if (!l) return c;
    const book = { ...l.book, ...Object.fromEntries(Object.entries(c.book).filter(([, v]) => v !== '' && v !== 0)) } as Book;
    const localNewer = !!l.lastReadChapterId && (!c.lastReadChapterId || l.updatedAt > c.updatedAt);
    const sameChapter = c.lastReadChapterId === l.lastReadChapterId;
    return localNewer
      ? { ...c, book, lastReadChapterId: l.lastReadChapterId, lastReadChapterTitle: l.lastReadChapterTitle, lastReadParaIndex: l.lastReadParaIndex, progress: l.progress, updatedAt: l.updatedAt }
      : { ...c, book, lastReadChapterTitle: c.lastReadChapterTitle || (sameChapter ? l.lastReadChapterTitle : ''), lastReadParaIndex: sameChapter ? l.lastReadParaIndex : undefined };
  });
}

export const useBookshelf = create<BookshelfState>((set, get) => ({
  items: [],
  loading: false,
  syncing: false,

  load: async () => {
    set({ loading: get().items.length === 0 });
    const items = await api.getBookshelf();
    set({ items, loading: false });
    if (loggedIn()) await get().sync();
  },

  /** 拉取云书架，覆盖本地（本地作为离线缓存） */
  sync: async () => {
    if (get().syncing) return;
    set({ syncing: true });
    try {
      const cloud = await api.getCloudShelf();
      const items = await api.replaceBookshelf(merge(cloud, await api.getBookshelf()));
      set({ items });
    } catch (err) {
      message.error(`书架同步失败：${errMsg(err)}`);
    } finally {
      set({ syncing: false });
    }
  },

  /** 登录后把本地独有的书传到云书架，再拉取合并 */
  uploadLocal: async () => {
    try {
      const local = await api.getBookshelf();
      const cloudIds = new Set((await api.getCloudShelf()).map((i) => i.book.id));
      const pending = local.filter((i) => !cloudIds.has(i.book.id));
      // 倒序加入，保持本地书架的先后顺序
      for (const item of [...pending].reverse()) await api.addToCloudShelf(item.book.id);
      if (pending.length) message.success(`已把本地 ${pending.length} 本书同步到番茄书架`);
    } catch (err) {
      message.error(`上传本地书架失败：${errMsg(err)}`);
    }
    await get().sync();
  },

  add: async (book) => {
    if (loggedIn()) {
      try {
        await api.addToCloudShelf(book.id);
      } catch (err) {
        message.error(errMsg(err));
        return;
      }
    }
    const now = new Date().toISOString();
    const items = await api.addToBookshelf({
      book,
      lastReadChapterId: '',
      lastReadChapterTitle: '',
      progress: 0,
      addedAt: now,
      updatedAt: now,
    });
    set({ items });
  },

  remove: async (bookId) => {
    if (loggedIn()) {
      try {
        await api.removeFromCloudShelf(bookId);
      } catch (err) {
        message.error(errMsg(err));
        return;
      }
    }
    const items = await api.removeFromBookshelf(bookId);
    set({ items });
  },

  updateProgress: async (bookId, chapterId, chapterTitle, index, total) => {
    const progress = total > 0 ? Math.min(1, (index + 1) / total) : 0;
    const prev = get().items.find((i) => i.book.id === bookId);
    const items = await api.updateBookshelfItem(bookId, {
      lastReadChapterId: chapterId,
      lastReadChapterTitle: chapterTitle,
      progress,
      // 换章从头读；同一章重新打开保留章内位置
      ...(prev?.lastReadChapterId !== chapterId && { lastReadParaIndex: 0 }),
    });
    set({ items });
    if (loggedIn()) {
      // 进度同步失败不打扰阅读，下次同步时以本地较新的进度为准
      api.updateCloudProgress(bookId, chapterId, index, progress).catch((err) => console.warn('进度同步失败', err));
    }
  },

  savePosition: async (bookId, chapterId, paraIndex) => {
    const prev = get().items.find((i) => i.book.id === bookId);
    if (!prev || prev.lastReadChapterId !== chapterId || prev.lastReadParaIndex === paraIndex) return;
    const items = await api.updateBookshelfItem(bookId, { lastReadParaIndex: paraIndex });
    set({ items });
  },

  isInShelf: (bookId) => get().items.some((i) => i.book.id === bookId),
}));
