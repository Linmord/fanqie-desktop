/// <reference types="vite/client" />

interface ElectronAPI {
  search(query: string, page?: number): Promise<import('./types').SearchResult>;
  bookDetail(bookId: string): Promise<import('./types').Book | null>;
  chapters(bookId: string): Promise<import('./types').Chapter[]>;
  chapterContent(itemId: string): Promise<import('./types').ChapterContent>;
  commentStats(itemId: string): Promise<Record<string, number>>;
  commentList(itemId: string, bookId: string, paraIndex: number, cursor?: string, sort?: number): Promise<import('./types').CommentPage>;
  commentReplies(commentId: string, cursor?: string): Promise<import('./types').ReplyPage>;
  commentAdd(itemId: string, bookId: string, paraIndex: number, paraText: string, text: string): Promise<import('./types').ParaComment>;
  commentReply(itemId: string, bookId: string, paraIndex: number, paraText: string, rootId: string, toUserId: string, text: string, toReplyId?: string): Promise<import('./types').ParaComment>;
  commentDigg(bookId: string, id: string, like: boolean, isReply: boolean, serviceId: number): Promise<void>;
  commentEmojis(): Promise<Record<string, string>>;
  audioTones(bookId: string): Promise<import('./types').AudioTone[]>;
  audioPlayInfo(itemId: string, toneId: number): Promise<{ url: string; backupUrl: string }>;
  audioTimepoints(bookId: string, itemId: string, toneId: number): Promise<import('./types').AudioTimepoint[]>;
  audioNarration(bookId: string, itemId: string, abookId: string): Promise<import('./types').AudioNarration>;
  categories(): Promise<{ id: string; name: string; children: { id: string; name: string }[] }[]>;
  ranking(rankId?: string, page?: number): Promise<import('./types').SearchResult>;
  recommend(): Promise<{ title: string; books: import('./types').Book[] }[]>;

  getBookshelf(): Promise<import('./types').BookshelfItem[]>;
  addToBookshelf(item: import('./types').BookshelfItem): Promise<import('./types').BookshelfItem[]>;
  removeFromBookshelf(bookId: string): Promise<import('./types').BookshelfItem[]>;
  updateBookshelfItem(bookId: string, data: Partial<import('./types').BookshelfItem>): Promise<import('./types').BookshelfItem[]>;

  replaceBookshelf(items: import('./types').BookshelfItem[]): Promise<import('./types').BookshelfItem[]>;

  getQrcode(): Promise<{ token: string; image: string; expireTime: number }>;
  checkQrcode(token: string): Promise<import('./types').QrcodeStatus>;
  getUser(): Promise<import('./types').FanqieUser | null>;
  logout(): Promise<void>;
  getCloudShelf(): Promise<import('./types').BookshelfItem[]>;
  addToCloudShelf(bookId: string): Promise<void>;
  removeFromCloudShelf(bookId: string): Promise<void>;
  updateCloudProgress(bookId: string, itemId: string, index: number, progress: number): Promise<void>;

  getSettings(): Promise<import('./types').ReaderSettings>;
  saveSettings(settings: import('./types').ReaderSettings): Promise<import('./types').ReaderSettings>;
  getAppearance(): Promise<import('./types').Appearance>;
  setAppearance(mode: import('./types').Appearance): Promise<import('./types').Appearance>;
  isFullScreen(): Promise<boolean>;
  toggleFullScreen(): Promise<void>;
  /** 返回取消监听的函数 */
  onFullScreenChange(cb: (fullScreen: boolean) => void): () => void;
}

interface Window {
  electronAPI: ElectronAPI;
}

/** package.json 里的版本号，由 vite.config.ts 注入 */
declare const __APP_VERSION__: string;
