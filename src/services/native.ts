// 桌面端原生能力：通过 Tauri 命令调用 Rust 后端（src-tauri）
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';

// Tauri 的失败是裸字符串，统一包成 Error，上层按 err.message 取提示
const call = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  invoke<T>(cmd, args).catch((e) => {
    throw e instanceof Error ? e : new Error(String(e));
  });

export const native: NativeAPI = {
  search: (query, page) => call('api_search', { query, page }),
  bookDetail: (bookId) => call('api_book_detail', { bookId }),
  chapters: (bookId) => call('api_chapters', { bookId }),
  chapterContent: (itemId) => call('api_chapter_content', { itemId }),
  commentStats: (itemId) => call('comment_stats', { itemId }),
  commentList: (itemId, bookId, paraIndex, cursor, sort) =>
    call('comment_list', { itemId, bookId, paraIndex, cursor, sort }),
  commentReplies: (commentId, cursor) => call('comment_replies', { commentId, cursor }),
  commentAdd: (itemId, bookId, paraIndex, paraText, text) =>
    call('comment_add', { itemId, bookId, paraIndex, paraText, text }),
  commentReply: (itemId, bookId, paraIndex, paraText, rootId, toUserId, text, toReplyId) =>
    call('comment_reply', { itemId, bookId, paraIndex, paraText, rootId, toUserId, text, toReplyId }),
  commentDigg: (bookId, id, like, isReply, serviceId) =>
    call('comment_digg', { bookId, id, like, isReply, serviceId }),
  commentEmojis: () => call('comment_emojis'),
  audioTones: (bookId) => call('audio_tones', { bookId }),
  audioPlayInfo: (itemId, toneId) => call('audio_play_info', { itemId, toneId }),
  audioTimepoints: (bookId, itemId, toneId) => call('audio_timepoints', { bookId, itemId, toneId }),
  audioNarration: (bookId, itemId, abookId) => call('audio_narration', { bookId, itemId, abookId }),
  categories: () => call('api_categories'),
  ranking: (rankId, page) => call('api_ranking', { rankId, page }),
  recommend: () => call('api_recommend'),

  getBookshelf: () => call('store_get_bookshelf'),
  addToBookshelf: (item) => call('store_add_to_bookshelf', { item }),
  removeFromBookshelf: (bookId) => call('store_remove_from_bookshelf', { bookId }),
  updateBookshelfItem: (bookId, data) => call('store_update_bookshelf_item', { bookId, data }),
  replaceBookshelf: (items) => call('store_replace_bookshelf', { items }),

  getQrcode: () => call('account_get_qrcode'),
  checkQrcode: (token) => call('account_check_qrcode', { token }),
  getUser: () => call('account_get_user'),
  logout: () => call('account_logout'),
  getCloudShelf: () => call('account_get_cloud_shelf'),
  addToCloudShelf: (bookId) => call('account_add_to_cloud_shelf', { bookId }),
  removeFromCloudShelf: (bookId) => call('account_remove_from_cloud_shelf', { bookId }),
  updateCloudProgress: (bookId, itemId, index, progress) =>
    call('account_update_cloud_progress', { bookId, itemId, index, progress }),

  getBookmarks: (bookId) => call('store_get_bookmarks', { bookId }),
  saveBookmarks: (bookId, list) => call('store_save_bookmarks', { bookId, list }),
  getSettings: () => call('store_get_settings'),
  saveSettings: (settings) => call('store_save_settings', { settings }),
  getAppearance: () => call('app_get_appearance'),
  setAppearance: (mode) => call('app_set_appearance', { mode }),

  bossKeyRegistered: () => call('app_boss_key_registered'),
  openMoyu: (bookId, chapterId, para) => call('moyu_open', { bookId, chapterId, para }),
  closeMoyu: (chapterId, para) => call('moyu_close', { chapterId, para }),
  getMoyuPrefs: () => call('moyu_get_prefs'),
  saveMoyuPrefs: (patch) => call('moyu_save_prefs', { patch }),
  onMoyuExit: (cb) => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    listen<{ chapterId: string; para: number }>('moyu:exit', (e) => cb(e.payload)).then((fn) =>
      stopped ? fn() : (unlisten = fn),
    );
    return () => {
      stopped = true;
      unlisten?.();
    };
  },
  // 无边框摸鱼窗口：按住正文拖动窗口，按住右下角改大小，交给系统原生处理
  startMoyuDrag: (mode) =>
    mode === 'move' ? getCurrentWindow().startDragging() : getCurrentWindow().startResizeDragging('SouthEast'),

  isFullScreen: () => getCurrentWindow().isFullscreen(),
  toggleFullScreen: async () => {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  },
  // 全屏没有专门的事件（也可能是用户点了绿灯进入），窗口尺寸一变就查一次状态
  onFullScreenChange: (cb) => {
    const win = getCurrentWindow();
    let last: boolean | null = null;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    win
      .onResized(async () => {
        const now = await win.isFullscreen();
        if (!stopped && now !== last) {
          last = now;
          cb(now);
        }
      })
      .then((fn) => (stopped ? fn() : (unlisten = fn)));
    return () => {
      stopped = true;
      unlisten?.();
    };
  },
};

// 外链统一 target=_blank，这里拦下来交给系统浏览器打开
export function installExternalLinks() {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null;
    if (a?.href) {
      e.preventDefault();
      openUrl(a.href).catch(() => {});
    }
  });
}
