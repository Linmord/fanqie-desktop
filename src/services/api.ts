const isElectron = !!window.electronAPI;

const noop = () => Promise.resolve({ books: [], total: 0, hasMore: false });
const noopNull = () => Promise.resolve(null);
const noopArr = () => Promise.resolve([]);
const noopSettings = () => Promise.resolve({
  fontSize: 18,
  lineHeight: 1.8,
  pageWidth: 720,
  theme: 'auto' as const,
  fontFamily: 'serif' as const,
  readingMode: 'scroll' as const,
});

const fallback: ElectronAPI = {
  search: noop,
  bookDetail: noopNull,
  chapters: noopArr,
  chapterContent: () => Promise.resolve({ content: '', fontCss: '' }),
  commentStats: () => Promise.resolve({}),
  commentList: () => Promise.resolve({ comments: [], cursor: '', hasMore: false, total: 0 }),
  commentReplies: () => Promise.resolve({ replies: [], cursor: '', hasMore: false }),
  commentAdd: () => Promise.reject(new Error('请在桌面客户端中发段评')),
  commentReply: () => Promise.reject(new Error('请在桌面客户端中回复')),
  commentDigg: () => Promise.reject(new Error('请在桌面客户端中点赞')),
  commentEmojis: () => Promise.resolve({}),
  categories: () => Promise.resolve([]),
  ranking: noop,
  recommend: noopArr,
  getBookshelf: noopArr,
  addToBookshelf: noopArr as ElectronAPI['addToBookshelf'],
  removeFromBookshelf: noopArr as ElectronAPI['removeFromBookshelf'],
  updateBookshelfItem: noopArr as ElectronAPI['updateBookshelfItem'],
  replaceBookshelf: (items) => Promise.resolve(items),
  getQrcode: () => Promise.reject(new Error('请在桌面客户端中登录')),
  checkQrcode: () => Promise.resolve({ status: 'new' as const }),
  getUser: noopNull,
  logout: () => Promise.resolve(),
  getCloudShelf: noopArr,
  addToCloudShelf: () => Promise.resolve(),
  removeFromCloudShelf: () => Promise.resolve(),
  updateCloudProgress: () => Promise.resolve(),
  getSettings: noopSettings,
  saveSettings: noopSettings as ElectronAPI['saveSettings'],
  getAppearance: () => Promise.resolve('system' as const),
  setAppearance: (mode) => Promise.resolve(mode),
  // 浏览器里预览时退回网页全屏
  isFullScreen: () => Promise.resolve(!!document.fullscreenElement),
  toggleFullScreen: () =>
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(),
  onFullScreenChange: (cb) => {
    const listener = () => cb(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', listener);
    return () => document.removeEventListener('fullscreenchange', listener);
  },
};

const api = isElectron ? window.electronAPI : fallback;

export const search = api.search.bind(api);
export const bookDetail = api.bookDetail.bind(api);
export const chapters = api.chapters.bind(api);
export const chapterContent = api.chapterContent.bind(api);
export const commentStats = api.commentStats.bind(api);
export const commentList = api.commentList.bind(api);
export const commentReplies = api.commentReplies.bind(api);
export const commentAdd = api.commentAdd.bind(api);
export const commentReply = api.commentReply.bind(api);
export const commentDigg = api.commentDigg.bind(api);
export const commentEmojis = api.commentEmojis.bind(api);
export const categories = api.categories.bind(api);
export const ranking = api.ranking.bind(api);
export const recommend = api.recommend.bind(api);

export const getBookshelf = api.getBookshelf.bind(api);
export const addToBookshelf = api.addToBookshelf.bind(api);
export const removeFromBookshelf = api.removeFromBookshelf.bind(api);
export const updateBookshelfItem = api.updateBookshelfItem.bind(api);

export const replaceBookshelf = api.replaceBookshelf.bind(api);

export const getQrcode = api.getQrcode.bind(api);
export const checkQrcode = api.checkQrcode.bind(api);
export const getUser = api.getUser.bind(api);
export const logout = api.logout.bind(api);
export const getCloudShelf = api.getCloudShelf.bind(api);
export const addToCloudShelf = api.addToCloudShelf.bind(api);
export const removeFromCloudShelf = api.removeFromCloudShelf.bind(api);
export const updateCloudProgress = api.updateCloudProgress.bind(api);

export const getSettings = api.getSettings.bind(api);
export const saveSettings = api.saveSettings.bind(api);
export const getAppearance = api.getAppearance.bind(api);
export const setAppearance = api.setAppearance.bind(api);
export const isFullScreen = api.isFullScreen.bind(api);
export const toggleFullScreen = api.toggleFullScreen.bind(api);
export const onFullScreenChange = api.onFullScreenChange.bind(api);
