const { app, BrowserWindow, ipcMain, shell, session, nativeTheme } = require('electron');
const path = require('path');
const api = require('./services/api');
const { FanqieAppApi } = require('./services/appapi');
const store = require('./services/store');
const account = require('./services/account');
const chapterCache = require('./services/chaptercache');

let mainWindow;

// 窗口底色与页面主题一致，避免启动和切换明暗时闪一下别的颜色
const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#262624' : '#FAF9F5');
const appApi = new FanqieAppApi();
appApi.getCookie = () => account.getCookieHeader();

function createWindow() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['content-security-policy'];
    delete headers['Content-Security-Policy'];
    callback({ responseHeaders: headers });
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // 隐藏式标题栏只在 macOS 上有红绿灯按钮；Windows/Linux 保留系统标题栏，否则没有关闭/最小化按钮
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : { autoHideMenuBar: true }),
    backgroundColor: windowBg(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 阅读页的全屏按钮要跟随实际状态（也可能是用户点了绿灯进入全屏）
  const sendFullScreen = () => mainWindow.webContents.send('window:fullscreen', mainWindow.isFullScreen());
  mainWindow.on('enter-full-screen', sendFullScreen);
  mainWindow.on('leave-full-screen', sendFullScreen);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // 外观模式交给 nativeTheme，页面里的 prefers-color-scheme 会跟着变
  nativeTheme.themeSource = store.getAppearance();
  nativeTheme.on('updated', () => mainWindow?.setBackgroundColor(windowBg()));
  createWindow();
  chapterCache.prune();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC: 搜索 ---
ipcMain.handle('api:search', async (_e, query, page) => {
  // 网页搜索页是客户端渲染，SSR 拿不到结果，优先走 App 搜索接口
  try {
    return await appApi.searchBooks(query);
  } catch (err) {
    console.warn('App 搜索失败，回退 Web 搜索:', err.message);
    return api.search(query, page);
  }
});

// --- IPC: 书籍详情 ---
ipcMain.handle('api:bookDetail', async (_e, bookId) => {
  return api.getBookDetail(bookId);
});

// --- IPC: 章节列表 ---
ipcMain.handle('api:chapters', async (_e, bookId) => {
  const chapters = await api.getChapters(bookId);
  chapterCache.registerBook(bookId, chapters);
  return chapters;
});

// --- IPC: 章节内容（优先 App API，无章节限制且无字体加密）---
ipcMain.handle('api:chapterContent', async (_e, itemId) => {
  try {
    const { content, paraIdx } = await chapterCache.getChapter(appApi, itemId);
    return { content, fontCss: '', paraIdx };
  } catch (err) {
    console.warn('App API 失败，回退 Web API:', err.message);
    return api.getChapterContent(itemId);
  }
});

// --- IPC: 段评 ---
ipcMain.handle('comment:stats', (_e, itemId) => appApi.commentStats(String(itemId)));
ipcMain.handle('comment:list', (_e, itemId, bookId, paraIndex, cursor, sort) =>
  appApi.commentList(String(itemId), String(bookId), paraIndex, cursor, sort));
ipcMain.handle('comment:replies', (_e, commentId, cursor) => appApi.commentReplies(String(commentId), cursor));
ipcMain.handle('comment:add', (_e, itemId, bookId, paraIndex, paraText, text) =>
  appApi.commentAdd(String(itemId), String(bookId), paraIndex, paraText, text));
ipcMain.handle('comment:reply', (_e, itemId, bookId, paraIndex, paraText, rootId, toUserId, text, toReplyId) =>
  appApi.replyAdd(String(itemId), String(bookId), paraIndex, paraText, rootId, toUserId, text, toReplyId));
ipcMain.handle('comment:digg', (_e, bookId, id, like, isReply, serviceId) =>
  appApi.commentDigg(String(bookId), String(id), like, isReply, serviceId));
ipcMain.handle('comment:emojis', () => api.getEmojis());

// --- IPC: 分类列表 ---
ipcMain.handle('api:categories', async () => {
  return api.getCategories();
});

// --- IPC: 排行榜 / 首页推荐 ---
ipcMain.handle('api:ranking', async (_e, rankId, page) => {
  return api.getRanking(rankId, page);
});
ipcMain.handle('api:recommend', () => api.getRecommend());

// --- IPC: 书架 ---
ipcMain.handle('store:getBookshelf', () => store.getBookshelf());
ipcMain.handle('store:addToBookshelf', (_e, item) => store.addToBookshelf(item));
ipcMain.handle('store:removeFromBookshelf', (_e, bookId) => store.removeFromBookshelf(bookId));
ipcMain.handle('store:updateBookshelfItem', (_e, bookId, data) => store.updateBookshelfItem(bookId, data));

// --- IPC: 番茄账号（扫码登录 + 云书架）---
ipcMain.handle('account:getQrcode', () => account.getQrcode());
ipcMain.handle('account:checkQrcode', (_e, token) => account.checkQrcode(token));
ipcMain.handle('account:getUser', () => account.getUser());
ipcMain.handle('account:logout', () => account.logout());
ipcMain.handle('account:getCloudShelf', async () => {
  const shelf = await account.getCloudShelf();
  // 书架详情接口不带作者：先用本地缓存，缺的再并发查网页详情补全；失败不影响书架本身
  const cached = new Map(store.getBookshelf().map((i) => [i.book.id, i.book]));
  for (const { book } of shelf) {
    const c = cached.get(book.id);
    if (c && c.author) {
      book.author = book.author || c.author;
      book.category = book.category || c.category || '';
      book.wordCount = book.wordCount || c.wordCount || 0;
    }
  }
  const missing = shelf.filter((i) => !i.book.author).map((i) => i.book);
  const worker = async () => {
    while (missing.length) {
      const book = missing.shift();
      try {
        const d = await api.getBookDetail(book.id);
        if (!d) continue;
        book.author = d.author || '';
        book.category = book.category || d.category || '';
        book.wordCount = book.wordCount || d.wordCount || 0;
        book.latestChapter = book.latestChapter || d.latestChapter || '';
      } catch (err) {
        console.warn(`补全作者失败 ${book.id}:`, err.message);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return shelf;
});
ipcMain.handle('account:addToCloudShelf', (_e, bookId) => account.addToCloudShelf(bookId));
ipcMain.handle('account:removeFromCloudShelf', (_e, bookId) => account.removeFromCloudShelf(bookId));
ipcMain.handle('account:updateCloudProgress', (_e, bookId, itemId, index, progress) =>
  account.updateCloudProgress(bookId, itemId, index, progress));
ipcMain.handle('store:replaceBookshelf', (_e, items) => store.replaceBookshelf(items));

// --- IPC: 设置 ---
ipcMain.handle('store:getSettings', () => store.getSettings());
ipcMain.handle('store:saveSettings', (_e, settings) => store.saveSettings(settings));
ipcMain.handle('window:isFullScreen', (e) => !!BrowserWindow.fromWebContents(e.sender)?.isFullScreen());
ipcMain.handle('window:toggleFullScreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});
ipcMain.handle('app:getAppearance', () => store.getAppearance());
ipcMain.handle('app:setAppearance', (_e, mode) => {
  const saved = store.saveAppearance(mode);
  nativeTheme.themeSource = saved;
  return saved;
});
