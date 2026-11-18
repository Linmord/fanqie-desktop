const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  search: (query, page) => ipcRenderer.invoke('api:search', query, page),
  bookDetail: (bookId) => ipcRenderer.invoke('api:bookDetail', bookId),
  chapters: (bookId) => ipcRenderer.invoke('api:chapters', bookId),
  chapterContent: (itemId) => ipcRenderer.invoke('api:chapterContent', itemId),
  commentStats: (itemId) => ipcRenderer.invoke('comment:stats', itemId),
  commentList: (itemId, bookId, paraIndex, cursor, sort) =>
    ipcRenderer.invoke('comment:list', itemId, bookId, paraIndex, cursor, sort),
  commentReplies: (commentId, cursor) => ipcRenderer.invoke('comment:replies', commentId, cursor),
  commentAdd: (itemId, bookId, paraIndex, paraText, text) =>
    ipcRenderer.invoke('comment:add', itemId, bookId, paraIndex, paraText, text),
  commentReply: (itemId, bookId, paraIndex, paraText, rootId, toUserId, text, toReplyId) =>
    ipcRenderer.invoke('comment:reply', itemId, bookId, paraIndex, paraText, rootId, toUserId, text, toReplyId),
  commentDigg: (bookId, id, like, isReply, serviceId) =>
    ipcRenderer.invoke('comment:digg', bookId, id, like, isReply, serviceId),
  commentEmojis: () => ipcRenderer.invoke('comment:emojis'),
  audioTones: (bookId) => ipcRenderer.invoke('audio:tones', bookId),
  audioPlayInfo: (itemId, toneId) => ipcRenderer.invoke('audio:playInfo', itemId, toneId),
  audioTimepoints: (bookId, itemId, toneId) => ipcRenderer.invoke('audio:timepoints', bookId, itemId, toneId),
  audioNarration: (bookId, itemId, abookId) => ipcRenderer.invoke('audio:narration', bookId, itemId, abookId),
  categories: () => ipcRenderer.invoke('api:categories'),
  ranking: (rankId, page) => ipcRenderer.invoke('api:ranking', rankId, page),
  recommend: () => ipcRenderer.invoke('api:recommend'),

  getBookshelf: () => ipcRenderer.invoke('store:getBookshelf'),
  addToBookshelf: (item) => ipcRenderer.invoke('store:addToBookshelf', item),
  removeFromBookshelf: (bookId) => ipcRenderer.invoke('store:removeFromBookshelf', bookId),
  updateBookshelfItem: (bookId, data) => ipcRenderer.invoke('store:updateBookshelfItem', bookId, data),

  replaceBookshelf: (items) => ipcRenderer.invoke('store:replaceBookshelf', items),

  getQrcode: () => ipcRenderer.invoke('account:getQrcode'),
  checkQrcode: (token) => ipcRenderer.invoke('account:checkQrcode', token),
  getUser: () => ipcRenderer.invoke('account:getUser'),
  logout: () => ipcRenderer.invoke('account:logout'),
  getCloudShelf: () => ipcRenderer.invoke('account:getCloudShelf'),
  addToCloudShelf: (bookId) => ipcRenderer.invoke('account:addToCloudShelf', bookId),
  removeFromCloudShelf: (bookId) => ipcRenderer.invoke('account:removeFromCloudShelf', bookId),
  updateCloudProgress: (bookId, itemId, index, progress) =>
    ipcRenderer.invoke('account:updateCloudProgress', bookId, itemId, index, progress),

  getBookmarks: (bookId) => ipcRenderer.invoke('store:getBookmarks', bookId),
  saveBookmarks: (bookId, list) => ipcRenderer.invoke('store:saveBookmarks', bookId, list),
  getSettings: () => ipcRenderer.invoke('store:getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('store:saveSettings', settings),
  getAppearance: () => ipcRenderer.invoke('app:getAppearance'),
  setAppearance: (mode) => ipcRenderer.invoke('app:setAppearance', mode),
  bossKeyRegistered: () => ipcRenderer.invoke('app:bossKeyRegistered'),
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
  openMoyu: (bookId, chapterId, para) => ipcRenderer.invoke('moyu:open', bookId, chapterId, para),
  closeMoyu: (chapterId, para) => ipcRenderer.invoke('moyu:close', chapterId, para),
  setMoyuBounds: (bounds) => ipcRenderer.invoke('moyu:setBounds', bounds),
  getMoyuPrefs: () => ipcRenderer.invoke('moyu:getPrefs'),
  saveMoyuPrefs: (patch) => ipcRenderer.invoke('moyu:savePrefs', patch),
  onMoyuExit: (cb) => {
    const listener = (_e, pos) => cb(pos);
    ipcRenderer.on('moyu:exit', listener);
    return () => ipcRenderer.removeListener('moyu:exit', listener);
  },
  onFullScreenChange: (cb) => {
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('window:fullscreen', listener);
    return () => ipcRenderer.removeListener('window:fullscreen', listener);
  },
});
