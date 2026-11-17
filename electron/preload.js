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

  getSettings: () => ipcRenderer.invoke('store:getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('store:saveSettings', settings),
  getAppearance: () => ipcRenderer.invoke('app:getAppearance'),
  setAppearance: (mode) => ipcRenderer.invoke('app:setAppearance', mode),
  isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
  toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
  onFullScreenChange: (cb) => {
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('window:fullscreen', listener);
    return () => ipcRenderer.removeListener('window:fullscreen', listener);
  },
});
